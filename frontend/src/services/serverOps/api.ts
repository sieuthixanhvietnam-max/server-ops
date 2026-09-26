// @ts-ignore
/* eslint-disable */
import { request } from '@umijs/max';

/** GET /api/domains */
export async function listDomains(
  params: {
    current?: number;
    pageSize?: number;
    domain?: string;
    domains?: string;
    provider?: string;
    server_name?: string;
    profile?: string;
    pic?: string;
    duplicates_only?: boolean;
    sort_field?: string;
    sort_order?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.DomainItem>>('/api/domains', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/domains/providers */
export async function listDomainProviders(options?: { [key: string]: any }) {
  return request<{ data: string[]; success: boolean }>('/api/domains/providers', {
    method: 'GET',
    ...(options || {}),
  });
}

/** GET /api/domains/profiles */
export async function listDomainProfiles(options?: { [key: string]: any }) {
  return request<{ data: string[]; success: boolean }>('/api/domains/profiles', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/domains/exists-batch */
export async function checkDomainsExistBatch(domains: string[], options?: { [key: string]: any }) {
  return request<{ data: Record<string, boolean>; success: boolean }>('/api/domains/exists-batch', {
    method: 'POST',
    data: { domains },
    ...(options || {}),
  });
}

/** GET /api/servers */
export async function listServers(
  params: {
    current?: number;
    pageSize?: number;
    server_name?: string;
    server_names?: string;
    provider?: string;
    profile?: string;
    pic?: string;
    sort_field?: string;
    sort_order?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.ServerItem>>('/api/servers', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/servers/profiles */
export async function listServerProfiles(options?: { [key: string]: any }) {
  return request<{ data: string[]; success: boolean }>('/api/servers/profiles', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/sync/trigger */
export async function triggerSync(options?: { [key: string]: any }) {
  return request<API.SyncStatus>('/api/sync/trigger', {
    method: 'POST',
    ...(options || {}),
  });
}

/** GET /api/sync/status */
export async function getSyncStatus(options?: { [key: string]: any }) {
  return request<API.SyncStatus>('/api/sync/status', {
    method: 'GET',
    ...(options || {}),
  });
}

/** GET /api/domains/changes */
export async function listDomainChanges(
  params: {
    current?: number;
    pageSize?: number;
    event_type?: 'added' | 'removed';
    domain?: string;
    provider?: string;
    server_name?: string;
    profile?: string;
    pic?: string;
    date_from?: string;
    date_to?: string;
    sort_field?: string;
    sort_order?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.DomainChangeItem>>('/api/domains/changes', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/domains/changes/summary */
export async function getDomainChangesSummary(
  params?: { date_from?: string; date_to?: string },
  options?: { [key: string]: any },
) {
  return request<API.DomainChangeSummary>('/api/domains/changes/summary', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/domains/changes/timeseries */
export async function getDomainChangesTimeseries(
  params: {
    granularity: 'day' | 'week' | 'month' | 'quarter' | 'year';
    date_from?: string;
    date_to?: string;
    domain?: string;
    provider?: string;
    server_name?: string;
    profile?: string;
    pic?: string;
  },
  options?: { [key: string]: any },
) {
  return request<{ data: API.DomainChangeTimeseriesPoint[]; success: boolean }>(
    '/api/domains/changes/timeseries',
    {
      method: 'GET',
      params,
      ...(options || {}),
    },
  );
}

/** GET /api/domains/changes/hotspots */
export async function getDomainChangesHotspots(
  params?: { date_from?: string; date_to?: string; provider?: string; profile?: string; limit?: number },
  options?: { [key: string]: any },
) {
  return request<API.DomainChangeHotspots>('/api/domains/changes/hotspots', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** POST /api/jobs/check-ip */
export async function triggerCheckIp(domains: string[], options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/check-ip', {
    method: 'POST',
    data: { domains },
    ...(options || {}),
  });
}

/** POST /api/jobs/check-ns */
export async function triggerCheckNs(domains: string[], options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/check-ns', {
    method: 'POST',
    data: { domains },
    ...(options || {}),
  });
}

/** POST /api/jobs/check-health */
export async function triggerCheckHealth(
  server_names: string[] | undefined,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/check-health', {
    method: 'POST',
    data: { server_names },
    ...(options || {}),
  });
}

/** GET /api/jobs */
export async function listJobs(
  params: {
    current?: number;
    pageSize?: number;
    job_type?: string;
    status?: string;
    created_by?: string;
    created_ip?: string;
    date_from?: string;
    date_to?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.JobDetail>>('/api/jobs', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/jobs/reports/redirect-weekly */
export async function getRedirectWeeklyReport(
  params?: { weeks?: number },
  options?: { [key: string]: any },
) {
  return request<{ data: API.RedirectWeeklyItem[]; success: boolean }>(
    '/api/jobs/reports/redirect-weekly',
    {
      method: 'GET',
      params,
      ...(options || {}),
    },
  );
}

/** GET /api/jobs/{id} */
export async function getJob(jobId: number, options?: { [key: string]: any }) {
  return request<API.JobDetail>(`/api/jobs/${jobId}`, {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/jobs/clone-wpsite */
export async function triggerCloneWpsite(
  pairs: { source: string; target: string; source_server?: string }[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/clone-wpsite', {
    method: 'POST',
    data: { pairs, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/create-wpsite */
export async function triggerCreateWpsite(
  source: string,
  source_server: string,
  targets: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/create-wpsite', {
    method: 'POST',
    data: { source, source_server, targets, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/remove-wpsite */
export async function triggerRemoveWpsite(
  domains: string[],
  dry_run: boolean,
  server_names?: Record<string, string>,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/remove-wpsite', {
    method: 'POST',
    data: { domains, dry_run, server_names },
    ...(options || {}),
  });
}

/** POST /api/jobs/migrate-wpsite */
export async function triggerMigrateWpsite(
  entries: { domain: string; source_server?: string; dest_server: string }[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/migrate-wpsite', {
    method: 'POST',
    data: { entries, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/change-wppass */
export async function triggerChangeWppass(
  domains: { domain: string; server_name?: string }[],
  custom_password: string | undefined,
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/change-wppass', {
    method: 'POST',
    data: { domains, custom_password, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-add */
export async function triggerCfAdd(
  domains: string[],
  ip: string,
  dry_run: boolean,
  cf_account_id?: number,
  force_reconfigure?: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-add', {
    method: 'POST',
    data: { domains, ip, dry_run, cf_account_id, force_reconfigure },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-add-batch - one job for several (domains, ip, cf_account_id)
 * groups at once (e.g. one per PIC), instead of one job per group. */
export async function triggerCfAddBatch(
  groups: { domains: string[]; ip: string; cf_account_id?: number }[],
  dry_run: boolean,
  force_reconfigure?: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-add-batch', {
    method: 'POST',
    data: { groups, dry_run, force_reconfigure },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-remove */
export async function triggerCfRemove(
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-remove', {
    method: 'POST',
    data: { domains, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-change-ip */
export async function triggerCfChangeIp(
  domains: string[],
  new_ip: string,
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-change-ip', {
    method: 'POST',
    data: { domains, new_ip, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-origin-port */
export async function triggerCfOriginPort(
  domains: string[],
  action: 'set' | 'clear',
  port: number,
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-origin-port', {
    method: 'POST',
    data: { domains, action, port, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-redirect */
export async function triggerCfRedirect(
  mappings: { domain: string; target_url: string; mode: 'url_to_url' | 'url_to_homepage' }[],
  dry_run: boolean,
  crawl_sitemap: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-redirect', {
    method: 'POST',
    data: { mappings, dry_run, crawl_sitemap },
    ...(options || {}),
  });
}

/** POST /api/jobs/crawl-sitemap */
export async function triggerCrawlSitemap(domains: string[], options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/crawl-sitemap', {
    method: 'POST',
    data: { domains },
    ...(options || {}),
  });
}

/** POST /api/jobs/force-index */
export async function triggerForceIndex(
  service: API.IndexerService,
  entries: { domain: string; urls: string[] }[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/force-index', {
    method: 'POST',
    data: { service, entries, dry_run },
    ...(options || {}),
  });
}

/** GET /api/settings/indexer-credentials */
export async function listIndexerCredentials(options?: { [key: string]: any }) {
  return request<{ data: API.IndexerCredentialItem[]; success: boolean }>(
    '/api/settings/indexer-credentials',
    { method: 'GET', ...(options || {}) },
  );
}

/** PUT /api/settings/indexer-credentials/{service} */
export async function setIndexerCredential(
  service: API.IndexerService,
  api_key: string,
  options?: { [key: string]: any },
) {
  return request<{ data: API.IndexerCredentialItem; success: boolean }>(
    `/api/settings/indexer-credentials/${service}`,
    { method: 'PUT', data: { api_key }, ...(options || {}) },
  );
}

/** DELETE /api/settings/indexer-credentials/{service} */
export async function deleteIndexerCredential(service: API.IndexerService, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/settings/indexer-credentials/${service}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** GET /api/cf-accounts */
export async function listCfAccounts(
  params: {
    current?: number;
    pageSize?: number;
    email?: string;
    label?: string;
    source?: 'manual' | 'master';
    last_sync_status?: 'never' | 'ok' | 'error';
    is_active?: boolean;
    pic?: string;
    sort_field?: string;
    sort_order?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.CfAccountItem>>('/api/cf-accounts', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/cf-accounts/options */
export async function listCfAccountOptions(options?: { [key: string]: any }) {
  return request<{ data: API.CfAccountOption[]; success: boolean }>('/api/cf-accounts/options', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/cf-accounts */
export async function createCfAccount(
  body: { label: string; email: string; api_token: string; cf_account_id?: string },
  options?: { [key: string]: any },
) {
  return request<API.CfAccountItem>('/api/cf-accounts', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/** POST /api/cf-accounts/bulk-import */
export async function bulkImportCfAccounts(
  accounts: { label: string; email: string; api_token: string; cf_account_id?: string }[],
  options?: { [key: string]: any },
) {
  return request<{ created: number; errors: string[]; success: boolean }>(
    '/api/cf-accounts/bulk-import',
    {
      method: 'POST',
      data: { accounts },
      ...(options || {}),
    },
  );
}

/** POST /api/cf-accounts/{id}/test */
export async function testCfAccount(id: number, options?: { [key: string]: any }) {
  return request<{ valid: boolean; note: string }>(`/api/cf-accounts/${id}/test`, {
    method: 'POST',
    ...(options || {}),
  });
}

/** DELETE /api/cf-accounts/{id} */
export async function deleteCfAccount(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/cf-accounts/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** GET /api/allowed-ips/whoami */
export async function whoamiAllowedIp(options?: { [key: string]: any }) {
  return request<{ ip: string; allowed: boolean; enforced: boolean }>('/api/allowed-ips/whoami', {
    method: 'GET',
    ...(options || {}),
  });
}

/** GET /api/allowed-ips */
export async function listAllowedIps(
  params: { current?: number; pageSize?: number; label?: string; is_active?: boolean },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.AllowedIpItem> & { enforced: boolean }>('/api/allowed-ips', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** POST /api/allowed-ips */
export async function createAllowedIp(
  body: { label: string; ip: string; note?: string },
  options?: { [key: string]: any },
) {
  return request<API.AllowedIpItem>('/api/allowed-ips', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/** PUT /api/allowed-ips/{id} */
export async function updateAllowedIp(
  id: number,
  body: { label?: string; ip?: string; note?: string; is_active?: boolean },
  options?: { [key: string]: any },
) {
  return request<API.AllowedIpItem>(`/api/allowed-ips/${id}`, {
    method: 'PUT',
    data: body,
    ...(options || {}),
  });
}

/** DELETE /api/allowed-ips/{id} */
export async function deleteAllowedIp(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/allowed-ips/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** GET /api/dashboard/summary */
export async function getDashboardSummary(options?: { [key: string]: any }) {
  return request<{ data: API.DashboardSummary; success: boolean }>('/api/dashboard/summary', {
    method: 'GET',
    ...(options || {}),
  });
}

/** GET /api/users */
export async function listUsers(options?: { [key: string]: any }) {
  return request<{ data: API.UserItem[]; success: boolean }>('/api/users', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/users */
export async function createUser(
  body: { username: string; display_name?: string; is_admin?: boolean; password?: string },
  options?: { [key: string]: any },
) {
  return request<{ user: API.UserItem; password: string }>('/api/users', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/** PATCH /api/users/{id} */
export async function updateUser(id: number, display_name: string, options?: { [key: string]: any }) {
  return request<{ data: API.UserItem; success: boolean }>(`/api/users/${id}`, {
    method: 'PATCH',
    data: { display_name },
    ...(options || {}),
  });
}

/** DELETE /api/users/{id} */
export async function deleteUser(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/users/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** POST /api/users/{id}/reset-password */
export async function resetUserPassword(
  id: number,
  password: string | undefined,
  options?: { [key: string]: any },
) {
  return request<{ password: string }>(`/api/users/${id}/reset-password`, {
    method: 'POST',
    data: { password },
    ...(options || {}),
  });
}

/** POST /api/users/{id}/active */
export async function setUserActive(id: number, is_active: boolean, options?: { [key: string]: any }) {
  return request<{ data: API.UserItem; success: boolean }>(`/api/users/${id}/active`, {
    method: 'POST',
    data: { is_active },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-redirect-remove */
export async function triggerCfRedirectRemove(
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-redirect-remove', {
    method: 'POST',
    data: { domains, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-firewall-update */
export async function triggerCfFirewallUpdate(
  mode: 'domains' | 'all_zones',
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-firewall-update', {
    method: 'POST',
    data: { mode, domains, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-audit-redirects */
export async function triggerCfAuditRedirects(options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/cf-audit-redirects', {
    method: 'POST',
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-redirect-inventory */
export async function triggerCfRedirectInventory(options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/cf-redirect-inventory', {
    method: 'POST',
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-purge-cache */
export async function triggerCfPurgeCache(
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-purge-cache', {
    method: 'POST',
    data: { domains, dry_run },
    ...(options || {}),
  });
}

/** GET /api/cf-whitelist-ips */
export async function listCfWhitelistIps(
  params: { current?: number; pageSize?: number; label?: string; is_active?: boolean },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.CfWhitelistIpItem>>('/api/cf-whitelist-ips', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** POST /api/cf-whitelist-ips */
export async function createCfWhitelistIp(
  body: { label?: string; ip: string; note?: string },
  options?: { [key: string]: any },
) {
  return request<API.CfWhitelistIpItem>('/api/cf-whitelist-ips', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/** PUT /api/cf-whitelist-ips/{id} */
export async function updateCfWhitelistIp(
  id: number,
  body: { label?: string; ip?: string; note?: string; is_active?: boolean },
  options?: { [key: string]: any },
) {
  return request<API.CfWhitelistIpItem>(`/api/cf-whitelist-ips/${id}`, {
    method: 'PUT',
    data: body,
    ...(options || {}),
  });
}

/** DELETE /api/cf-whitelist-ips/{id} */
export async function deleteCfWhitelistIp(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/cf-whitelist-ips/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-accounts-sync */
export async function triggerCfAccountsSync(
  account_id?: number,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/cf-accounts-sync', {
    method: 'POST',
    params: account_id ? { account_id } : undefined,
    ...(options || {}),
  });
}

/** POST /api/jobs/cf-master-discover */
export async function triggerCfMasterDiscover(options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/cf-master-discover', {
    method: 'POST',
    ...(options || {}),
  });
}

/** GET /api/cf-zones */
export async function listCfZones(
  params: {
    current?: number;
    pageSize?: number;
    domain?: string;
    domains?: string;
    account_id?: number;
    match_status?: 'both' | 'cf_only' | 'server_only';
    plan?: string;
    zone_status?: string;
    pic?: string;
    sort_field?: string;
    sort_order?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.CfZoneItem>>('/api/cf-zones', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** GET /api/cf-zones/summary */
export async function getCfZonesSummary(options?: { [key: string]: any }) {
  return request<API.CfZonesSummary>('/api/cf-zones/summary', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/cf-zones/check-batch */
export async function checkCfZonesBatch(domains: string[], options?: { [key: string]: any }) {
  return request<{ data: Record<string, API.CfZoneCheckResult>; success: boolean }>(
    '/api/cf-zones/check-batch',
    {
      method: 'POST',
      data: { domains },
      ...(options || {}),
    },
  );
}

/** GET /api/pics */
export async function listPics(options?: { [key: string]: any }) {
  return request<{ data: API.PicItem[]; success: boolean }>('/api/pics', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/pics */
export async function createPic(code: string, options?: { [key: string]: any }) {
  return request<API.PicItem>('/api/pics', {
    method: 'POST',
    data: { code },
    ...(options || {}),
  });
}

/** GET /api/pics/summary */
export async function getPicSummary(options?: { [key: string]: any }) {
  return request<{ data: API.PicSummaryItem[]; success: boolean }>('/api/pics/summary', {
    method: 'GET',
    ...(options || {}),
  });
}

/** GET /api/pics/unassigned */
export async function getPicUnassigned(options?: { [key: string]: any }) {
  return request<API.PicUnassigned>('/api/pics/unassigned', {
    method: 'GET',
    ...(options || {}),
  });
}

/** GET /api/pics/mismatched-domains */
export async function getPicMismatchedDomains(
  params: { current?: number; pageSize?: number },
  options?: { [key: string]: any },
) {
  return request<API.PagedResponse<API.PicMismatchedDomain>>('/api/pics/mismatched-domains', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

/** POST /api/pics/suggest */
export async function suggestPics(options?: { [key: string]: any }) {
  return request<{ new_server_links: number; new_account_links: number; success: boolean }>(
    '/api/pics/suggest',
    {
      method: 'POST',
      ...(options || {}),
    },
  );
}

/** PUT /api/pics/servers/{server_name} */
export async function setServerPics(
  server_name: string,
  pic_codes: string[],
  options?: { [key: string]: any },
) {
  return request<{ server_name: string; pic_codes: string[]; success: boolean }>(
    `/api/pics/servers/${encodeURIComponent(server_name)}`,
    {
      method: 'PUT',
      data: { pic_codes },
      ...(options || {}),
    },
  );
}

/** PUT /api/pics/cf-accounts/{account_id} */
export async function setAccountPics(
  account_id: number,
  pic_codes: string[],
  options?: { [key: string]: any },
) {
  return request<{ account_id: number; pic_codes: string[]; success: boolean }>(
    `/api/pics/cf-accounts/${account_id}`,
    {
      method: 'PUT',
      data: { pic_codes },
      ...(options || {}),
    },
  );
}

/** POST /api/jobs/plugin-check */
export async function triggerPluginCheck(domains: string[], options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/plugin-check', {
    method: 'POST',
    data: { domains },
    ...(options || {}),
  });
}

/** POST /api/jobs/plugin-deactivate */
export async function triggerPluginDeactivate(
  domains: string[],
  plugins: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/plugin-deactivate', {
    method: 'POST',
    data: { domains, plugins, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/plugin-activate */
export async function triggerPluginActivate(
  domains: string[],
  plugins: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/plugin-activate', {
    method: 'POST',
    data: { domains, plugins, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/plugin-install-wp */
export async function triggerPluginInstallWp(
  domains: string[],
  slugs: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/plugin-install-wp', {
    method: 'POST',
    data: { domains, slugs, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/plugin-update */
export async function triggerPluginUpdate(
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/plugin-update', {
    method: 'POST',
    data: { domains, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/plugin-install-zip */
export async function triggerPluginInstallZip(
  domains: string[],
  zip_ids: number[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/plugin-install-zip', {
    method: 'POST',
    data: { domains, zip_ids, dry_run },
    ...(options || {}),
  });
}

/** GET /api/plugin-zips */
export async function listPluginZips(options?: { [key: string]: any }) {
  return request<{ data: API.PluginZipItem[]; success: boolean }>('/api/plugin-zips', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/plugin-zips (multipart) */
export async function uploadPluginZip(label: string, file: File, options?: { [key: string]: any }) {
  const formData = new FormData();
  formData.append('label', label);
  formData.append('file', file);
  return request<API.PluginZipItem>('/api/plugin-zips', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  });
}

/** DELETE /api/plugin-zips/{id} */
export async function deletePluginZip(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/plugin-zips/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** POST /api/jobs/theme-install-zip */
export async function triggerThemeInstallZip(
  domains: string[],
  zip_ids: number[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/theme-install-zip', {
    method: 'POST',
    data: { domains, zip_ids, dry_run },
    ...(options || {}),
  });
}

/** GET /api/theme-zips */
export async function listThemeZips(options?: { [key: string]: any }) {
  return request<{ data: API.ThemeZipItem[]; success: boolean }>('/api/theme-zips', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/theme-zips (multipart) */
export async function uploadThemeZip(label: string, file: File, options?: { [key: string]: any }) {
  const formData = new FormData();
  formData.append('label', label);
  formData.append('file', file);
  return request<API.ThemeZipItem>('/api/theme-zips', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  });
}

/** DELETE /api/theme-zips/{id} */
export async function deleteThemeZip(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/theme-zips/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** POST /api/jobs/mu-plugin-install */
export async function triggerMuPluginInstall(
  domains: string[],
  mu_plugin_id: number,
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/mu-plugin-install', {
    method: 'POST',
    data: { domains, mu_plugin_id, dry_run },
    ...(options || {}),
  });
}

/** GET /api/mu-plugins */
export async function listMuPlugins(options?: { [key: string]: any }) {
  return request<{ data: API.MuPluginItem[]; success: boolean }>('/api/mu-plugins', {
    method: 'GET',
    ...(options || {}),
  });
}

/** POST /api/mu-plugins (multipart) */
export async function uploadMuPlugin(label: string, file: File, options?: { [key: string]: any }) {
  const formData = new FormData();
  formData.append('label', label);
  formData.append('file', file);
  return request<API.MuPluginItem>('/api/mu-plugins', {
    method: 'POST',
    data: formData,
    ...(options || {}),
  });
}

/** DELETE /api/mu-plugins/{id} */
export async function deleteMuPlugin(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/mu-plugins/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** GET /api/wp-org/search-plugins */
export async function searchWpOrgPlugins(q: string, options?: { [key: string]: any }) {
  return request<{ data: API.WpOrgPlugin[]; success: boolean }>('/api/wp-org/search-plugins', {
    method: 'GET',
    params: { q },
    ...(options || {}),
  });
}

/** POST /api/jobs/maintenance-clear-cache */
export async function triggerMaintenanceClearCache(domains: string[], options?: { [key: string]: any }) {
  return request<{ job_id: number }>('/api/jobs/maintenance-clear-cache', {
    method: 'POST',
    data: { domains },
    ...(options || {}),
  });
}

/** POST /api/jobs/maintenance-clear-comments */
export async function triggerMaintenanceClearComments(
  domains: string[],
  disable_new: boolean,
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/maintenance-clear-comments', {
    method: 'POST',
    data: { domains, disable_new, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/maintenance-fix-permissions */
export async function triggerMaintenanceFixPermissions(
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/maintenance-fix-permissions', {
    method: 'POST',
    data: { domains, dry_run },
    ...(options || {}),
  });
}

/** POST /api/jobs/maintenance-clean-junk */
export async function triggerMaintenanceCleanJunk(
  domains: string[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/maintenance-clean-junk', {
    method: 'POST',
    data: { domains, dry_run },
    ...(options || {}),
  });
}

/** GET /api/backups */
export async function listBackupCatalog(refresh?: boolean, options?: { [key: string]: any }) {
  return request<{ data: API.BackupCatalogRow[]; fetched_at: string; success: boolean }>('/api/backups', {
    method: 'GET',
    params: { refresh: refresh || undefined },
    ...(options || {}),
  });
}

/** POST /api/jobs/restore-wpsite */
export async function triggerRestoreWpsite(
  destination_server: string,
  entries: { domain: string; source_server: string; date?: string }[],
  dry_run: boolean,
  options?: { [key: string]: any },
) {
  return request<{ job_id: number }>('/api/jobs/restore-wpsite', {
    method: 'POST',
    data: { destination_server, entries, dry_run },
    ...(options || {}),
  });
}

/** GET /api/pics/suggest-cf-account */
export async function suggestCfAccount(ip: string, options?: { [key: string]: any }) {
  return request<API.PicSuggestCfAccount>('/api/pics/suggest-cf-account', {
    method: 'GET',
    params: { ip },
    ...(options || {}),
  });
}

/** GET /api/site-credentials - every stored (domain, server_name) credential,
 * password never included (see revealSiteCredential). */
export async function listSiteCredentials(options?: { [key: string]: any }) {
  return request<{ data: API.SiteCredential[]; success: boolean }>('/api/site-credentials', {
    method: 'GET',
    ...(options || {}),
  });
}

/** PUT /api/site-credentials - creates or overwrites the (domain, server_name) row. */
export async function setSiteCredential(
  domain: string,
  server_name: string,
  username: string,
  password: string,
  options?: { [key: string]: any },
) {
  return request<{ data: API.SiteCredential; success: boolean }>('/api/site-credentials', {
    method: 'PUT',
    data: { domain, server_name, username, password },
    ...(options || {}),
  });
}

/** GET /api/site-credentials/:id/reveal - decrypts on demand, only called
 * when the user explicitly clicks "Hiện mật khẩu". */
export async function revealSiteCredential(id: number, options?: { [key: string]: any }) {
  return request<{ password: string; success: boolean }>(`/api/site-credentials/${id}/reveal`, {
    method: 'GET',
    ...(options || {}),
  });
}

export async function deleteSiteCredential(id: number, options?: { [key: string]: any }) {
  return request<{ success: boolean }>(`/api/site-credentials/${id}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** GET /api/changelog - full history, newest first. The first row is the
 * "current version" wherever that's shown. */
export async function listChangelog(options?: { [key: string]: any }) {
  return request<{ data: API.ChangelogEntry[]; success: boolean }>('/api/changelog', {
    method: 'GET',
    ...(options || {}),
  });
}

export async function createChangelogEntry(
  version: string,
  change_type: API.ChangelogEntry['change_type'],
  title: string,
  description: string,
  options?: { [key: string]: any },
) {
  return request<{ data: API.ChangelogEntry; success: boolean }>('/api/changelog', {
    method: 'POST',
    data: { version, change_type, title, description },
    ...(options || {}),
  });
}

