from app.ops.cf_ops import CFClient, _parallel, _parallel_batched


def update_firewall(
    log, dry_run: bool = False, domains: list[str] | None = None,
    preset: dict | None = None,
) -> list[dict]:
    """Re-applies the firewall ruleset (skip whitelist/bots/Google ASN,
    block everything else risky per the resolved preset) to zones.
    domains=None means "every zone the master token can see" - ported from
    cftasks.py --update-fw --all-zones, including its batching (tens of
    thousands of zones is the real scale here, see _parallel_batched).
    Passing an explicit domain list skips batching since that's always a
    small, deliberate set. preset: the preset-params dict (see
    firewall_preset_service.preset_to_params) plus "name" - "name" is
    echoed into every result row so which preset a job used is visible
    afterward (in the job log/result/CSV export) without anyone having had
    to check beforehand. Every caller (routers/jobs_cf.py) always resolves
    and passes this explicitly - see cf_ops.add_domains' docstring for why
    the hardcoded-fallback-dict pattern this used to have was removed."""
    assert preset is not None, "caller must resolve a preset (get_default_preset_params/preset_to_params)"
    cf = CFClient()

    def _one(domain):
        zone_id = cf.get_zone_id(domain)
        if not zone_id:
            log(f"[fail] {domain}: zone not found")
            return {"domain": domain, "status": "error", "note": "zone not found", "preset": preset["name"]}
        if dry_run:
            log(f"[dry-run] would apply firewall preset '{preset['name']}' to {domain} [{zone_id}]")
            return {"domain": domain, "status": "DRYRUN", "note": "no changes made", "preset": preset["name"]}
        ok, msg = cf.set_firewall_rules_result(zone_id, preset)
        if ok:
            log(f"[ ok ] {domain}: {msg}")
            return {"domain": domain, "status": "ok", "note": msg, "preset": preset["name"]}
        log(f"[fail] {domain}: {msg}")
        return {"domain": domain, "status": "error", "note": msg, "preset": preset["name"]}

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
