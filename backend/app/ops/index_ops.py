"""Sitemap discovery (read-only, free) + submitting URLs to third-party
paid indexing services (SpeedyIndex/InstantIndexer/LinksIndexer/RalfyIndex),
used to force-reindex a domain right after it's been 301-redirected to a
target. Sitemap logic ported/trimmed from the standalone sitemap_crawler_webapp
reference project; indexer request/response shapes match that project's
already-production-tested integrations."""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

import requests

REQUEST_TIMEOUT = 15
SUBMIT_TIMEOUT = 30
MAX_SITEMAP_DEPTH = 5
CRAWL_WORKERS = 10
SPEEDYINDEX_CHUNK_SIZE = 1000  # avoids HTTP 413 on very large sitemaps

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_SITEMAP_PATHS = [
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/wp-sitemap.xml",
    "/post-sitemap.xml",
]

_SITEMAP_NS = {"ns": "http://www.sitemaps.org/schemas/sitemap/0.9"}


# ============================================================
# Sitemap discovery - read-only, no cost
# ============================================================

def _fetch(url: str) -> str:
    resp = requests.get(url, headers=_HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True, verify=False)
    resp.raise_for_status()
    return resp.text


def _is_valid_xml(text: str) -> bool:
    try:
        ET.fromstring(text)
        return True
    except ET.ParseError:
        return False


def _discover_sitemaps(domain: str) -> list[str]:
    found: list[str] = []
    for path in _SITEMAP_PATHS:
        url = f"https://{domain}{path}"
        try:
            content = _fetch(url)
        except Exception:
            continue

        if path == "/robots.txt":
            for line in content.splitlines():
                if line.lower().startswith("sitemap:"):
                    sm_url = line.split(":", 1)[1].strip()
                    if sm_url.startswith("/"):
                        sm_url = urljoin(f"https://{domain}", sm_url)
                    if sm_url not in found:
                        found.append(sm_url)
            continue

        if _is_valid_xml(content) and url not in found:
            found.append(url)
    return found


def _parse_sitemap(sitemap_url: str, visited: set, depth: int = 0) -> list[str]:
    if sitemap_url in visited or depth > MAX_SITEMAP_DEPTH:
        return []
    visited.add(sitemap_url)
    try:
        xml_data = _fetch(sitemap_url)
        root = ET.fromstring(xml_data)
    except Exception:
        return []

    urls = [loc.text.strip() for loc in root.findall(".//ns:url/ns:loc", _SITEMAP_NS) if loc.text]
    for sm in root.findall(".//ns:sitemap/ns:loc", _SITEMAP_NS):
        nested = (sm.text or "").strip()
        if nested:
            urls.extend(_parse_sitemap(nested, visited, depth + 1))
    return urls


def discover_sitemap_urls(domain: str) -> dict:
    """Read-only, free - safe to run unconditionally. Returns
    {"domain", "sitemap_count", "url_count", "urls", "error"}."""
    domain = domain.strip().lower().replace("https://", "").replace("http://", "").strip("/")
    try:
        sitemaps = _discover_sitemaps(domain)
        if not sitemaps:
            return {"domain": domain, "sitemap_count": 0, "url_count": 0, "urls": [], "error": "Không tìm thấy sitemap"}
        urls: set[str] = set()
        visited: set[str] = set()
        for sm in sitemaps:
            urls.update(_parse_sitemap(sm, visited))
        sorted_urls = sorted(urls)
        return {
            "domain": domain, "sitemap_count": len(sitemaps), "url_count": len(sorted_urls),
            "urls": sorted_urls, "error": None,
        }
    except Exception as exc:
        return {"domain": domain, "sitemap_count": 0, "url_count": 0, "urls": [], "error": str(exc)}


def crawl_sitemaps(domains: list[str], log) -> list[dict]:
    """Parallel sitemap discovery for multiple domains - read-only/free.
    Used both standalone (Force Index page's preview step) and as a
    best-effort bonus check inside cf_ops.sync_redirects."""
    log(f"Crawl sitemap cho {len(domains)} domain...")
    results: list[dict | None] = [None] * len(domains)
    with ThreadPoolExecutor(max_workers=CRAWL_WORKERS) as pool:
        futures = {pool.submit(discover_sitemap_urls, d): i for i, d in enumerate(domains)}
        for future in as_completed(futures):
            i = futures[future]
            try:
                r = future.result()
            except Exception as exc:
                r = {"domain": domains[i], "sitemap_count": 0, "url_count": 0, "urls": [], "error": str(exc)}
            results[i] = r
            if r["error"]:
                log(f"[fail] {r['domain']}: {r['error']}")
            else:
                log(f"[ ok ] {r['domain']}: {r['url_count']} URL trong {r['sitemap_count']} sitemap")
    return results


# ============================================================
# Indexer submit - paid APIs, one call per domain
# ============================================================

_FAILURE_KEYWORDS = ("fail", "error", "invalid", "unauthorized", "denied", "expired")


def _message_indicates_failure(message: str | None) -> bool:
    return bool(message) and any(kw in message.lower() for kw in _FAILURE_KEYWORDS)


def _submit_speedyindex(urls: list[str], api_key: str) -> tuple[bool, str]:
    # PPS (pay_per_submission) instead of PPI (pay_per_indexed) as of
    # 2026-08-21 - 30 tok/URL charged at submission time, NOT refunded if
    # the URL never actually gets indexed (unlike PPI's 100 tok/URL which
    # is refunded on failure). Requires the account to be allow-listed for
    # PPS by SpeedyIndex - an unlisted account gets HTTP 403, called out
    # separately below since it's a distinct, actionable failure mode (not
    # "bad URL"/"no balance"). Daily submission cap (default 35,000
    # URLs/UTC day, may differ per account) is enforced server-side, not
    # tracked here - a cap-exceeded response surfaces via the `code`/
    # `message` fields same as any other failure.
    chunks = [urls[i:i + SPEEDYINDEX_CHUNK_SIZE] for i in range(0, len(urls), SPEEDYINDEX_CHUNK_SIZE)]
    task_ids, errors = [], []
    for i, chunk in enumerate(chunks):
        resp = requests.post(
            "https://api.speedyindex.com/v2/task/google/indexer/create",
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            json={"urls": chunk, "pay_per_submission": True},
            timeout=SUBMIT_TIMEOUT,
        )
        if resp.status_code == 403:
            errors.append("HTTP 403 - tài khoản chưa được SpeedyIndex allow-list cho chế độ pay_per_submission")
            continue
        data = resp.json()
        # `code` is the documented authoritative result (0 ok / 1 not
        # enough balance / 2 bad URL) - checked instead of only inferring
        # success from task_id's presence, since a future response shape
        # could return both on a partial/logical failure.
        if resp.status_code == 200 and data.get("code") == 0 and data.get("task_id"):
            task_ids.append(str(data["task_id"]))
        else:
            code = data.get("code")
            reason = {1: "không đủ token", 2: "URL không hợp lệ"}.get(code)
            errors.append(reason or str(data.get("message") or f"HTTP {resp.status_code}"))
        if i < len(chunks) - 1:
            time.sleep(0.5)  # SpeedyIndex rate limit: 120/min

    if task_ids and not errors:
        return True, f"{len(task_ids)} task (PPS): {', '.join(task_ids)}"
    if task_ids:
        return True, f"{len(task_ids)}/{len(chunks)} chunk thành công (PPS); lỗi: {'; '.join(errors)}"
    return False, "; ".join(errors) or "unknown error"


def _submit_instantindexer(urls: list[str], api_key: str, project: str) -> tuple[bool, str]:
    resp = requests.post(
        "https://instantindexer.org/api/submit.php",
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        json={"project": project, "urls": urls, "instant": False},
        timeout=SUBMIT_TIMEOUT,
    )
    data = resp.json()
    message = data.get("message")
    # InstantIndexer signals failure (bad/expired key, quota...) via HTTP 200
    # with an error message in the body, not via status code - seen in
    # production returning {"message": "Submission failed"} on 200. Status
    # code alone isn't a reliable success signal here, so a failure-sounding
    # message overrides a 2xx status. Raw body is echoed back on failure so
    # the actual cause is visible in the job log without needing a DB dig.
    ok = 200 <= resp.status_code < 300 and not _message_indicates_failure(message)
    if ok:
        return True, str(message or "ok")
    return False, f"{message or f'HTTP {resp.status_code}'} | raw: {data}"


def _submit_linksindexer(urls: list[str], api_key: str, campaign_name: str) -> tuple[bool, str]:
    resp = requests.post(
        "https://linksindexer.com/api/campaign/create",
        data={"api_token": api_key, "urls": "|".join(urls), "campaign_name": campaign_name, "dripfeed": 0},
        timeout=SUBMIT_TIMEOUT,
    )
    data = resp.json()
    message = data.get("message")
    # Same anti-pattern as InstantIndexer above - a 2xx status doesn't
    # guarantee the body reports success, so a failure-sounding message
    # overrides it.
    ok = 200 <= resp.status_code < 300 and not _message_indicates_failure(message)
    if ok:
        return True, str(message or "ok")
    return False, f"{message or f'HTTP {resp.status_code}'} | raw: {data}"


def _submit_ralfyindex(urls: list[str], api_key: str, project_name: str) -> tuple[bool, str]:
    payload = {"apikey": api_key, "urls": urls, "instantIndex": 0}
    if project_name:
        payload["projectName"] = project_name
    resp = requests.post("https://api.ralfyindex.com/project", json=payload, timeout=SUBMIT_TIMEOUT)
    data = resp.json()
    if 200 <= resp.status_code < 300 and not data.get("errorCode"):
        return True, f"{data.get('message') or 'ok'} ({data.get('creditsUsed', '?')} credits)"
    return False, f"[{data.get('errorCode', '?')}] {data.get('message') or f'HTTP {resp.status_code}'}"


def _project_name(domain: str) -> str:
    """ASCII-only project/campaign name sent to the indexer APIs. The old
    f"Ép index {domain}" tripped InstantIndexer's validation in production
    (errorCode 10: "Project name contains invalid characters or is too
    long") - the Vietnamese diacritics in "Ép" are the likely trigger.
    Domain names are already validated ASCII, so this is safe by construction."""
    return f"force-index-{domain}"


_SUBMIT_FN = {
    "speedyindex": lambda urls, api_key, domain: _submit_speedyindex(urls, api_key),
    "instantindexer": lambda urls, api_key, domain: _submit_instantindexer(urls, api_key, _project_name(domain)),
    "linksindexer": lambda urls, api_key, domain: _submit_linksindexer(urls, api_key, _project_name(domain)),
    "ralfyindex": lambda urls, api_key, domain: _submit_ralfyindex(urls, api_key, _project_name(domain)),
}


def force_index_submit(entries: list[dict], service: str, api_key: str, log, dry_run: bool = False) -> list[dict]:
    """entries: [{"domain", "urls": [...]}]. Submits sequentially (paid API,
    one call per domain, and services like RalfyIndex enforce a 1 req/s rate
    limit) - each entry wrapped in try/except so one bad domain never loses
    sibling results (see wp_ops.py for why this convention exists)."""
    submit_fn = _SUBMIT_FN.get(service)
    if submit_fn is None:
        raise ValueError(f"unknown indexer service: {service}")

    log(f"Ép index {len(entries)} domain qua {service}...")
    results = []
    for i, e in enumerate(entries):
        domain = e.get("domain", "?")
        urls = e.get("urls") or []
        try:
            if not urls:
                log(f"[skip] {domain}: không có URL")
                results.append({"domain": domain, "url_count": 0, "status": "SKIP", "note": "không có URL", "service": service})
                continue

            if dry_run:
                log(f"[dry-run] would submit {len(urls)} URL của {domain} qua {service}")
                results.append({"domain": domain, "url_count": len(urls), "status": "DRYRUN", "note": "no changes made", "service": service})
                continue

            ok, msg = submit_fn(urls, api_key, domain)
            if ok:
                log(f"[ ok ] {domain}: đã gửi {len(urls)} URL - {msg}")
                results.append({"domain": domain, "url_count": len(urls), "status": "OK", "note": msg, "service": service})
            else:
                log(f"[fail] {domain}: {msg}")
                results.append({"domain": domain, "url_count": len(urls), "status": "FAIL", "note": msg, "service": service})
        except Exception as exc:
            log(f"[fail] {domain}: unexpected error - {exc}")
            results.append({"domain": domain, "url_count": len(urls), "status": "FAIL", "note": f"unexpected error: {exc}", "service": service})

        if not dry_run and urls and i < len(entries) - 1:
            time.sleep(1.0)  # be polite across domains too (RalfyIndex: 1 req/s)
    return results
