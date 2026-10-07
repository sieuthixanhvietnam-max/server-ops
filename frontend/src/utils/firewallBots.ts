/** Quick-add presets for the Firewall template editor's "blocked bot
 * user-agents" field - the common SEO/backlink crawlers site owners in
 * this niche actually want blocked (their real UA strings all contain
 * "Mozilla", so the generic non-browser-UA rule never catches them - see
 * models.CfFirewallTemplate's docstring). Free-text entry still covers
 * anything not in this list; these are just one-click shortcuts for the
 * cases that come up over and over. */
export const COMMON_BOT_PRESETS: { label: string; value: string }[] = [
  { label: 'AhrefsBot', value: 'ahrefsbot' },
  { label: 'MJ12bot (Majestic)', value: 'mj12bot' },
  { label: 'SemrushBot', value: 'semrushbot' },
  { label: 'DotBot (Moz)', value: 'dotbot' },
  { label: 'BLEXBot', value: 'blexbot' },
  { label: 'SerpstatBot', value: 'serpstatbot' },
  { label: 'DataForSeoBot', value: 'dataforseobot' },
];
