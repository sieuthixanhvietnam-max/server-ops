import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DomainOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    domain: str
    profile: str
    provider: str
    server_ip: str
    server_name: str
    source_updated: datetime | None


class ServerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    server_name: str
    ip: str
    provider: str
    profile: str
    domains_count: int
    source_updated: datetime | None
    ssh_user: str | None = None
    ssh_key_path: str | None = None


class PagedResponse(BaseModel):
    data: list
    total: int
    success: bool = True


class SyncStatus(BaseModel):
    synced_at: datetime | None
    next_synced_at: datetime | None = None
    total_domains: int
    total_servers: int
    success: bool
    error_message: str | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    is_admin: bool
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


INDEXER_SERVICES = ["speedyindex", "instantindexer", "linksindexer", "ralfyindex"]


class IndexerCredentialOut(BaseModel):
    service: str
    configured: bool
    updated_at: datetime | None
    updated_by: str


class SiteCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    domain: str
    server_name: str
    username: str
    updated_at: datetime
    updated_by: str


class ChangelogEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: str
    change_type: str
    title: str
    description: str
    created_at: datetime
    created_by: str


class PluginZipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    filename: str
    size_bytes: int
    uploaded_by: str
    created_at: datetime


class ThemeZipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    filename: str
    size_bytes: int
    uploaded_by: str
    created_at: datetime


class MuPluginOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    filename: str
    size_bytes: int
    uploaded_by: str
    created_at: datetime


class AllowedIpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    ip: str
    is_active: bool
    note: str
    created_at: datetime


class CfAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    email: str
    cf_account_id: str | None
    source: str
    is_active: bool
    created_at: datetime
    last_synced_at: datetime | None
    last_sync_status: str
    last_sync_error: str | None
    zone_count: int
    # api_token is intentionally never exposed here - encrypted at rest,
    # and never sent back to the client once saved.


class WhitelistIpEntry(BaseModel):
    """1 entry of FirewallPreset.whitelist_ips - unlike the other list
    fields on that model, this one isn't a bare string: label is a
    human-readable "whose IP this is" note shown as a tooltip wherever the
    list is displayed, carried over from the standalone Whitelist IP page
    this was folded in from (see models.FirewallPreset's docstring)."""

    ip: str
    label: str = ""


class FirewallPresetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    countries_blocked: list[str]
    blocked_user_agents: list[str]
    blocked_paths: list[str]
    bot_fight_mode: bool
    whitelist_ips: list[WhitelistIpEntry]
    skip_paths: list[str]
    skip_verified_bot: bool
    skip_asns: list[str]
    allowed_ports: list[str]
    allowed_ua_substrings: list[str]
    is_default: bool
    created_by: str
    created_at: datetime

    # Several fields are JSON-encoded in a Text column on the ORM side (see
    # models.FirewallPreset) - model_validate can't decode that on its own,
    # so routers build this via from_row() instead of calling
    # model_validate(row) directly on the ORM object.
    @classmethod
    def from_row(cls, row) -> "FirewallPresetOut":
        return cls(
            id=row.id,
            name=row.name,
            countries_blocked=json.loads(row.countries_blocked),
            blocked_user_agents=json.loads(row.blocked_user_agents),
            blocked_paths=json.loads(row.blocked_paths),
            bot_fight_mode=row.bot_fight_mode,
            whitelist_ips=json.loads(row.whitelist_ips),
            skip_paths=json.loads(row.skip_paths),
            skip_verified_bot=row.skip_verified_bot,
            skip_asns=json.loads(row.skip_asns),
            allowed_ports=json.loads(row.allowed_ports),
            allowed_ua_substrings=json.loads(row.allowed_ua_substrings),
            is_default=row.is_default,
            created_by=row.created_by,
            created_at=row.created_at,
        )


class DomainChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    domain: str
    server_name: str
    from_server_name: str | None
    provider: str
    profile: str
    detected_at: datetime
