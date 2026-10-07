from datetime import datetime

from sqlalchemy import Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.db_types import UTCDateTime


class Domain(Base):
    __tablename__ = "domains"
    __table_args__ = (UniqueConstraint("domain", "server_name", name="uq_domain_server"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain: Mapped[str] = mapped_column(String, index=True)
    profile: Mapped[str] = mapped_column(String, index=True)
    provider: Mapped[str] = mapped_column(String, index=True)
    server_ip: Mapped[str] = mapped_column(String, index=True)
    server_name: Mapped[str] = mapped_column(String, index=True)
    # Parsed from the sync source's raw "updated" string (assumed UTC, no tz
    # marker of its own - see sync_service._parse_source_updated) so it
    # round-trips through UTCDateTime and displays correctly client-side,
    # same as every other timestamp in this app.
    source_updated: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    server_name: Mapped[str] = mapped_column(String, unique=True, index=True)
    # Health is never computed on page load (too expensive to SSH-fan-out on
    # every dashboard visit) - these hold whatever the last check_health run
    # found, whether that was the periodic background sweep (main.py) or a
    # manual "Kiểm tra sức khoẻ" trigger (both call health_service.
    # persist_health_results so neither path leaves the other's data stale).
    last_health_status: Mapped[str | None] = mapped_column(String, nullable=True)
    last_health_note: Mapped[str] = mapped_column(String, default="")
    last_health_checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    ip: Mapped[str] = mapped_column(String, index=True)
    provider: Mapped[str] = mapped_column(String, index=True)
    profile: Mapped[str] = mapped_column(String, index=True)
    domains_count: Mapped[int] = mapped_column(Integer, default=0)
    # Parsed from the sync source's raw "updated" string (assumed UTC, no tz
    # marker of its own - see sync_service._parse_source_updated) so it
    # round-trips through UTCDateTime and displays correctly client-side,
    # same as every other timestamp in this app.
    source_updated: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(UTCDateTime())
    total_domains: Mapped[int] = mapped_column(Integer, default=0)
    total_servers: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(default=True)
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)


class DomainChangeLog(Base):
    __tablename__ = "domain_change_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type: Mapped[str] = mapped_column(String, index=True)  # "added" | "removed" | "moved"
    domain: Mapped[str] = mapped_column(String, index=True)
    server_name: Mapped[str] = mapped_column(String, index=True)
    # Only set for event_type "moved" - the server the domain moved FROM in
    # the same sync cycle it moved TO server_name. See _diff_and_log_domains.
    from_server_name: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String, index=True)
    profile: Mapped[str] = mapped_column(String)
    detected_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)


class CfAccount(Base):
    """One Cloudflare account credential (the org manages hundreds of these,
    each fully independent - a token from one cannot see another's zones)."""

    __tablename__ = "cf_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, default="", index=True)
    cf_account_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Null when source="master" - those accounts are synced with the shared
    # settings.cf_api_token (which this org's master email has "All
    # accounts" access with) instead of a per-account token.
    api_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, default="manual")  # manual|master
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_sync_status: Mapped[str] = mapped_column(String, default="never")  # never|ok|error
    last_sync_error: Mapped[str | None] = mapped_column(String, nullable=True)
    zone_count: Mapped[int] = mapped_column(Integer, default=0)


class IndexerCredential(Base):
    """One API key for a URL-indexing service (SpeedyIndex/InstantIndexer/
    LinksIndexer/RalfyIndex). Stored in the DB (encrypted, same Fernet key
    as CfAccount) instead of .env so it can be rotated from Settings without
    a redeploy - these are third-party paid subscriptions the vendor can
    change/expire independent of this app's release cycle."""

    __tablename__ = "indexer_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service: Mapped[str] = mapped_column(String, unique=True, index=True)
    api_key_encrypted: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
    updated_by: Mapped[str] = mapped_column(String, default="")


class SiteCredential(Base):
    """WordPress admin username/password for one site, keyed by (domain,
    server_name) rather than domain alone - a domain deployed identically on
    every server (e.g. a blank WP template like site-trang.com) is actually
    N independent installs, each with its own credentials. Auto-saved by
    change_wppass on every successful real run (see
    site_credentials_service.persist_site_credentials); can also be entered
    by hand for a password that was never changed through this app.
    Password stored encrypted, same Fernet key as CfAccount/IndexerCredential."""

    __tablename__ = "site_credentials"
    __table_args__ = (UniqueConstraint("domain", "server_name", name="uq_site_credentials_domain_server"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain: Mapped[str] = mapped_column(String, index=True)
    server_name: Mapped[str] = mapped_column(String, index=True)
    username: Mapped[str] = mapped_column(String)
    password_encrypted: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
    updated_by: Mapped[str] = mapped_column(String, default="")


class CfZone(Base):
    """A single Cloudflare zone as last seen when syncing its owning
    CfAccount. Replaced wholesale per-account on each sync (same
    full-replace pattern as Domain/Server)."""

    __tablename__ = "cf_zones"
    __table_args__ = (UniqueConstraint("zone_id", name="uq_cf_zone_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, index=True)
    domain: Mapped[str] = mapped_column(String, index=True)
    zone_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default="")
    plan: Mapped[str] = mapped_column(String, default="")
    nameservers: Mapped[str] = mapped_column(Text, default="[]")
    created_on: Mapped[str] = mapped_column(String, default="")
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime())


class Pic(Base):
    """A PIC (person/team in charge) - the org's org-chart dimension that
    servers, CF accounts, and (transitively) domains are planned against."""

    __tablename__ = "pics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)


class ServerPic(Base):
    """Many-to-many: a server can serve >1 PIC (e.g. a shared "chatbang"
    box). Keyed by server_name, NOT Server.id - the servers table is fully
    deleted+reinserted on every periodic sync, so Server.id is not stable
    across syncs, but server_name is the natural stable key."""

    __tablename__ = "server_pics"
    __table_args__ = (UniqueConstraint("server_name", "pic_id", name="uq_server_pic"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    server_name: Mapped[str] = mapped_column(String, index=True)
    pic_id: Mapped[int] = mapped_column(Integer, index=True)


class CfAccountPic(Base):
    """Many-to-many: CfAccount.id is stable (accounts are upserted, never
    bulk-replaced), safe to use as the FK here."""

    __tablename__ = "cf_account_pics"
    __table_args__ = (UniqueConstraint("account_id", "pic_id", name="uq_account_pic"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, index=True)
    pic_id: Mapped[int] = mapped_column(Integer, index=True)


class PicTeam(Base):
    """A sub-group inside a PIC (e.g. PIC "OVN" splits into "Team 1" /
    "Team 2", each with its own people). Only meaningful for PICs that
    actually subdivide - most PICs have zero teams."""

    __tablename__ = "pic_teams"
    __table_args__ = (UniqueConstraint("pic_id", "name", name="uq_pic_team"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pic_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String)
    members: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of names


class ServerPicTeam(Base):
    """Many-to-many, keyed by server_name for the same reason as ServerPic
    (servers table is fully replaced on every sync). A server can belong to
    more than one team of the same PIC (e.g. a box shared by both OVN
    teams)."""

    __tablename__ = "server_pic_teams"
    __table_args__ = (UniqueConstraint("server_name", "team_id", name="uq_server_pic_team"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    server_name: Mapped[str] = mapped_column(String, index=True)
    team_id: Mapped[int] = mapped_column(Integer, index=True)


class CfWhitelistIp(Base):
    """IP whitelist baked into the "skip" rule of every zone's Cloudflare
    Firewall ruleset (see cf_ops._build_firewall_rules) - bots/office IPs
    that bypass the bot/country/UA/xmlrpc blocks applied to every domain.
    Editable here instead of hardcoded in code so a new IP takes effect on
    the next Firewall Update run, no deploy needed."""

    __tablename__ = "cf_whitelist_ips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String, default="")
    ip: Mapped[str] = mapped_column(String, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    note: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class CfFirewallTemplate(Base):
    """A named, admin-editable variant of the rule set `cf_firewall_update`
    applies to a zone (see cf_ops._build_firewall_rules).

    The 3 rules that used to be permanently fixed for every template (skip-
    list, port check, non-browser-UA check) are now genuinely editable, not
    just on/off - same "edit the actual values" UX as countries_blocked/
    blocked_user_agents/blocked_paths below, not a separate toggle concept:

    - skip_paths / skip_verified_bot / skip_whitelist_ip / skip_asns: the 4
      independent conditions that used to be hardcoded into 1 OR'd "skip"
      rule. skip_verified_bot and skip_whitelist_ip stay plain booleans -
      there's no "value" to edit for "use Cloudflare's own bot signal or
      don't" / "use the Whitelist IP page's list or don't", just whether
      each applies. skip_paths and skip_asns are admin-editable lists (e.g.
      swap /wp-json/ for a different path, or add more trusted ASNs beyond
      Google's 15169). Any of the 4 being off/empty just drops that OR
      branch; all 4 off/empty omits the skip rule entirely.
    - allowed_ports: which ports are NOT blocked (default ["80", "443"]) -
      editable instead of hardcoded, empty list omits the port-check rule.
    - allowed_ua_substrings: which lowercase substrings count as "a real
      browser" for the generic UA check (default ["mozilla", "opera"]) -
      editable, empty list omits the UA-check rule.

    Opened up on the user's explicit, risk-acknowledged request - a
    template that narrows/empties any of these can let its own country/
    path/named-bot block rules catch a whitelisted IP or Googlebot, which
    used to be structurally impossible. Applies to is_default=True too (the
    "Mặc định" template can be edited like any other) - the ONLY guarantee
    is_default still carries is that the row can't be deleted (see
    routers/cf_firewall_templates.py), not that its content is safe.

    countries_blocked / blocked_user_agents / blocked_paths / skip_paths /
    skip_asns / allowed_ports / allowed_ua_substrings are all stored as
    JSON-encoded lists (json.dumps/json.loads at the router boundary, same
    "list in a Text column" pattern as PicTeam.members) rather than a
    separate child table - small, always-read-as-a-whole lists with no need
    to query into individual elements.

    blocked_user_agents exists because the generic non-browser-UA check
    does NOT catch SEO crawler bots like AhrefsBot - its real UA string is
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; ...)", which contains "Mozilla"
    and so passes the generic allowlist-style check unchanged. Blocking a
    named bot needs its own explicit substring-block rule."""

    __tablename__ = "cf_firewall_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    countries_blocked: Mapped[str] = mapped_column(Text, default="[]")
    blocked_user_agents: Mapped[str] = mapped_column(Text, default="[]")
    blocked_paths: Mapped[str] = mapped_column(Text, default="[]")
    bot_fight_mode: Mapped[bool] = mapped_column(default=False)
    skip_paths: Mapped[str] = mapped_column(Text, default='["/wp-json/"]')
    skip_verified_bot: Mapped[bool] = mapped_column(default=True)
    skip_whitelist_ip: Mapped[bool] = mapped_column(default=True)
    skip_asns: Mapped[str] = mapped_column(Text, default='["15169"]')
    allowed_ports: Mapped[str] = mapped_column(Text, default='["80", "443"]')
    allowed_ua_substrings: Mapped[str] = mapped_column(Text, default='["mozilla", "opera"]')
    # The one template that's seeded on startup from the original hardcoded
    # ruleset and can never be deleted (see cf_firewall_template_service) -
    # always a selectable fallback name to switch back to. Its rule content
    # can be edited like any other template, so is_default no longer
    # guarantees the content itself is safe - only that the row always
    # exists.
    is_default: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class AllowedIp(Base):
    """IP allowlist for this internal admin tool itself - when
    settings.ip_allowlist_enforced is on, only requests from an active IP in
    this table are let through (see the middleware in main.py)."""

    __tablename__ = "allowed_ips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    ip: Mapped[str] = mapped_column(String, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    note: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class PluginZip(Base):
    """A WordPress plugin .zip uploaded once and reused across install jobs
    (see routers/plugin_zips.py) instead of re-uploading from the browser
    every time - the actual file lives at settings.plugin_zip_dir/stored_name."""

    __tablename__ = "plugin_zips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)  # original filename, shown in the UI
    stored_name: Mapped[str] = mapped_column(String, unique=True)  # uuid-prefixed name on disk
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class ThemeZip(Base):
    """A WordPress theme .zip uploaded once and reused across install jobs
    (see routers/theme_zips.py) instead of re-uploading from the browser
    every time - the actual file lives at settings.theme_zip_dir/stored_name."""

    __tablename__ = "theme_zips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)  # original filename, shown in the UI
    stored_name: Mapped[str] = mapped_column(String, unique=True)  # uuid-prefixed name on disk
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class MuPlugin(Base):
    """A must-use-plugin .php file uploaded once and reused across install
    jobs (see routers/mu_plugins.py) - the actual file lives at
    settings.mu_plugin_dir/stored_name. Unlike PluginZip/ThemeZip this is a
    single raw .php file, not a zip: mu-plugins have no install/activate
    step of their own - WordPress auto-loads any .php file that sits
    directly in wp-content/mu-plugins/ (not in a subfolder) on every
    request, so "installing" one is just placing the file there (see
    wp_mu_plugin_ops.INSTALL_MU_PLUGIN_SCRIPT)."""

    __tablename__ = "mu_plugins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)  # original filename, shown in the UI
    stored_name: Mapped[str] = mapped_column(String, unique=True)  # uuid-prefixed name on disk
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class User(Base):
    """A team member's login account. The one row whose username matches
    settings.admin_username is special-cased (is_admin, and re-synced from
    .env on every backend startup - see user_service.seed_admin_user) so
    there's always a break-glass way back in if that person's password is
    ever lost again, same as the incident that led to this table existing."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String, default="")
    is_admin: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class ChangelogEntry(Base):
    """Manually-recorded system changelog - what shipped, when, by whom.
    There's no git history to derive this from (this project isn't a git
    repo), so entries are entered by hand whenever a fix/upgrade goes out.
    The most recent entry (by created_at) is treated as the "current
    version" wherever that's shown."""

    __tablename__ = "changelog_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String, default="")
    # "feature" | "fix" | "improvement" | "security" - drives the colored tag
    # and grouping on the changelog page.
    change_type: Mapped[str] = mapped_column(String, default="fix")
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    created_by: Mapped[str] = mapped_column(String)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_type: Mapped[str] = mapped_column(String, index=True)  # "check_health" | "check_ns" | "check_ip"
    status: Mapped[str] = mapped_column(String, index=True, default="pending")
    created_by: Mapped[str] = mapped_column(String)
    created_ip: Mapped[str] = mapped_column(String, default="", index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    log: Mapped[str] = mapped_column(Text, default="")
    result_json: Mapped[str] = mapped_column(Text, default="[]")
    # Machine-readable reason code for a "failed" job, distinct from the
    # free-text `log` - lets the frontend render a dedicated UI for specific
    # cases (e.g. "no_internet") instead of parsing log text. None for jobs
    # that never failed, or failed for a reason with no dedicated UI yet.
    fail_reason: Mapped[str | None] = mapped_column(String, nullable=True)


class JobTarget(Base):
    """One row per (job, target label - e.g. a domain being migrated),
    created up front when a batch job starts and updated as work proceeds -
    lets a poller show live progress ("12/45 done, currently X") and partial
    results while the parent Job is still 'running', instead of waiting for
    the single result_json write that only happens once the whole job ends.
    Also the shape a future resume feature would query (status != 'success')
    to find what's left to retry - not implemented yet, but this table is
    shaped so that doesn't require a rebuild. Not created at all for
    dry-run jobs (nothing real happens) or for job types that haven't
    adopted this yet - zero rows here is the normal, fully-supported case;
    consumers (JobProgressBar, JobResultPanel) degrade to today's behavior.

    Looked up by (job_id, target_label) rather than a ferried-around id, so
    wiring this into an existing per-target loop (see wp_migrate_ops.py)
    doesn't require threading a JobTarget/id through code that only ever
    had the label in scope - fine as long as labels are unique within one
    job, true for migrate's domains today."""

    __tablename__ = "job_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(Integer, index=True)
    target_label: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, index=True, default="pending")  # pending|running|success|failed
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    note: Mapped[str] = mapped_column(String, default="")


class ProviderWeeklySnapshot(Base):
    """One row per (provider, week_start) - the server/domain count that
    provider had, tagged to the Monday-start week it was observed in.
    Server and Domain are both full-replace-on-sync tables with no history
    of their own, so there is no way to ask "how many servers did GCP have
    3 weeks ago" without something recording it going forward - this table
    is that record (see infra_snapshot_service.py).

    The CURRENT week's row is overwritten on every periodic capture tick
    (reflects the latest live count all week long); a past week's row is
    simply never touched again once its week ends, which freezes it at
    whatever the last tick during that week saw - the same "last known
    value wins" convention as Server.last_health_status.

    domain_count for weeks before this table started being populated was
    backfilled once from DomainChangeLog's added/removed events (walking
    backward from the live count - see backfill_domain_history). server_count
    has no equivalent history source anywhere in this app and is left NULL
    for those backfilled weeks - there is no way to reconstruct it."""

    __tablename__ = "provider_weekly_snapshots"
    __table_args__ = (UniqueConstraint("provider", "week_start", name="uq_provider_week"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String, index=True)
    week_start: Mapped[str] = mapped_column(String, index=True)  # YYYY-MM-DD, Monday
    server_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    domain_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime())


class ProviderCost(Base):
    """One row per (account_label, month) - a manually entered monthly cost
    in VNĐ. account_label is one of costs_service.ACCOUNT_LABELS, the org's
    own billing-account groupings (e.g. "Alibaba" alone covers 2 separate
    real accounts, Partner vs Sieuthixanh) - not a dimension any provider's
    billing API knows about on its own, so this is entered by hand rather
    than pulled automatically."""

    __tablename__ = "provider_costs"
    __table_args__ = (UniqueConstraint("account_label", "month", name="uq_provider_cost_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_label: Mapped[str] = mapped_column(String, index=True)
    month: Mapped[str] = mapped_column(String, index=True)  # YYYY-MM
    # NUMERIC, not an integer type - real entries carry fractional VNĐ
    # (e.g. a cost converted from a USD invoice, cents included), even
    # though whole-đồng amounts are the common case.
    amount_vnd: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    note: Mapped[str] = mapped_column(String, default="")
    created_by: Mapped[str] = mapped_column(String, default="")
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
