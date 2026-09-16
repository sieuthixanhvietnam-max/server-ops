"""Outcome verification - confirm a task's real-world effect (site actually
serving, redirect actually works) rather than just that the underlying SSH
command or API call returned without error. "OK" from an ops function today
usually only means "the command was accepted" - e.g. clone_wpsite dispatches
work to an external background tool on the server and returns immediately,
long before the clone is actually done. These helpers close that gap so a
result can say "verified working" instead of forcing the operator to open
the site by hand.

Two distinct checking techniques, chosen per where the outcome actually
lives:
- check_http_via_ssh / poll_http_via_ssh: for outcomes that live on the
  origin server itself (WP site up, cache cleared, plugin didn't break the
  site). Curls the vhost over loopback ON the server via SSH, with SNI+Host
  pinned to the domain via curl's --resolve - this works correctly even
  when public DNS doesn't point at this server yet (true for a freshly
  cloned domain, which is usually pointed at its final target via a 301
  redirect rather than its own DNS).
- check_http_external / check_redirect_external: for outcomes that live at
  the Cloudflare edge (a 301 redirect actually firing, a domain actually
  live through Cloudflare). These can only be observed from outside, by
  hitting the real public domain - SSHing into the origin server can't see
  what Cloudflare's edge does.
"""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import requests

from app.ops import ssh_ops

VERIFY_WORKERS = 10

_LOCAL_HTTP_CHECK_SCRIPT = """#!/bin/bash
DOMAIN="$1"
curl -sk -o /dev/null -w "%{http_code}" --max-time 10 \
    --resolve "$DOMAIN:443:127.0.0.1" -H "Host: $DOMAIN" "https://127.0.0.1/" 2>/dev/null || echo "000"
"""


def check_http_via_ssh(ip: str, user: str, key: str, domain: str, timeout: int = 20) -> tuple[int, bool]:
    """Returns (http_status, ok) - ok is True for any 2xx/3xx. http_status
    is 0 if the curl itself failed to connect (site truly down/not set up)."""
    try:
        rc, output = ssh_ops.run_remote(ip, user, key, _LOCAL_HTTP_CHECK_SCRIPT, args=[domain], timeout=timeout)
    except Exception:
        return 0, False
    code_str = output.strip().splitlines()[-1] if output.strip() else "000"
    try:
        code = int(code_str)
    except ValueError:
        code = 0
    return code, 0 < code < 400


def poll_http_via_ssh(
    ip: str, user: str, key: str, domain: str, max_wait: int = 90, interval: int = 5,
) -> dict:
    """For operations that dispatch work asynchronously on the server (the
    external wptt clone tool returns from SSH before the clone is actually
    done) - a single immediate check would usually catch it mid-clone.
    Polls until success or max_wait elapses. Returns {"http_status", "ok",
    "note"} - note says how long it took, or that it never came up in time."""
    elapsed = 0
    code = 0
    while True:
        code, ok = check_http_via_ssh(ip, user, key, domain)
        if ok:
            return {"http_status": code, "ok": True, "note": f"HTTP {code} sau {elapsed}s"}
        if elapsed >= max_wait:
            return {"http_status": code, "ok": False, "note": f"chưa lên sau {max_wait}s (HTTP {code})"}
        time.sleep(interval)
        elapsed += interval


def poll_http_via_ssh_batch(
    targets: list[dict], max_wait: int = 90, interval: int = 5, workers: int = VERIFY_WORKERS,
) -> dict[str, dict]:
    """Batch counterpart to poll_http_via_ssh - every target is checked
    CONCURRENTLY against one SHARED max_wait budget, instead of waiting up
    to max_wait for each target one at a time in sequence. A batch of N
    sites dispatched together (e.g. clone_wpsite cloning 10 domains at once)
    tend to come up around the same time since the background clone tool
    runs on a similar timeline for all of them - polling them one after the
    other turned a 90s worst case into up to N * 90s for no reason.
    `targets`: [{"ip", "user", "key", "domain"}, ...]. Returns {domain: {...}}
    with the same shape as poll_http_via_ssh's return value."""
    pending = {t["domain"]: t for t in targets}
    last_code = {d: 0 for d in pending}
    results: dict[str, dict] = {}
    elapsed = 0
    while pending:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(check_http_via_ssh, t["ip"], t["user"], t["key"], domain): domain
                for domain, t in pending.items()
            }
            for future in as_completed(futures):
                domain = futures[future]
                code, ok = future.result()
                last_code[domain] = code
                if ok:
                    results[domain] = {"http_status": code, "ok": True, "note": f"HTTP {code} sau {elapsed}s"}

        for domain in results:
            pending.pop(domain, None)
        if not pending:
            break
        if elapsed >= max_wait:
            for domain in pending:
                results[domain] = {
                    "http_status": last_code[domain],
                    "ok": False,
                    "note": f"chưa lên sau {max_wait}s (HTTP {last_code[domain]})",
                }
            break
        time.sleep(interval)
        elapsed += interval
    return results


def check_http_external(domain: str, timeout: int = 15) -> tuple[int, bool]:
    """Same semantics as check_http_via_ssh but from outside, over the real
    public domain - only meaningful once DNS/CDN already points here."""
    for scheme in ("https", "http"):
        try:
            resp = requests.get(f"{scheme}://{domain}/", timeout=timeout, verify=False, allow_redirects=True)
            return resp.status_code, resp.status_code < 400
        except Exception:
            continue
    return 0, False


def check_redirect_external(source_domain: str, expected_target_host: str, timeout: int = 15) -> dict:
    """Confirms a 301/302 redirect actually fires from source_domain and
    lands on expected_target_host - not just that the Cloudflare Page Rule
    API call succeeded. Catches the exact class of bug cf-redirect-audit
    was built to find after the fact (duplicate/conflicting rules on the
    same zone silently winning over the intended one) at creation time
    instead of only on a later audit run."""
    expected = expected_target_host.lower().split(":")[0].removeprefix("www.")
    try:
        resp = requests.get(
            f"https://{source_domain}/", timeout=timeout, verify=False, allow_redirects=False,
        )
    except Exception as exc:
        return {"http_status": 0, "ok": False, "note": f"lỗi kiểm tra: {exc}"}

    status = resp.status_code
    if status not in (301, 302, 307, 308):
        return {"http_status": status, "ok": False, "note": f"không redirect (HTTP {status})"}

    location = resp.headers.get("Location", "")
    location_host = urlparse(location).netloc.split(":")[0].lower().removeprefix("www.")
    if location_host == expected:
        return {"http_status": status, "ok": True, "note": f"redirect OK -> {location_host}"}
    return {
        "http_status": status, "ok": False,
        "note": f"redirect tới {location_host or '(không rõ)'}, khác domain đích ({expected})",
    }


def poll_redirect_external(
    source_domain: str, expected_target_host: str, max_wait: int = 30, interval: int = 5,
) -> dict:
    """A Cloudflare Page Rule change can take up to ~30s to propagate to
    every edge PoP (Cloudflare's own published figure) - a single immediate
    check can land on a PoP that hasn't picked up the new rule yet and
    misreport a working redirect as broken (seen in production: go88vn.games
    reported "không redirect (HTTP 200)" 2s after creation, but was a
    confirmed working 301 moments later). Poll with backoff until it's
    confirmed working or max_wait elapses."""
    elapsed = 0
    result = None
    while True:
        result = check_redirect_external(source_domain, expected_target_host)
        if result["ok"]:
            if elapsed:
                result["note"] += f" (sau {elapsed}s)"
            return result
        if elapsed >= max_wait:
            return result
        time.sleep(interval)
        elapsed += interval
