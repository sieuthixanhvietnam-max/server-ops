from datetime import datetime

from sqlalchemy import Integer, String, Text, UniqueConstraint
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
