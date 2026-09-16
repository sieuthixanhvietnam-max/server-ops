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


class CfWhitelistIpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    ip: str
    is_active: bool
    note: str
    created_at: datetime


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
