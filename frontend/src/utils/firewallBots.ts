/** Quick-add presets for the Firewall Preset editor's "blocked bot
 * user-agents" field - the common SEO/backlink crawlers site owners in
 * this niche actually want blocked (their real UA strings all contain
 * "Mozilla", so the generic non-browser-UA rule never catches them - see
 * models.FirewallPreset's docstring). Free-text entry still covers
 * anything not in this list; these are just one-click shortcuts for the
 * cases that come up over and over.
 *
 * Every entry below crawls the open web automatically for a commercial
 * backlink/SEO database - no relationship to any specific site owner, so
 * blocking them site-wide is always safe. Deliberately excludes bots that
 * a site owner/agency runs ON-DEMAND against their OWN site to audit it
 * (Botify, JetOctopus, Lumar/DeepCrawl, Rogerbot, Screaming Frog,
 * Sitebulb) - confirmed with the team 2026-10-08 that nobody here uses
 * those against domains hosted on this system, so they're safe too, but
 * if that ever changes for a specific domain, DON'T add them here (this
 * list applies to every preset) - block them on that one preset/domain
 * instead. SeobilityBot stayed out entirely - unclear whether its
 * backlink-crawler and on-demand-audit features share one bot or two, not
 * verified either way. */
export const COMMON_BOT_PRESETS: { label: string; value: string }[] = [
  { label: 'AhrefsBot', value: 'ahrefsbot' },
  { label: 'MJ12bot (Majestic)', value: 'mj12bot' },
  { label: 'SemrushBot', value: 'semrushbot' },
  { label: 'DotBot (Moz)', value: 'dotbot' },
  { label: 'BLEXBot', value: 'blexbot' },
  { label: 'SerpstatBot', value: 'serpstatbot' },
  { label: 'DataForSeoBot', value: 'dataforseobot' },
  { label: 'Barkrowler (Babbar)', value: 'barkrowler' },
  { label: 'SEOkicks', value: 'seokicks' },
  { label: 'spbot (OpenLinkProfiler)', value: 'spbot' },
  { label: 'Botify', value: 'botify' },
  { label: 'JetOctopus', value: 'jetoctopus' },
  { label: 'LumarBot (DeepCrawl)', value: 'lumar' },
  // Older Lumar/DeepCrawl deployments still send the legacy UA token
  // instead of "lumar" - separate entry so either can be picked without
  // forcing both into every preset that just wants the current one.
  { label: 'DeepCrawl (legacy Lumar UA)', value: 'deepcrawl' },
  { label: 'Rogerbot (Moz)', value: 'rogerbot' },
  { label: 'Screaming Frog SEO Spider', value: 'screaming frog' },
  { label: 'SitebulbBot', value: 'sitebulb' },
];
