// @ts-ignore
/* eslint-disable */

declare namespace API {
  type DomainItem = {
    id: number;
    domain: string;
    profile: string;
    provider: string;
    server_ip: string;
    server_name: string;
    source_updated: string | null;
  };

  type ServerItem = {
    id: number;
    server_name: string;
    ip: string;
    provider: string;
    profile: string;
    domains_count: number;
    source_updated: string | null;
    pics: string[];
    teams: string[];
    ssh_user: string | null;
    ssh_key_path: string | null;
  };

  type PagedResponse<T> = {
    data: T[];
    total: number;
    success: boolean;
  };

  type SyncStatus = {
    synced_at: string | null;
    next_synced_at: string | null;
    total_domains: number;
    total_servers: number;
    success: boolean;
    error_message?: string | null;
  };

  type DomainChangeItem = {
    id: number;
    event_type: 'added' | 'removed' | 'moved';
    domain: string;
    server_name: string;
    from_server_name: string | null;
    provider: string;
    profile: string;
    detected_at: string;
  };

  type DomainChangeSummary = {
    added: number;
    removed: number;
    moved: number;
    success: boolean;
  };

  type DomainChangeTimeseriesPoint = {
    period: string;
    label: string;
    added: number;
    removed: number;
    moved: number;
    net: number;
    total: number;
  };

  type DomainChangeHotspotServer = {
    server_name: string;
    added: number;
    removed: number;
    moved: number;
    total: number;
  };

  type DomainChangeHotspotPic = {
    pic: string;
    added: number;
    removed: number;
    moved: number;
    total: number;
  };

  type DomainChangeServerPair = {
    from_server_name: string;
    to_server_name: string;
    count: number;
  };

  type DomainChangeHotspots = {
    by_server: DomainChangeHotspotServer[];
    by_pic: DomainChangeHotspotPic[];
    server_pairs: DomainChangeServerPair[];
    success: boolean;
  };

  type JobStatus = 'pending' | 'running' | 'success' | 'failed';

  type JobDetail = {
    id: number;
    job_type: string;
    status: JobStatus;
    created_by: string;
    created_ip: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    params: Record<string, any>;
    log: string;
    // Typed as any[] so the 8 pages that render job.result as a specific
    // ResultRow[] keep working - but at runtime this is actually
    // any[] | Record<string, any>, since cf_master_discover returns a single
    // summary dict ({discovered, zones}) instead of a row list. Consumers
    // that need to handle both shapes (JobResultPanel) cast this themselves.
    result: any[];
    // Machine-readable reason for a "failed" job (e.g. "no_internet") -
    // lets the UI render a dedicated state instead of parsing `log` text.
    // null for jobs that never failed, or failed for an as-yet-unclassified
    // reason (falls back to the generic error display).
    fail_reason: string | null;
    // One row per (job, target label - e.g. a domain being migrated),
    // populated live as work proceeds - [] for job types that haven't
    // adopted this yet, or for list_jobs() rows (progress bars only matter
    // for the single job actually being watched). See JobProgressBar and
    // JobResultPanel's "render while running" branch.
    targets: JobTarget[];
  };

  type JobTargetStatus = 'pending' | 'running' | 'success' | 'failed';

  type JobTarget = {
    id: number;
    target_label: string;
    status: JobTargetStatus;
    started_at: string | null;
    finished_at: string | null;
    note: string;
  };

  type CheckIpResult = {
    domain: string;
    ip: string | null;
    proxied: boolean | null;
    status: 'ok' | 'skip' | 'error';
    note: string;
  };

  type CheckNsResult = {
    domain: string;
    status: 'active' | 'pending' | 'error';
    note: string;
    ns_cf: string[];
    ns_live: string[];
  };

  type CheckHealthResult = {
    server_name: string;
    ip: string;
    profile: string;
    status: 'OK' | 'WARN' | 'CRIT' | 'FAIL';
    note: string;
    uptime?: string;
    load?: string;
    cpu?: string;
    ram_pct?: string;
    disk_pct?: string;
    ols?: string;
    mariadb?: string;
    domains?: string;
  };

  /** Shared shape for every task's post-action outcome check (site actually
   * serving, redirect actually firing) - see backend/app/ops/verify_ops.py.
   * `gone` is used instead of `ok` by remove-wpsite, where the "good"
   * outcome is the site NOT responding anymore. */
  type VerifyInfo = {
    http_status: number;
    ok?: boolean;
    gone?: boolean;
    note: string;
  };

  type CloneWpsiteResult = {
    source: string;
    target: string;
    ip: string;
    status: 'OK' | 'FAIL' | 'DRYRUN';
    note: string;
    dns_status?: 'updated' | 'unchanged' | 'error';
    dns_note?: string;
    verify?: VerifyInfo;
  };

  type RemoveWpsiteResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'SKIP' | 'FAIL' | 'DRYRUN';
    note: string;
    verify?: VerifyInfo;
  };

  type MigrateWpsiteResult = {
    domain: string;
    source_ip: string;
    source_server?: string;
    dest_ip: string;
    status: 'OK' | 'PARTIAL' | 'FAIL' | 'DRYRUN';
    note: string;
    cf_dns?: string;
    verify?: VerifyInfo;
  };

  type ChangeWppassResult = {
    domain: string;
    ip: string;
    server_name: string;
    admin: string;
    status: 'OK' | 'FAIL' | 'DRYRUN';
    note: string;
    new_password?: string;
    verify?: VerifyInfo;
  };

  type SiteCredential = {
    id: number;
    domain: string;
    server_name: string;
    username: string;
    updated_at: string;
    updated_by: string;
  };

  type ChangelogEntry = {
    id: number;
    version: string;
    change_type: 'feature' | 'fix' | 'improvement' | 'security';
    title: string;
    description: string;
    created_at: string;
    created_by: string;
  };

  type CfAddResult = {
    domain: string;
    ip: string;
    status: 'added' | 'existing' | 'reconfigured' | 'error' | 'DRYRUN';
    note: string;
    nameservers: string[];
    zone_id?: string | null;
    account_label?: string | null;
    dns_status?: 'matches' | 'mismatch' | 'unknown' | null;
  };

  type CfRemoveResult = {
    domain: string;
    status: 'removed' | 'not_found' | 'error' | 'DRYRUN';
    note: string;
  };

  type CfChangeIpResult = {
    domain: string;
    status: 'updated' | 'error' | 'DRYRUN';
    note: string;
  };

  type CfOriginPortResult = {
    domain: string;
    status: 'ok' | 'error' | 'DRYRUN';
    note: string;
  };

  type SitemapCheck = {
    domain: string;
    sitemap_count: number;
    url_count: number;
    urls: string[];
    error: string | null;
  };

  type CfRedirectResult = {
    domain: string;
    target_url: string;
    mode: 'url_to_url' | 'url_to_homepage';
    status: 'created' | 'updated' | 'unchanged' | 'error' | 'DRYRUN';
    note: string;
    sitemap_check?: SitemapCheck;
    verify?: VerifyInfo;
  };

  type IndexerService = 'speedyindex' | 'instantindexer' | 'linksindexer' | 'ralfyindex';

  type IndexerCredentialItem = {
    service: IndexerService;
    configured: boolean;
    updated_at: string | null;
    updated_by: string;
  };

  type ForceIndexResult = {
    domain: string;
    url_count: number;
    status: 'OK' | 'DRYRUN' | 'FAIL' | 'SKIP';
    note: string;
    service: IndexerService;
  };

  type CfRedirectRemoveResult = {
    domain: string;
    status: 'removed' | 'none' | 'error' | 'DRYRUN';
    note: string;
    count: number;
  };

  type CfWhitelistIpItem = {
    id: number;
    label: string;
    ip: string;
    is_active: boolean;
    note: string;
    created_at: string;
  };

  type CfFirewallUpdateResult = {
    domain: string;
    status: 'ok' | 'error' | 'DRYRUN';
    note: string;
  };

  type CfAuditRedirectFinding = {
    domain: string;
    rule_count: number;
    issues: string;
    targets: string;
  };

  type CfRedirectInventoryRow = {
    domain: string;
    target: string;
    target_domain: string;
    code: number;
    zone_id: string;
  };

  type CfPurgeCacheResult = {
    domain: string;
    status: 'ok' | 'error' | 'DRYRUN';
    note: string;
  };

  type UserItem = {
    id: number;
    username: string;
    display_name: string;
    is_admin: boolean;
    is_active: boolean;
    created_at: string;
    last_login_at: string | null;
  };

  type AllowedIpItem = {
    id: number;
    label: string;
    ip: string;
    is_active: boolean;
    note: string;
    created_at: string;
  };

  type CfAccountItem = {
    id: number;
    label: string;
    email: string;
    cf_account_id: string | null;
    source: 'manual' | 'master';
    is_active: boolean;
    created_at: string;
    last_synced_at: string | null;
    last_sync_status: 'never' | 'ok' | 'error';
    last_sync_error: string | null;
    zone_count: number;
    pics: string[];
  };

  type CfZoneItem = {
    domain: string;
    match_status: 'both' | 'cf_only' | 'server_only';
    zone_id: string | null;
    zone_status: string | null;
    plan: string | null;
    cf_account_label: string | null;
    cf_account_id: number | null;
    cf_account_email: string | null;
    zone_count_on_domain: number;
    server_name: string | null;
    server_ip: string | null;
    server_count_on_domain: number;
  };

  type CfZonesSummary = {
    both: number;
    cf_only: number;
    server_only: number;
    total_zones: number;
    total_hosted_domains: number;
    success: boolean;
  };

  type DashboardSummary = {
    health: { OK: number; WARN: number; CRIT: number; FAIL: number; unknown: number };
    health_checked_at: string | null;
    health_next_at: string | null;
    jobs_failed_24h: number;
    cf_sync: { last_synced_at: string | null; next_at: string | null; error_count: number };
    admin?: { active_users: number; active_allowed_ips: number; ip_allowlist_enforced: boolean };
  };

  type CfAccountOption = {
    id: number;
    label: string;
    zone_count: number;
    pics: string[];
  };

  type CfZoneCheckResult = {
    has_zone: boolean;
    ns_status: 'active' | 'pending' | 'no_zone' | 'error';
    ns_cf: string[];
    ns_live: string[];
  };

  type PicItem = {
    id: number;
    code: string;
  };

  type PicSummaryItem = {
    pic: string;
    server_count: number;
    domain_count: number;
    cf_account_count: number;
    zone_count: number;
  };

  type PicUnassigned = {
    servers: { server_name: string; ip: string }[];
    accounts: { id: number; label: string; email: string }[];
    success: boolean;
  };

  type PicMismatchedDomain = {
    domain: string;
    server_name: string;
    server_pics: string[];
    cf_account_label: string | null;
    cf_account_id: number | null;
    cf_account_pics: string[];
  };

  type PluginItem = {
    name: string;
    status: string;
    version: string;
  };

  type PluginCheckResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'FAIL';
    plugins: PluginItem[];
    note: string;
  };

  type PluginToggleResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'PARTIAL' | 'FAIL' | 'DRYRUN';
    ok: string[];
    fail: string[];
    note: string;
    verify?: VerifyInfo;
  };

  type PluginZipItem = {
    id: number;
    label: string;
    filename: string;
    size_bytes: number;
    uploaded_by: string;
    created_at: string;
  };

  type ThemeZipItem = {
    id: number;
    label: string;
    filename: string;
    size_bytes: number;
    uploaded_by: string;
    created_at: string;
  };

  type MuPluginItem = {
    id: number;
    label: string;
    filename: string;
    size_bytes: number;
    uploaded_by: string;
    created_at: string;
  };

  type WpOrgPlugin = {
    slug: string;
    name: string;
    short_description: string;
    icon: string;
    active_installs: number;
  };

  type PluginUpdateResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'FAIL' | 'ROLLBACK' | 'SKIP' | 'DRYRUN';
    http_before: number | null;
    http_after: number | null;
    rolled_back: boolean;
    plugin_summary: string;
    core_summary: string;
    core_version: string | null;
    note: string;
  };

  type MaintenanceClearCacheResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'FAIL';
    note: string;
    verify?: VerifyInfo;
  };

  type MaintenanceClearCommentsResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'DRYRUN' | 'FAIL';
    comment_count: number;
    note: string;
  };

  type MaintenanceFixPermissionsResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'PARTIAL' | 'DRYRUN' | 'FAIL';
    before: number;
    after: number;
    note: string;
    verify?: VerifyInfo;
  };

  type MaintenanceCleanJunkResult = {
    domain: string;
    ip: string;
    status: 'OK' | 'DRYRUN' | 'FAIL';
    freed_kb: number;
    note: string;
  };

  type BackupCatalogRow = {
    server_name: string;
    domain: string;
    date: string;
    size_bytes: number;
  };

  type RestoreWpsiteResult = {
    domain: string;
    status: 'OK' | 'DRYRUN' | 'FAIL';
    date_used?: string | null;
    listing?: string[];
    db_name?: string;
    table_count?: string;
    siteurl?: string;
    note: string;
    verify?: VerifyInfo;
  };

  type PicSuggestCfAccount = {
    matched_server: string | null;
    pics: string[];
    candidates: { id: number; label: string; zone_count: number }[];
    suggested_account_id: number | null;
    success: boolean;
  };
}
