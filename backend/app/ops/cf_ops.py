import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import dns.resolver
import requests

from app.config import settings
from app.ops import index_ops, verify_ops

CF_BASE = "https://api.cloudflare.com/client/v4/zones"
PARALLEL_WORKERS = 10
REQUEST_TIMEOUT = 15
MAX_RETRY = 3
RETRY_BACKOFF = 1.0

# The exact shape sync_redirects ever writes (see _normalize_domain there):
# one literal hostname, no leading wildcard, single trailing "/*". Anything
# else on a live zone is either hand-edited or a leftover from before this
# app enforced that shape - see audit_page_rules.
_REDIRECT_PATTERN_RE = re.compile(r"^[a-z0-9.-]+/\*$")

class CFClient:
    def __init__(self, api_token: str | None = None):
        # Instance-level (not class-level) cache/lock: different CFClient
        # instances can be scoped to different Cloudflare accounts, and a
        # token from account A cannot see account B's zones. A shared
        # class-level cache would let a "not found" lookup from one
        # account's token poison the result for a different account's
        # client looking up the same domain name.
        self._zone_cache = {}
        self._cache_lock = threading.Lock()
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {api_token or settings.cf_api_token}",
                "Content-Type": "application/json",
            }
        )

    def _request(self, method, url, **kw):
        kw.setdefault("timeout", REQUEST_TIMEOUT)
        last_exc = None
        for attempt in range(MAX_RETRY):
            try:
                resp = self._session.request(method, url, **kw)
                if resp.status_code == 429 or resp.status_code >= 500:
                    time.sleep(RETRY_BACKOFF * (2**attempt))
                    continue
                return resp.json()
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_exc = exc
                time.sleep(RETRY_BACKOFF * (2**attempt))
        return {"success": False, "errors": [{"message": str(last_exc)}]}

    def _get(self, url, **kw):
        return self._request("GET", url, **kw)

    def _post(self, url, **kw):
        return self._request("POST", url, **kw)

    def _put(self, url, **kw):
        return self._request("PUT", url, **kw)

    def _patch(self, url, **kw):
        return self._request("PATCH", url, **kw)

    def _delete(self, url, **kw):
        return self._request("DELETE", url, **kw)

    def _err_msg(self, data):
        errs = data.get("errors", [])
        # `.get("message", "unknown error")` only falls back when the key is
        # MISSING - Cloudflare sometimes sends {"message": null} (e.g. some
        # validation failures put the real detail in "messages" instead),
        # which .get() happily returns as-is, so the `or` is load-bearing
        # here, not redundant with the .get default.
        return (errs[0].get("message") or "unknown error") if errs else "unknown error"

    def verify_token(self):
        return self._get("https://api.cloudflare.com/client/v4/user/tokens/verify")

    def list_all_zones(self, per_page: int = 50) -> list[dict]:
        """Every zone visible to this client's token, across all pages."""
        return self._paginated(CF_BASE, {"per_page": per_page})

    def list_accounts(self, per_page: int = 50) -> list[dict]:
        """Every Cloudflare account this client's token can see - only
        returns more than one entry for a token scoped to "All accounts"
        under a user that's a member of multiple accounts."""
        return self._paginated("https://api.cloudflare.com/client/v4/accounts", {"per_page": per_page})

    def list_zones_for_account(self, cf_account_id: str, per_page: int = 50) -> list[dict]:
        return self._paginated(CF_BASE, {"account.id": cf_account_id, "per_page": per_page})

    def _paginated(self, url: str, params: dict) -> list[dict]:
        items = []
        page = 1
        while True:
            r = self._get(url, params={**params, "page": page})
            if not r.get("success"):
                raise RuntimeError(self._err_msg(r))
            result = r.get("result", [])
            items.extend(result)
            info = r.get("result_info", {})
            if not result or page >= info.get("total_pages", 1):
                break
            page += 1
        return items

    def get_zone_id(self, domain: str):
        apex = domain.strip().lower()
        if apex.startswith("www."):
            apex = apex[4:]
        with self._cache_lock:
            if apex in self._zone_cache:
                return self._zone_cache[apex]

        r = self._get(CF_BASE, params={"name": apex, "per_page": 5})
        zone_id = None
        if r.get("success") and r.get("result"):
            zone_id = r["result"][0]["id"]
        with self._cache_lock:
            self._zone_cache[apex] = zone_id
        return zone_id

    def get_a_records(self, zone_id: str):
        r = self._get(f"{CF_BASE}/{zone_id}/dns_records", params={"type": "A"})
        return r.get("result", []) if r.get("success") else []

    def get_nameservers(self, zone_id: str):
        r = self._get(f"{CF_BASE}/{zone_id}")
        if r.get("success") and r.get("result"):
            return sorted(r["result"].get("name_servers", []))
        return []

    def get_page_rules(self, zone_id: str):
        r = self._get(f"{CF_BASE}/{zone_id}/pagerules")
        return r.get("result", []) if r.get("success") else []

    def create_zone(self, domain: str, cf_account_id: str | None = None):
        return self._post(CF_BASE, json={
            "name": domain, "account": {"id": cf_account_id or settings.cf_account_id}, "jump_start": True,
        })

    def setup_dns(self, zone_id: str, domain: str, ip: str, log):
        data = self._get(f"{CF_BASE}/{zone_id}/dns_records")
        if data.get("success"):
            for rec in data.get("result", []):
                self._delete(f"{CF_BASE}/{zone_id}/dns_records/{rec['id']}")

        r = self._post(f"{CF_BASE}/{zone_id}/dns_records", json={
            "type": "A", "name": domain, "content": ip, "ttl": 120, "proxied": True,
        })
        log(f"    A      {domain} -> {ip}" if r.get("success") else f"    [fail] A record: {self._err_msg(r)}")

        r = self._post(f"{CF_BASE}/{zone_id}/dns_records", json={
            "type": "CNAME", "name": "www", "content": domain, "ttl": 120, "proxied": True,
        })
        log(f"    CNAME  www.{domain} -> {domain}" if r.get("success") else f"    [fail] CNAME: {self._err_msg(r)}")

    def update_a_record(self, zone_id: str, domain: str, ip: str, log):
        """Point the apex A record at `ip`, creating it if the zone doesn't
        have one yet. Used after a clone/migration to move an *existing*
        domain to its new server - unlike setup_dns(), this does not touch
        any other record (MX, TXT, www CNAME, ...) on the zone."""
        recs = self.get_a_records(zone_id)
        rec = next((r for r in recs if r["name"].lower() == domain.lower()), None)

        if rec and rec["content"] == ip:
            log(f"    DNS    {domain} already -> {ip}")
            return "unchanged", ""

        if rec:
            r = self._patch(f"{CF_BASE}/{zone_id}/dns_records/{rec['id']}", json={"content": ip})
        else:
            r = self._post(f"{CF_BASE}/{zone_id}/dns_records", json={
                "type": "A", "name": domain, "content": ip, "ttl": 120, "proxied": True,
            })

        if r.get("success"):
            log(f"    DNS    {domain} -> {ip}")
            return "updated", ""
        err = self._err_msg(r)
        log(f"    [fail] DNS update: {err}")
        return "error", err

    def update_a_records(self, zone_id: str, new_ip: str) -> tuple[bool, str]:
        """Point every existing A record on the zone at new_ip (unlike
        update_a_record, which only touches the apex record - this moves
        e.g. manually added subdomain A records along with it too). Used for
        bulk IP migration where the target server already serves everything
        the zone currently has, so no record needs to be added/removed."""
        records = self.get_a_records(zone_id)
        if not records:
            r = self._post(f"{CF_BASE}/{zone_id}/dns_records", json={
                "type": "A", "name": "@", "content": new_ip, "ttl": 120, "proxied": True,
            })
            return (True, "created") if r.get("success") else (False, self._err_msg(r))

        failed = []
        for rec in records:
            r = self._patch(f"{CF_BASE}/{zone_id}/dns_records/{rec['id']}", json={"content": new_ip})
            if not r.get("success"):
                failed.append(f"{rec['name']}: {self._err_msg(r)}")
        if failed:
            return False, "; ".join(failed)
        return True, "updated"

    def set_origin_port(self, zone_id: str, port: int) -> tuple[bool, str]:
        """Force Cloudflare to connect to the origin on `port` instead of
        80/443, via an Origin Rule (http_request_origin phase). Replaces any
        existing origin ruleset wholesale - this app only ever needs at most
        one such rule per zone."""
        url = f"{CF_BASE}/{zone_id}/rulesets/phases/http_request_origin/entrypoint"
        rules = [{
            "expression": "true",
            "description": f"origin port rewrite to {port}",
            "action": "route",
            "action_parameters": {"origin": {"port": port}},
            "enabled": True,
        }]
        r = self._put(url, json={"rules": rules})
        return (True, f"origin port -> {port}") if r.get("success") else (False, self._err_msg(r))

    def clear_origin_port(self, zone_id: str) -> tuple[bool, str]:
        url = f"{CF_BASE}/{zone_id}/rulesets/phases/http_request_origin/entrypoint"
        data = self._get(url)
        if not data.get("success") or not data.get("result", {}).get("rules"):
            return True, "không có rule nào"
        r = self._put(url, json={"rules": []})
        return (True, "đã xoá rule") if r.get("success") else (False, self._err_msg(r))

    def set_ssl_flexible(self, zone_id: str, log):
        r = self._patch(f"{CF_BASE}/{zone_id}/settings/ssl", json={"value": "flexible"})
        log("    SSL    flexible" if r.get("success") else f"    [fail] SSL: {self._err_msg(r)}")

    def set_always_https(self, zone_id: str, log):
        r = self._patch(f"{CF_BASE}/{zone_id}/settings/always_use_https", json={"value": "on"})
        log("    HTTPS  always_use_https on" if r.get("success") else f"    [fail] HTTPS: {self._err_msg(r)}")

    def _build_firewall_rules(self, whitelist_ips: list[str]):
        ips = " ".join(whitelist_ips)
        return [
            {
                "description": "Skip: WP-JSON OR Bots OR Whitelist IPs OR Google ASN",
                "expression": (
                    f'(http.request.uri.path contains "/wp-json/") '
                    f'or (cf.client.bot) or (ip.src in {{ {ips} }}) '
                    f'or (ip.geoip.asnum eq 15169)'
                ),
                "action": "skip", "enabled": True,
                "action_parameters": {"ruleset": "current"},
            },
            {
                "description": "Block ports != 80/443",
                "expression": "not cf.edge.server_port in {80 443}",
                "action": "block", "enabled": True,
            },
            {
                "description": "Block non-browser UA",
                "expression": (
                    '(http.user_agent eq "") or '
                    '(not lower(http.user_agent) contains "mozilla" and '
                    'not lower(http.user_agent) contains "opera")'
                ),
                "action": "block", "enabled": True,
            },
            {
                "description": "Block country list",
                "expression": 'ip.src.country in {"PH" "AE" "US" "AG" "MT" "CW" "GB" "DE" "CR" "CA" "SG" "FR"}',
                "action": "block", "enabled": True,
            },
            {
                "description": "Block xmlrpc.php",
                "expression": 'http.request.uri.path contains "xmlrpc.php"',
                "action": "block", "enabled": True,
            },
        ]

    def set_firewall_rules_result(self, zone_id: str, whitelist_ips: list[str]) -> tuple[bool, str]:
        """Same PUT as set_firewall_rules but returns (ok, msg) instead of
        logging directly - used by callers (update_firewall) that need to
        build their own per-domain result row."""
        url = f"{CF_BASE}/{zone_id}/rulesets/phases/http_request_firewall_custom/entrypoint"
        rules = self._build_firewall_rules(whitelist_ips)
        r = self._put(url, json={"rules": rules})
        if r.get("success"):
            return True, f"{len(rules)} rule(s) áp dụng"
        return False, self._err_msg(r)

    def set_firewall_rules(self, zone_id: str, log, whitelist_ips: list[str]):
        ok, msg = self.set_firewall_rules_result(zone_id, whitelist_ips)
        log(f"    Firewall  {msg}" if ok else f"    [fail] Firewall: {msg}")


def delete_zones(domains: list[str], log, dry_run: bool = False) -> list[dict]:
    """Permanently deletes each domain's Cloudflare zone (DNS records,
    firewall rules, everything - not just the A record). Does NOT touch the
    WordPress site on the server - see wp_ops.remove_wpsite for that. Ported
    from cftasks.py --remove. Uses the shared master CFClient (no
    api_token/cf_account_id needed) since it already sees zones across every
    sub-account, unlike add_domains which must target one account to create
    a *new* zone in."""
    cf = CFClient()

    def _one(domain):
        if dry_run:
            log(f"[dry-run] would remove {domain} from Cloudflare (delete zone)")
            return {"domain": domain, "status": "DRYRUN", "note": "no changes made"}

        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[skip] {domain}: not found in Cloudflare account")
            return {"domain": domain, "status": "not_found", "note": "not in Cloudflare account"}

        r = cf._delete(f"{CF_BASE}/{zone_id}")
        if r.get("success"):
            with cf._cache_lock:
                cf._zone_cache.pop(domain, None)
            log(f"[ ok ] {domain}: zone removed")
            return {"domain": domain, "status": "removed", "note": ""}

        err_msg = cf._err_msg(r)
        log(f"[fail] {domain}: {err_msg}")
        return {"domain": domain, "status": "error", "note": err_msg}

    return _parallel(_one, domains, workers=5)


def verify_cf_token(api_token: str) -> tuple[bool, str]:
    """(is_valid, status_or_error_message). Used to sanity-check a
    sub-account token before/while it's stored - a typo'd or revoked token
    would otherwise only surface as a cryptic failure during a future sync."""
    cf = CFClient(api_token)
    r = cf.verify_token()
    if r.get("success"):
        return r.get("result", {}).get("status") == "active", r.get("result", {}).get("status", "unknown")
    return False, cf._err_msg(r)


def list_all_zones(api_token: str) -> list[dict]:
    return CFClient(api_token).list_all_zones()


def list_accounts(api_token: str) -> list[dict]:
    return CFClient(api_token).list_accounts()


def list_zones_for_account(api_token: str, cf_account_id: str) -> list[dict]:
    return CFClient(api_token).list_zones_for_account(cf_account_id)


def _parallel(fn, items, workers=PARALLEL_WORKERS):
    results = [None] * len(items)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fn, item): idx for idx, item in enumerate(items)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                item = items[idx]
                domain = item.get("domain") if isinstance(item, dict) else item
                results[idx] = {"domain": domain, "status": "error", "note": str(exc)}
    return results


def _parallel_batched(fn, items, log, batch_size=100, workers=10, sleep_between=10):
    """Same as _parallel, but processes `items` in fixed-size batches with a
    pause between batches - needed when the target set is every zone in the
    account (tens of thousands), where hammering Cloudflare with a single
    giant parallel burst hits rate limits. Pacing ported as-is from
    cftasks.py's --update-fw --all-zones, which was tuned from real
    rate-limit hits in production."""
    results = []
    batches = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]
    for i, batch in enumerate(batches, 1):
        log(f"[batch {i}/{len(batches)}] xử lý {len(batch)} mục...")
        results.extend(_parallel(fn, batch, workers=workers))
        if i < len(batches):
            time.sleep(sleep_between)
    return results


def check_ip(domains: list[str], log) -> list[dict]:
    cf = CFClient()
    log(f"Checking IP for {len(domains)} domain(s)...")

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found in Cloudflare")
            return {"domain": domain, "ip": None, "proxied": None, "status": "error", "note": "zone not found"}
        recs = cf.get_a_records(zone_id)
        if not recs:
            log(f"[skip] {domain}: no A record")
            return {"domain": domain, "ip": None, "proxied": None, "status": "skip", "note": "no A record"}
        rec = next((r for r in recs if not r["name"].startswith("www.")), recs[0])
        log(f"[ ok ] {domain}: {rec['content']}  ({'proxied' if rec['proxied'] else 'direct'})")
        return {
            "domain": domain,
            "ip": rec["content"],
            "proxied": rec["proxied"],
            "status": "ok",
            "note": "",
        }

    return _parallel(_one, domains)


def check_ns(domains: list[str], log) -> list[dict]:
    cf = CFClient()
    resolver = dns.resolver.Resolver()
    resolver.nameservers = ["8.8.8.8", "1.1.1.1"]
    resolver.timeout = 5
    resolver.lifetime = 10
    log(f"Checking nameservers for {len(domains)} domain(s)...")

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: not in Cloudflare account")
            return {"domain": domain, "status": "error", "note": "not in CF account",
                     "ns_cf": [], "ns_live": []}

        ns_cf = cf.get_nameservers(zone_id)
        if not ns_cf:
            log(f"[fail] {domain}: could not fetch CF nameservers")
            return {"domain": domain, "status": "error", "note": "could not fetch CF nameservers",
                     "ns_cf": [], "ns_live": []}

        try:
            answers = resolver.resolve(domain, "NS")
            ns_live = sorted(str(a).rstrip(".").lower() for a in answers)
        except dns.resolver.NXDOMAIN:
            log(f"[pend] {domain}: NXDOMAIN - not delegated yet")
            return {"domain": domain, "status": "pending", "note": "NXDOMAIN - not delegated yet",
                     "ns_cf": ns_cf, "ns_live": []}
        except dns.exception.Timeout:
            log(f"[fail] {domain}: DNS timeout")
            return {"domain": domain, "status": "error", "note": "DNS timeout",
                     "ns_cf": ns_cf, "ns_live": []}
        except Exception as exc:
            log(f"[fail] {domain}: {exc}")
            return {"domain": domain, "status": "error", "note": str(exc),
                     "ns_cf": ns_cf, "ns_live": []}

        active = bool(set(ns_cf) & set(ns_live))
        status = "active" if active else "pending"
        log(f"[{'ok' if active else 'wait'}] {domain}: {status}  live={', '.join(ns_live) or '(none)'}")
        return {"domain": domain, "status": status, "note": "", "ns_cf": ns_cf, "ns_live": ns_live}

    return _parallel(_one, domains, workers=10)


def check_zone_status(domains: list[str]) -> dict[str, dict]:
    """Live (uncached across calls) per-domain check of both whether a
    Cloudflare zone exists and whether its nameservers are already active
    (delegated at the registrar) or still pending. Used as a pre-flight
    check before clone_wpsite - local synced CfZone data can be minutes
    stale, which matters here because the common flow is "add domain, then
    clone right after". Only `has_zone` gates clone_wpsite: a zone with
    pending NS can still have its DNS record written via the API, it just
    won't resolve publicly yet - so ns_status is informational, not a gate.
    """
    cf = CFClient()
    resolver = dns.resolver.Resolver()
    resolver.nameservers = ["8.8.8.8", "1.1.1.1"]
    resolver.timeout = 5
    resolver.lifetime = 10

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            return domain, {"has_zone": False, "ns_status": "no_zone", "ns_cf": [], "ns_live": []}

        ns_cf = cf.get_nameservers(zone_id)
        try:
            answers = resolver.resolve(domain, "NS")
            ns_live = sorted(str(a).rstrip(".").lower() for a in answers)
        except dns.resolver.NXDOMAIN:
            return domain, {"has_zone": True, "ns_status": "pending", "ns_cf": ns_cf, "ns_live": []}
        except Exception:
            return domain, {"has_zone": True, "ns_status": "error", "ns_cf": ns_cf, "ns_live": []}

        active = bool(set(ns_cf) & set(ns_live))
        status = "active" if active else "pending"
        return domain, {"has_zone": True, "ns_status": status, "ns_cf": ns_cf, "ns_live": ns_live}

    result: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as pool:
        futures = [pool.submit(_one, d) for d in domains]
        for future in as_completed(futures):
            domain, status = future.result()
            result[domain] = status
    return result


def update_domain_ip(domain: str, ip: str, log) -> tuple[str, str]:
    """Point `domain`'s Cloudflare A record at `ip`. Returns (status, note)
    where status is one of updated/unchanged/error. Used by clone_wpsite
    right after a site is cloned to a new server, so the domain actually
    resolves to where the clone landed."""
    cf = CFClient()
    zone_id = cf.get_zone_id(domain)
    if not zone_id:
        log(f"    [warn] DNS: {domain} not found in Cloudflare - add it via CF Add first")
        return "error", "zone not found in Cloudflare"
    return cf.update_a_record(zone_id, domain, ip, log)


def _dns_matches(cf: "CFClient", zone_id: str, domain: str, ip: str) -> str:
    """Read-only check of whether `domain`'s current A record already
    points at `ip`. Returns matches/mismatch/unknown (no A record found)."""
    recs = [r for r in cf.get_a_records(zone_id) if r.get("name") == domain]
    if not recs:
        return "unknown"
    return "matches" if any(r.get("content") == ip for r in recs) else "mismatch"


def add_domains(
    entries: list[dict], log, whitelist_ips: list[str], dry_run: bool = False,
    api_token: str | None = None, cf_account_id: str | None = None,
    force_reconfigure: bool = False, account_label: str | None = None,
) -> list[dict]:
    """entries: [{"domain", "ip"}] - create CF zone + DNS + SSL + firewall.
    api_token/cf_account_id let the caller target a specific (PIC-resolved)
    Cloudflare account instead of the .env default. By default a domain that
    already has a zone is left untouched (someone may have hand-tuned it);
    force_reconfigure re-applies the standard DNS/SSL/HTTPS/firewall setup
    on top of it anyway - for zones known to be half-configured (e.g. a
    prior run that failed partway through). account_label is just echoed
    back on every result row so the caller can tell which account each
    domain landed in without re-deriving it."""
    cf = CFClient(api_token)
    log(f"Adding {len(entries)} domain(s) to Cloudflare...")

    def _one(entry):
        domain, ip = entry["domain"], entry["ip"]

        if dry_run:
            action = "would reconfigure" if force_reconfigure else "would add"
            log(f"[dry-run] {action} {domain} -> {ip} (zone + DNS + SSL flexible + firewall)")
            return {"domain": domain, "ip": ip, "status": "DRYRUN", "note": "no changes made",
                     "nameservers": [], "zone_id": None, "account_label": account_label, "dns_status": None}

        zone_id = cf.get_zone_id(domain)
        was_existing = bool(zone_id)

        if was_existing and not force_reconfigure:
            log(f"[skip] {domain}: already in Cloudflare [{zone_id}]")
            ns = cf.get_nameservers(zone_id)
            dns_status = _dns_matches(cf, zone_id, domain, ip)
            note = "zone already exists" + (
                " - DNS already points here" if dns_status == "matches"
                else " - DNS points elsewhere, bật 'Ép áp lại cấu hình' để sửa" if dns_status == "mismatch"
                else " - no A record found"
            )
            return {"domain": domain, "ip": ip, "status": "existing", "note": note, "nameservers": ns,
                     "zone_id": zone_id, "account_label": account_label, "dns_status": dns_status}

        if not was_existing:
            resp = cf.create_zone(domain, cf_account_id)
            if not resp.get("success"):
                err_msg = cf._err_msg(resp)
                log(f"[fail] {domain}: {err_msg}")
                return {"domain": domain, "ip": ip, "status": "error", "note": err_msg, "nameservers": [],
                         "zone_id": None, "account_label": account_label, "dns_status": None}
            zone_id = resp["result"]["id"]
            log(f"[ ok ] {domain}: zone created [{zone_id}]")
        else:
            log(f"[ ok ] {domain}: zone already exists [{zone_id}] - re-applying standard config")

        with cf._cache_lock:
            cf._zone_cache[domain] = zone_id

        cf.setup_dns(zone_id, domain, ip, log)
        cf.set_ssl_flexible(zone_id, log)
        cf.set_always_https(zone_id, log)
        cf.set_firewall_rules(zone_id, log, whitelist_ips)

        ns = []
        for _ in range(4):
            ns = cf.get_nameservers(zone_id)
            if ns:
                break
            time.sleep(3)

        if ns:
            log(f"[ ok ] {domain}: nameservers = {', '.join(ns)}")
        else:
            log(f"[warn] {domain}: nameservers not available yet - check dashboard later")

        status = "reconfigured" if was_existing else "added"
        return {"domain": domain, "ip": ip, "status": status, "note": "", "nameservers": ns,
                 "zone_id": zone_id, "account_label": account_label, "dns_status": "matches"}

    return _parallel(_one, entries, workers=5)


def change_ip(domains: list[str], new_ip: str, log, dry_run: bool = False) -> list[dict]:
    """Point every A record on each domain's zone at new_ip. Used for bulk
    server migration when the new server already has everything the old one
    did - unlike add_domains, this never creates/removes DNS records, only
    repoints existing ones."""
    cf = CFClient()
    log(f"Đổi IP cho {len(domains)} domain(s) sang {new_ip}...")

    def _one(domain):
        if dry_run:
            log(f"[dry-run] would change {domain} A record(s) -> {new_ip}")
            return {"domain": domain, "status": "DRYRUN", "note": "no changes made"}

        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "status": "error", "note": "zone not found"}

        ok, msg = cf.update_a_records(zone_id, new_ip)
        if ok:
            log(f"[ ok ] {domain}: {msg}")
            return {"domain": domain, "status": "updated", "note": msg}
        log(f"[fail] {domain}: {msg}")
        return {"domain": domain, "status": "error", "note": msg}

    return _parallel(_one, domains, workers=5)


def update_origin_port(
    domains: list[str], action: str, port: int, log, dry_run: bool = False
) -> list[dict]:
    """action: "set" (route origin requests through `port`) or "clear"
    (remove the origin port rule, back to normal 80/443)."""
    cf = CFClient()
    verb = f"đặt origin port -> {port}" if action == "set" else "xoá origin port rule"
    log(f"{verb} cho {len(domains)} domain(s)...")

    def _one(domain):
        if dry_run:
            log(f"[dry-run] would {verb} for {domain}")
            return {"domain": domain, "status": "DRYRUN", "note": "no changes made"}

        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "status": "error", "note": "zone not found"}

        ok, msg = cf.set_origin_port(zone_id, port) if action == "set" else cf.clear_origin_port(zone_id)
        if ok:
            log(f"[ ok ] {domain}: {msg}")
            return {"domain": domain, "status": "ok", "note": msg}
        log(f"[fail] {domain}: {msg}")
        return {"domain": domain, "status": "error", "note": msg}

    return _parallel(_one, domains, workers=5)


def sync_redirects(mappings: list[dict], log, dry_run: bool = False, crawl_sitemap: bool = False) -> list[dict]:
    """mappings: [{"domain", "target_url", "mode"}] - create/update a 301 Page Rule
    redirect. mode "url_to_url" preserves the request path by appending Cloudflare's
    "$1" wildcard capture to the target (domain -> domain, path kept as-is); mode
    "url_to_homepage" sends every path on the source domain to one fixed target URL
    (no path passthrough). Callers never need to know about "$1" - it's added here.

    The match pattern is "<domain>/*" - exactly ONE wildcard, matching only the
    literal host the caller passed in (no leading "*"). $1 is therefore always
    unambiguous: it's the path, full stop. This deliberately does NOT try to
    auto-cover both "domain.com" and "www.domain.com" with a single "*domain.com/*"
    rule - that leading wildcard is itself a second, earlier wildcard, which
    shifts $1 to mean "whatever's before the domain" (empty for a bare apex
    request) instead of the path, silently dropping the path and landing every
    redirect on the target's homepage. If both the apex and the www host need
    redirecting, the caller passes both as separate mappings - two explicit
    rules, not one "clever" one, so there's nothing to get the wildcard
    numbering wrong about. See
    https://developers.cloudflare.com/rules/page-rules/reference/wildcard-matching/."""
    cf = CFClient()
    log(f"Syncing {len(mappings)} redirect rule(s)...")

    def _normalize_domain(domain):
        d = domain.strip().lower().replace("https://", "").replace("http://", "")
        d = d.rstrip("/*").rstrip("/")
        return f"{d}/*"

    def _normalize_target(url):
        u = url.strip()
        if not u.startswith(("http://", "https://")):
            u = f"https://{u}"
        return u.rstrip("/")

    def _find_matched(zone_id, pattern):
        existing = cf.get_page_rules(zone_id)
        return next(
            (r for r in existing if r["targets"][0]["constraint"]["value"] == pattern), None
        )

    def _reconcile_matched(domain, zone_id, matched, target_url, mode, payload):
        """matched is an existing page rule whose pattern already equals
        ours - bring its target in line if needed. Shared by the normal
        pre-check path and the post-create-conflict retry below, so both end
        up reporting the same unchanged/updated/error outcome for the same
        situation."""
        if matched["actions"][0]["value"]["url"] == target_url:
            log(f"[skip] {domain}: already up-to-date [{matched['id']}]")
            return {"domain": domain, "target_url": target_url, "mode": mode, "status": "unchanged", "note": matched["id"]}
        r = cf._put(f"{CF_BASE}/{zone_id}/pagerules/{matched['id']}", json=payload)
        if r.get("success"):
            log(f"[ ok ] {domain}: updated [{matched['id']}]")
            return {"domain": domain, "target_url": target_url, "mode": mode, "status": "updated", "note": matched["id"]}
        log(f"[fail] {domain}: update failed - {cf._err_msg(r)}")
        return {"domain": domain, "target_url": target_url, "mode": mode, "status": "error", "note": cf._err_msg(r)}

    def _is_duplicate_pattern_error(r):
        """True if Cloudflare rejected a create because a page rule with
        this exact match pattern already exists (its "distinctTargetUrl"
        validation - the real detail lives in "messages", not "errors", so
        _err_msg() alone never sees it). Seen in production when a create
        actually succeeds server-side but the client times out/retries: the
        retry then hits this instead of a clean success - see the retry
        branch below, which reconciles against the real state rather than
        reporting a false failure for a redirect that is in fact live."""
        return any(
            "distinctTargetUrl" in (msg.get("message") or "")
            for msg in r.get("messages", [])
        )

    def _one(m):
        domain = m["domain"]
        mode = m.get("mode", "url_to_homepage")
        pattern = _normalize_domain(domain)
        target_url = _normalize_target(m["target_url"])
        if mode == "url_to_url":
            target_url = f"{target_url}/$1"

        if dry_run:
            log(f"[dry-run] would redirect {pattern} -> {target_url} (301, {mode})")
            return {"domain": domain, "target_url": target_url, "mode": mode, "status": "DRYRUN", "note": "no changes made"}

        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "target_url": target_url, "mode": mode, "status": "error", "note": "zone not found"}

        payload = {
            "targets": [{"target": "url", "constraint": {"operator": "matches", "value": pattern}}],
            "actions": [{"id": "forwarding_url", "value": {"url": target_url, "status_code": 301}}],
            "priority": 1, "status": "active",
        }
        matched = _find_matched(zone_id, pattern)
        if matched:
            return _reconcile_matched(domain, zone_id, matched, target_url, mode, payload)

        r = cf._post(f"{CF_BASE}/{zone_id}/pagerules", json=payload)
        if r.get("success"):
            rule_id = r.get("result", {}).get("id", "-")
            log(f"[ ok ] {domain}: created [{rule_id}]")
            return {"domain": domain, "target_url": target_url, "mode": mode, "status": "created", "note": rule_id}

        if _is_duplicate_pattern_error(r):
            log(f"[info] {domain}: create reported a conflict - re-checking actual state")
            matched = _find_matched(zone_id, pattern)
            if matched:
                return _reconcile_matched(domain, zone_id, matched, target_url, mode, payload)

        log(f"[fail] {domain}: create failed - {cf._err_msg(r)}")
        return {"domain": domain, "target_url": target_url, "mode": mode, "status": "error", "note": cf._err_msg(r)}

    results = _parallel(_one, mappings, workers=5)
    if not dry_run:
        _attach_redirect_checks(results, log)
        if crawl_sitemap:
            _attach_sitemap_checks(results, log)
    return results


def _target_hostname(target_url: str) -> str:
    """Strip scheme, path, and the url_to_url "$1" passthrough placeholder
    _one() appends above, leaving just the bare host to crawl."""
    host = target_url.split("://", 1)[-1]
    return host.split("/", 1)[0]


def _attach_redirect_checks(results: list[dict], log) -> None:
    """Best-effort, read-only bonus for every domain whose redirect rule is
    now live: does the redirect actually fire, and does it land on the
    right target? The Page Rule API call succeeding only means Cloudflare
    accepted the config - it doesn't mean it's the rule that actually wins
    at the edge. This is exactly the class of bug cf-redirect-audit exists
    to find after the fact (two conflicting redirect rules on the same zone,
    Cloudflare applying one at random - seen in production on
    sports-online.biz and keonhacai365.app) - checking here catches it at
    creation time instead of waiting for a later audit run. Never touches
    the redirect entry's own status/note even if the check itself fails."""
    live = [r for r in results if r.get("status") in ("created", "updated", "unchanged")]
    if not live:
        return
    try:
        checks = _parallel(
            lambda r: verify_ops.poll_redirect_external(r["domain"], _target_hostname(r["target_url"])),
            live, workers=5,
        )
    except Exception as exc:
        log(f"[info] bỏ qua kiểm tra redirect thật: {exc}")
        return
    for r, check in zip(live, checks):
        r["verify"] = check
        log(f"[{'ok' if check.get('ok') else 'warn'}] {r['domain']}: {check.get('note')}")


def _attach_sitemap_checks(results: list[dict], log) -> None:
    """Best-effort, read-only bonus for every domain whose redirect is now
    live: how many URLs are in the target's sitemap. Purely informational
    (surfaced in the cf-redirect results table so the user can jump to Force
    Index) - never touches the redirect entry's own status/note, even if the
    crawl itself fails, since that would misreport a working redirect as a
    failure.

    Multiple source domains commonly redirect to the same target (many old/
    burned domains funneled into one live site) - hosts is deduped before
    crawling so each unique target site's sitemap is only fetched once,
    not once per source row pointing at it."""
    live = [r for r in results if r.get("status") in ("created", "updated", "unchanged")]
    if not live:
        return
    hosts = sorted({_target_hostname(r["target_url"]) for r in live})
    try:
        checks = index_ops.crawl_sitemaps(hosts, log)
    except Exception as exc:
        log(f"[info] bỏ qua kiểm tra sitemap đích: {exc}")
        return
    checks_by_host = dict(zip(hosts, checks))
    for r in live:
        r["sitemap_check"] = checks_by_host[_target_hostname(r["target_url"])]


def remove_redirects(domains: list[str], log, dry_run: bool = False) -> list[dict]:
    """Deletes every Page Rule on each domain's zone that has a
    forwarding_url action - i.e. every 301 redirect rule sync_redirects
    could have created, regardless of which pattern/target it points at.
    Leaves any non-redirect page rule (if the zone happens to have one)
    untouched. Ported from cftasks.py --rm-rdr."""
    cf = CFClient()
    log(f"Xoá redirect rule cho {len(domains)} domain(s)...")

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "status": "error", "note": "zone not found", "count": 0}

        rules = cf.get_page_rules(zone_id)
        redirects = [r for r in rules if any(a.get("id") == "forwarding_url" for a in r.get("actions", []))]
        if not redirects:
            log(f"[skip] {domain}: không có redirect rule nào")
            return {"domain": domain, "status": "none", "note": "no redirect rules", "count": 0}

        if dry_run:
            log(f"[dry-run] would delete {len(redirects)} redirect rule(s) on {domain}")
            return {"domain": domain, "status": "DRYRUN", "note": f"{len(redirects)} rule(s)", "count": len(redirects)}

        deleted = 0
        for rule in redirects:
            r = cf._delete(f"{CF_BASE}/{zone_id}/pagerules/{rule['id']}")
            if r.get("success") or r.get("result") is None:
                deleted += 1

        if deleted == len(redirects):
            log(f"[ ok ] {domain}: đã xoá {deleted} rule(s)")
            return {"domain": domain, "status": "removed", "note": f"{deleted} rule(s)", "count": deleted}
        log(f"[fail] {domain}: chỉ xoá được {deleted}/{len(redirects)}")
        return {"domain": domain, "status": "error", "note": f"partial {deleted}/{len(redirects)}", "count": deleted}

    return _parallel(_one, domains, workers=5)


def update_firewall(
    log, whitelist_ips: list[str], dry_run: bool = False, domains: list[str] | None = None
) -> list[dict]:
    """Re-applies the standard firewall ruleset (skip whitelist/bots/Google
    ASN, block everything else risky) to zones. domains=None means "every
    zone the master token can see" - ported from cftasks.py --update-fw
    --all-zones, including its batching (tens of thousands of zones is the
    real scale here, see _parallel_batched). Passing an explicit domain list
    skips batching since that's always a small, deliberate set."""
    cf = CFClient()

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "status": "error", "note": "zone not found"}
        if dry_run:
            log(f"[dry-run] would apply firewall to {domain} [{zone_id}]")
            return {"domain": domain, "status": "DRYRUN", "note": "no changes made"}
        ok, msg = cf.set_firewall_rules_result(zone_id, whitelist_ips)
        if ok:
            log(f"[ ok ] {domain}: {msg}")
            return {"domain": domain, "status": "ok", "note": msg}
        log(f"[fail] {domain}: {msg}")
        return {"domain": domain, "status": "error", "note": msg}

    if domains is not None:
        log(f"Áp dụng Firewall cho {len(domains)} domain(s)...")
        return _parallel(_one, domains, workers=5)

    log("Lấy toàn bộ zone trong account (master token)...")
    zones = cf.list_all_zones(per_page=1000)
    log(f"Tìm thấy {len(zones)} zone(s). Bắt đầu áp dụng theo batch...")
    with cf._cache_lock:
        for z in zones:
            cf._zone_cache[z["name"]] = z["id"]
    return _parallel_batched(_one, [z["name"] for z in zones], log)


def audit_page_rules(log) -> list[dict]:
    """Scans every zone the master token can see for Page Rule redirect
    (forwarding_url) misconfigurations. Built after finding sports-online.biz
    and keonhacai365.app each carrying 2 conflicting redirect rules at once
    (Cloudflare silently only applies one - the other one existing at all is
    the bug). Flags only actionable anomalies - duplicate redirect rules on
    one zone, or a match pattern shaped differently than what sync_redirects
    ever writes (see _REDIRECT_PATTERN_RE) - not "zero rules", since most
    zones never had a redirect at all and that would just be noise."""
    cf = CFClient()
    log("Lấy toàn bộ zone trong account (master token)...")
    zones = cf.list_all_zones(per_page=1000)
    log(f"Tìm thấy {len(zones)} zone(s). Đang quét Page Rules theo batch...")
    with cf._cache_lock:
        for z in zones:
            cf._zone_cache[z["name"]] = z["id"]

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            return None
        rules = cf.get_page_rules(zone_id)
        redirects = [r for r in rules if any(a.get("id") == "forwarding_url" for a in r.get("actions", []))]
        if not redirects:
            return None

        issues = []
        if len(redirects) > 1:
            issues.append(f"{len(redirects)} redirect rule trùng nhau trên cùng zone")
        for r in redirects:
            pattern = r.get("targets", [{}])[0].get("constraint", {}).get("value", "")
            if not _REDIRECT_PATTERN_RE.match(pattern):
                issues.append(f"pattern bất thường: '{pattern}'")
        if not issues:
            return None

        targets = ", ".join(
            r.get("actions", [{}])[0].get("value", {}).get("url", "") for r in redirects
        )
        log(f"[!] {domain}: {'; '.join(issues)}")
        return {"domain": domain, "rule_count": len(redirects), "issues": "; ".join(issues), "targets": targets}

    zone_names = [z["name"] for z in zones]
    findings = [r for r in _parallel_batched(_one, zone_names, log) if r]
    log(f"Hoàn tất: {len(findings)} zone có vấn đề / {len(zones)} zone đã quét")
    return findings


def _strip_wildcard_suffix(url: str) -> str:
    """https://gunfu.io/$1 -> https://gunfu.io - drops sync_redirects' url_to_url
    wildcard capture (and anything after it) so a report shows a clean,
    readable target instead of a raw Page Rule template string."""
    return re.sub(r"/\$\d+.*$", "", url).rstrip("/")


def list_redirects(zone_pairs: list[dict], log) -> list[dict]:
    """zone_pairs: [{"domain", "zone_id"}] - every currently-hosted domain
    already matched to its Cloudflare zone (resolved from the Domain/CfZone
    tables in routers/jobs.py, not fetched live here - both are synced
    periodically, so this needs zero "which zone is this domain in" API
    calls, unlike audit_page_rules). Returns a flat inventory of every
    forwarding_url Page Rule found: {domain, target, target_domain, code,
    zone_id} - one row per rule, not filtered to anomalies. Built for
    exporting "what redirects to what" as a report, complementing
    audit_page_rules (which answers "what's broken", not "what exists")."""
    cf = CFClient()
    log(f"Đang quét Page Rules cho {len(zone_pairs)} domain...")

    def _one(pair):
        domain, zone_id = pair["domain"], pair["zone_id"]
        out = []
        for rule in cf.get_page_rules(zone_id):
            for action in rule.get("actions", []):
                if action.get("id") != "forwarding_url":
                    continue
                val = action.get("value") or {}
                target = (val.get("url") or "").strip()
                if not target:
                    continue
                target_clean = _strip_wildcard_suffix(target)
                out.append({
                    "domain": domain, "target": target_clean,
                    "target_domain": _target_hostname(target_clean),
                    "code": val.get("status_code", 301), "zone_id": zone_id,
                })
        return out

    raw = _parallel_batched(_one, zone_pairs, log, batch_size=200, workers=10)
    flat, errors = [], 0
    for r in raw:
        if isinstance(r, list):
            flat.extend(r)
        else:
            errors += 1
    log(f"Hoàn tất: {len(flat)} redirect rule / {len(zone_pairs)} domain đã quét"
        + (f" ({errors} lỗi)" if errors else ""))
    return flat


def purge_cache(domains: list[str], log, dry_run: bool = False) -> list[dict]:
    """Purges Cloudflare's entire edge cache (purge_everything) for each
    domain's zone - the common need right after a WP theme/content change,
    when visitors would otherwise keep seeing stale cached pages."""
    cf = CFClient()
    log(f"Xoá cache cho {len(domains)} domain(s)...")

    def _one(domain):
        if dry_run:
            log(f"[dry-run] would purge cache for {domain}")
            return {"domain": domain, "status": "DRYRUN", "note": "no changes made"}
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "status": "error", "note": "zone not found"}
        r = cf._post(f"{CF_BASE}/{zone_id}/purge_cache", json={"purge_everything": True})
        if r.get("success"):
            log(f"[ ok ] {domain}: đã xoá cache")
            return {"domain": domain, "status": "ok", "note": "purge_everything"}
        err = cf._err_msg(r)
        log(f"[fail] {domain}: {err}")
        return {"domain": domain, "status": "error", "note": err}

    return _parallel(_one, domains, workers=5)
