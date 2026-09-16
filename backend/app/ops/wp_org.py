import httpx

# https://api.wordpress.org/plugins/info/1.2/ - public, no auth needed, JSON
# response (verified live: content-type application/json, not PHP-serialized).
# Proxied server-side rather than called from the browser so the app keeps
# its "browser never talks directly to a third-party API" pattern (same as
# Cloudflare calls going through the backend).
WP_ORG_SEARCH_URL = "https://api.wordpress.org/plugins/info/1.2/"


def search_plugins(query: str, per_page: int = 20) -> list[dict]:
    """Returns [] on any network/parse failure - this is a UX convenience,
    never something that should break the page if wordpress.org is slow or
    unreachable. Callers fall back to manual slug entry."""
    if not query.strip():
        return []
    params = {
        "action": "query_plugins",
        "request[search]": query.strip(),
        "request[per_page]": str(per_page),
        "request[fields][icons]": "1",
        "request[fields][short_description]": "1",
        "request[fields][active_installs]": "1",
    }
    try:
        resp = httpx.get(WP_ORG_SEARCH_URL, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    plugins = data.get("plugins") or []
    return [
        {
            "slug": p.get("slug", ""),
            "name": p.get("name", ""),
            "short_description": p.get("short_description", ""),
            "icon": (p.get("icons") or {}).get("1x") or (p.get("icons") or {}).get("2x") or "",
            "active_installs": p.get("active_installs", 0),
        }
        for p in plugins
        if p.get("slug")
    ]
