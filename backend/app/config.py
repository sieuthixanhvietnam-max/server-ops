import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    sync_api_url: str
    sync_api_key: str
    database_url: str = "sqlite:///./server_ops.db"
    sync_interval_minutes: int = 10
    cf_sync_interval_minutes: int = 60
    health_check_interval_minutes: int = 20
    cors_origins: str = "http://localhost:8000"

    jwt_secret: str
    jwt_expire_minutes: int = 480
    admin_username: str
    admin_password_hash: str

    # Kill switch for the IP allowlist middleware - restart-only (not toggleable
    # from the app itself) so a misconfigured allowlist can always be recovered
    # via SSH + .env, even if it locks everyone out of the UI.
    ip_allowlist_enforced: bool = False

    cf_api_token: str = ""
    cf_account_id: str = ""
    cf_token_encryption_key: str = ""

    # Cloud provider API credentials, for automated security-group/firewall
    # whitelisting during cross-server migrate (see backend/app/ops/
    # firewall_ops.py) - separate from the SSH keys above, which only get a
    # shell on a server, not permission to edit its cloud-level firewall.
    ali_enterprise_access_key_id: str = ""
    ali_enterprise_access_key_secret: str = ""
    do_seo1_access_token: str = ""

    # R2 backup bucket - same bucket/credentials on every server that runs
    # the wptt backup cron (confirmed by comparing /etc/wptt/backup-r2.conf
    # across servers), so the backend can list the backup catalog directly
    # via the S3 API instead of SSHing into a server to run rclone.
    r2_bucket: str = ""
    r2_endpoint: str = ""
    r2_access_key: str = ""
    r2_secret_key: str = ""

    ssh_key_dir: str = os.path.expanduser("~/Documents/Dev/key")
    # aws3_seo1's key lives in a separate directory from every other profile
    # on the original dev machine - kept as its own setting (rather than
    # folding into ssh_key_dir) so a deploy can point it wherever that one
    # key actually ends up without renaming/moving the rest.
    ssh_key2_dir: str = os.path.expanduser("~/Documents/Dev/Key-2")
    ssh_health_workers: int = 20
    ssh_plugin_workers: int = 5
    ssh_restore_workers: int = 5
    plugin_zip_dir: str = os.path.expanduser("~/.server-ops/plugin-zips")
    theme_zip_dir: str = os.path.expanduser("~/.server-ops/theme-zips")
    mu_plugin_dir: str = os.path.expanduser("~/.server-ops/mu-plugins")
    # A full site restore (download + extract + DB import) can take minutes
    # for a large site - far longer than every other SSH op in this app.
    ssh_restore_timeout: int = 1800
    ssh_known_hosts_file: str = os.path.expanduser("~/.server-ops/ssh_known_hosts")
    ssh_control_dir: str = os.path.expanduser("~/.server-ops/ssh_control")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
