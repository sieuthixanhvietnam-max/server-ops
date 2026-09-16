/** Builds a grouped antd Select `options` list for picking a target CF
 * account: PIC-matched accounts (the auto-suggestion candidates) grouped
 * first, everything else below - so the picker is always fully browsable
 * even when there's no PIC match (new/unsynced server, or a PIC with zero
 * accounts assigned) instead of silently showing an empty dropdown. */
export function buildAccountSelectOptions(allAccounts: API.CfAccountOption[], suggestedPics: string[]) {
  const toOption = (a: API.CfAccountOption) => ({
    label: `${a.label} (${a.zone_count} zone)${a.pics.length ? ` [${a.pics.join(', ')}]` : ''}`,
    value: a.id,
  });

  if (!suggestedPics.length) {
    return [{ label: 'Tất cả account', options: allAccounts.map(toOption) }];
  }

  const matching = allAccounts.filter((a) => a.pics.some((p) => suggestedPics.includes(p)));
  const matchingIds = new Set(matching.map((a) => a.id));
  const rest = allAccounts.filter((a) => !matchingIds.has(a.id));

  const groups = [];
  if (matching.length) {
    groups.push({ label: `Gợi ý theo PIC ${suggestedPics.join(', ')}`, options: matching.map(toOption) });
  }
  groups.push({ label: matching.length ? 'Tất cả account khác' : 'Tất cả account', options: rest.map(toOption) });
  return groups;
}
