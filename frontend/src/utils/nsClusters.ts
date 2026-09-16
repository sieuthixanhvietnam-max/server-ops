export type NsCluster = {
  key: string;
  ns: string[];
  rows: API.CfAddResult[];
};

/** Groups add-domain results that ended up with the exact same nameserver
 * pair into one cluster - Cloudflare commonly hands out the same NS pair to
 * many zones, so showing it once per cluster instead of once per domain
 * line makes the result actually scannable for a batch of any size. */
export function buildNsClusters(results: API.CfAddResult[]): NsCluster[] {
  const withNs = results.filter((r) => r.nameservers && r.nameservers.length > 0);
  const map = new Map<string, NsCluster>();
  withNs.forEach((r) => {
    const key = [...r.nameservers].sort().join('|');
    if (!map.has(key)) map.set(key, { key, ns: r.nameservers, rows: [] });
    map.get(key)!.rows.push(r);
  });
  return Array.from(map.values()).sort((a, b) => b.rows.length - a.rows.length);
}
