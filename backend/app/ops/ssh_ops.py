import os
import shlex
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import settings

# Profile keys match Server.profile values coming from the sync source
# (ali_enterprise, gcp_enterprise, do_sgp1, ...), so a server pulled from our
# own DB can be connected to without any extra manual mapping.
PROFILES = {
    "aws_new": {"key": os.path.join(settings.ssh_key_dir, "seo1-key-aws-1.pem"), "user": "ubuntu"},
    "aws3_seo1": {
        "key": os.path.join(settings.ssh_key2_dir, "seo1-key-1.pem"),
        "users": ["ubuntu", "ec2-user", "root"],
    },
    "gcp_tier1": {"key": os.path.join(settings.ssh_key_dir, "seo1-key-gcp-ubuntu"), "user": "ubuntu"},
    "do_sgp1": {"key": os.path.join(settings.ssh_key_dir, "seo1-key-do-root"), "user": "root"},
    "ali_sgp1": {"key": os.path.join(settings.ssh_key_dir, "seo1-key-ali-root.pem"), "user": "root"},
    "ali_hk_team": {"key": os.path.join(settings.ssh_key_dir, "seo1-key-ali-team.pem"), "user": "root"},
    "ali_enterprise": {
        "key": os.path.join(settings.ssh_key_dir, "seo1-key-ali-enterprise.pem"),
        "user": "root",
    },
    "gcp_enterprise": {
        "key": os.path.join(settings.ssh_key_dir, "seo1-key-gcp-enterprise"),
        "users": ["root", "ubuntu"],
    },
}

def resolve_ssh_user(profile_name: str | None) -> str | None:
    """First candidate user for a profile - the same order establish_connection
    tries them in, so it's the most-likely-correct guess without an actual
    SSH probe (used to render a copy-paste `ssh user@ip` in the UI)."""
    profile = PROFILES.get(profile_name) if profile_name else None
    if not profile:
        return None
    return profile.get("user") or (profile.get("users") or [None])[0]


def resolve_ssh_key_path(profile_name: str | None) -> str | None:
    """The exact absolute key path this backend itself uses to SSH in (see
    PROFILES above) - deliberately hardcoded to wherever this backend/its
    admin runs, not portable to other machines. Reused as-is (not
    reconstructed) in the UI's copy-paste `ssh -i ...` commands, so it always
    matches whatever SSH_KEY_DIR is actually configured here."""
    profile = PROFILES.get(profile_name) if profile_name else None
    if not profile:
        return None
    return profile["key"]


os.makedirs(os.path.dirname(settings.ssh_known_hosts_file), exist_ok=True)
os.makedirs(settings.ssh_control_dir, exist_ok=True, mode=0o700)
if not os.path.isfile(settings.ssh_known_hosts_file):
    open(settings.ssh_known_hosts_file, "a").close()
    os.chmod(settings.ssh_known_hosts_file, 0o600)

_SSH_OPTS = [
    # TOFU host-key pinning: new hosts are trusted and recorded on first
    # connect, but a key that later CHANGES for a known host is rejected
    # instead of silently accepted (unlike StrictHostKeyChecking=no).
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", f"UserKnownHostsFile={settings.ssh_known_hosts_file}",
    "-o", "BatchMode=yes",
    # Multiplex: the first connection to a host opens a control socket that
    # subsequent connections (e.g. the health-check run right after the
    # connectivity probe) reuse instead of paying for a fresh TCP+auth
    # handshake.
    "-o", "ControlMaster=auto",
    "-o", f"ControlPath={settings.ssh_control_dir}/%C",
    "-o", "ControlPersist=60s",
]

HEALTH_SCRIPT = """#!/bin/bash
UPTIME=$(uptime -p 2>/dev/null || uptime | awk -F'up ' '{print $2}' | awk -F',' '{print $1}')
LOAD=$(cat /proc/loadavg | awk '{print $1"/"$2"/"$3}')
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2+$4}' | cut -d. -f1)
[[ -z "$CPU" ]] && CPU=$(vmstat 1 1 | tail -1 | awk '{print 100-$15}')
RAM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
RAM_USED=$(free -m | awk '/^Mem:/{print $3}')
RAM_PCT=$(awk "BEGIN{printf \\"%.0f\\", ($RAM_USED/$RAM_TOTAL)*100}")
DISK_TOTAL=$(df -BG / | awk 'NR==2{gsub(/G/,"",$2); print $2}')
DISK_USED=$(df -BG / | awk 'NR==2{gsub(/G/,"",$3); print $3}')
DISK_PCT=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
OLS_STATUS="stopped"
systemctl is-active --quiet lsws 2>/dev/null && OLS_STATUS="running"
MARIADB_STATUS="stopped"
systemctl is-active --quiet mariadb 2>/dev/null && MARIADB_STATUS="running"
systemctl is-active --quiet mysql 2>/dev/null && MARIADB_STATUS="running"
DOMAIN_COUNT=$(ls /etc/wptt/vhost/.*.conf 2>/dev/null | wc -l)
echo "HEALTH_DATA"
echo "uptime=$UPTIME"
echo "load=$LOAD"
echo "cpu=$CPU"
echo "ram_used=$RAM_USED"
echo "ram_total=$RAM_TOTAL"
echo "ram_pct=$RAM_PCT"
echo "disk_used=$DISK_USED"
echo "disk_total=$DISK_TOTAL"
echo "disk_pct=$DISK_PCT"
echo "ols=$OLS_STATUS"
echo "mariadb=$MARIADB_STATUS"
echo "domains=$DOMAIN_COUNT"
echo "HEALTH_END"
"""

THRESHOLDS = {"ram_warn": 85, "ram_crit": 95, "disk_warn": 80, "disk_crit": 90, "cpu_warn": 80}


def _try_connect(ip, user, key, timeout=10):
    """Returns (ok, reason). reason is the last line of stderr on failure -
    stays visible in job logs instead of a blanket "SSH connect failed"."""
    cmd = ["ssh", "-i", key, "-o", f"ConnectTimeout={timeout}"] + _SSH_OPTS + [f"{user}@{ip}", "echo ok"]
    # A real *file* for stderr, not DEVNULL/PIPE: when this call is the first
    # one to reach `ip` within the ControlPersist window, this ssh process
    # forks a detached background muxer that inherits our stdout/stderr fds.
    # A pipe read blocks until every holder of the write end closes it -
    # including that lingering muxer, for the full ControlPersist duration
    # (60s), well past our own `timeout` - so a perfectly successful
    # connection gets killed and reported as a false failure (confirmed via
    # `ssh -vvv`: "ControlPersist timeout expired" firing at exactly 60s on
    # a connection that had actually already succeeded). A file has no such
    # wait-for-every-writer semantics, so it keeps the diagnostics DEVNULL
    # discarded without reintroducing that hang.
    fd, err_path = tempfile.mkstemp(prefix="sshprobe_")
    try:
        with os.fdopen(fd, "wb") as errf:
            r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=errf, timeout=timeout + 5)
        if r.returncode == 0:
            return True, None
        with open(err_path, "rb") as f:
            err_text = f.read().decode(errors="replace").strip()
        last_line = err_text.splitlines()[-1] if err_text else f"ssh exited {r.returncode}"
        return False, last_line
    except subprocess.TimeoutExpired:
        return False, f"local timeout after {timeout + 5}s"
    except Exception as e:
        return False, str(e)
    finally:
        try:
            os.remove(err_path)
        except OSError:
            pass


def establish_connection(ip: str, profile_name: str | None, retries: int = 1, retry_delay: float = 2.0):
    profile = PROFILES.get(profile_name) if profile_name else None
    if not profile:
        return None, None, "unknown profile"

    key = profile["key"]
    if not os.path.isfile(key):
        return None, None, f"key not found: {key}"

    users = [profile["user"]] if "user" in profile else profile.get("users", [])
    # Long-haul international SSH (this VPS to servers across several cloud
    # regions/providers) sees occasional transient timeouts that clear up on
    # the very next attempt - a single try treats that the same as a truly
    # unreachable host. One retry after a short delay absorbs the blip
    # without masking a real outage (still fails after both attempts).
    last_reason = "SSH connect failed"
    for attempt in range(retries + 1):
        for user in users:
            ok, reason = _try_connect(ip, user, key)
            if ok:
                return user, key, None
            if reason:
                last_reason = reason
        if attempt < retries:
            time.sleep(retry_delay)
    return None, None, last_reason


def run_remote(ip, user, key, script, args=None, use_sudo=False, timeout=30):
    """Run `script` on the remote host via `bash -s -- <args...>`.

    Values in `args` become the script's positional parameters ($1, $2, ...)
    instead of being interpolated into the script text - this is what keeps
    user-controlled values (domain names, etc.) from being able to break out
    into arbitrary shell commands. Each arg is shlex-quoted for the POSIX
    shell that sshd hands the command line to on the remote end.
    """
    remote_shell = "sudo bash -s --" if use_sudo else "bash -s --"
    quoted_args = " ".join(shlex.quote(a) for a in (args or []))
    remote_cmd = f"{remote_shell} {quoted_args}".strip()

    cmd = ["ssh", "-i", key] + _SSH_OPTS + [f"{user}@{ip}", remote_cmd]
    try:
        proc = subprocess.run(cmd, input=script, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout + proc.stderr
    except subprocess.TimeoutExpired:
        return -1, f"timeout after {timeout}s"


def put_file(ip, user, key, local_path, remote_path, timeout=120):
    """Copy a local file to the remote host via `scp`, reusing the same host-key
    pinning / multiplexing options as run_remote."""
    cmd = ["scp", "-i", key] + _SSH_OPTS + [local_path, f"{user}@{ip}:{remote_path}"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if r.returncode == 0:
            return True, "uploaded"
        return False, (r.stderr or r.stdout).strip()[:200]
    except subprocess.TimeoutExpired:
        return False, f"scp timeout after {timeout}s"


# wptt's own servers each run a cron (*/3 * * * *, see
# /etc/wptt/vhost/../.. crontab) that auto-`lswsctrl restart`s whenever it
# finds a vhost's .htaccess newer than the last restart - a general
# self-healing mechanism, not something this app owns or should touch.
# `lswsctrl restart` sends the running lshttpd a graceful SIGUSR1 (verified
# by reading /usr/local/lsws/bin/lswsctrl directly - it's a single signal,
# not an internal retry loop), which also respawns its admin-console
# listener (port 19019) as a side effect. Two restarts landing close
# together - one of ours overlapping that cron's own tick, or two of our
# own call sites (clone's per-chunk restart, migrate's per-group restart)
# hitting the same busy shared server back to back - can race on that
# port and log a scary "Fatal error in configuration, exit!", even though
# the actual lshttpd worker processes serving traffic are never affected
# (confirmed live 2026-08-21: site stayed on HTTP 200 throughout). This
# debounce only reduces OUR side of that collision risk - it can't stop
# the external cron from restarting on its own schedule, which is by
# design and out of scope to change.
_LSWS_RESTART_MIN_INTERVAL = 90
_lsws_restart_lock = threading.Lock()
_lsws_last_restart: dict[str, float] = {}

LSWS_RESTART_SCRIPT = """#!/bin/bash
/usr/local/lsws/bin/lswsctrl restart >/dev/null 2>&1
sleep 2
if /usr/local/lsws/bin/lswsctrl status 2>/dev/null | grep -q "litespeed is running"; then
    echo "LSWS_RESTARTED_OK"
else
    /usr/local/lsws/bin/lswsctrl start >/dev/null 2>&1
    sleep 2
    echo "LSWS_RESTARTED_RETRY"
fi
"""


def restart_litespeed(ip: str, user: str, key: str, log, min_interval: int = _LSWS_RESTART_MIN_INTERVAL) -> bool:
    """Restarts LiteSpeed on `ip` to pick up a newly-written vhost config
    (clone/migrate), skipping the call entirely if this same IP was already
    restarted within `min_interval` seconds - across ALL callers/jobs in
    this process, not just the current one. Returns True if either a
    restart was confirmed OK or one was skipped as redundant; False only
    if an actual restart attempt came back uncertain."""
    now = time.monotonic()
    with _lsws_restart_lock:
        last = _lsws_last_restart.get(ip)
        if last is not None and (now - last) < min_interval:
            log(f"    [lsws] {ip}: restarted {now - last:.0f}s ago, skipping (đủ mới, tránh đụng cron/job khác)")
            return True
        _lsws_last_restart[ip] = now

    rc, out = run_remote(ip, user, key, LSWS_RESTART_SCRIPT, use_sudo=True, timeout=30)
    if "LSWS_RESTARTED" in out:
        log(f"    [lsws] {ip}: restarted OK")
        return True
    log(f"    [warn] {ip}: LiteSpeed restart uncertain: {out[-200:]}")
    return False


def _parse_health_output(output: str) -> dict:
    data = {}
    in_block = False
    for line in output.splitlines():
        line = line.strip()
        if line == "HEALTH_DATA":
            in_block = True
            continue
        if line == "HEALTH_END":
            break
        if in_block and "=" in line:
            key, _, val = line.partition("=")
            data[key.strip()] = val.strip()
    return data


def _health_status(data: dict):
    reasons = []
    status = "OK"

    def check(pct_str, warn, crit, label):
        nonlocal status
        try:
            pct = int(pct_str)
        except (ValueError, TypeError):
            return
        if pct >= crit:
            reasons.append(f"{label} {pct}% (CRIT)")
            status = "CRIT"
        elif pct >= warn:
            reasons.append(f"{label} {pct}% (WARN)")
            if status != "CRIT":
                status = "WARN"

    check(data.get("ram_pct", "0"), THRESHOLDS["ram_warn"], THRESHOLDS["ram_crit"], "RAM")
    check(data.get("disk_pct", "0"), THRESHOLDS["disk_warn"], THRESHOLDS["disk_crit"], "Disk")
    check(data.get("cpu", "0"), THRESHOLDS["cpu_warn"], 100, "CPU")

    if data.get("ols") == "stopped":
        reasons.append("OLS stopped")
        status = "CRIT"
    if data.get("mariadb") == "stopped":
        reasons.append("MariaDB stopped")
        status = "CRIT"

    return status, reasons


def check_health(targets: list[dict], log) -> list[dict]:
    """targets: [{"server_name": ..., "ip": ..., "profile": ...}, ...]"""
    log(f"Checking health for {len(targets)} server(s)...")

    def _one(target):
        server_name, ip, profile = target["server_name"], target["ip"], target["profile"]
        user, key, err = establish_connection(ip, profile)
        if not user:
            log(f"[fail] {server_name} ({ip}): {err}")
            return {"server_name": server_name, "ip": ip, "profile": profile,
                     "status": "FAIL", "note": err}

        rc, output = run_remote(ip, user, key, HEALTH_SCRIPT)
        if rc != 0 and "HEALTH_DATA" not in output:
            log(f"[fail] {server_name} ({ip}): script exit {rc}")
            return {"server_name": server_name, "ip": ip, "profile": profile,
                     "status": "FAIL", "note": f"script exit {rc}"}

        data = _parse_health_output(output)
        if not data:
            log(f"[fail] {server_name} ({ip}): no data returned")
            return {"server_name": server_name, "ip": ip, "profile": profile,
                     "status": "FAIL", "note": "no data returned"}

        status, reasons = _health_status(data)
        log(f"[{status.lower()}] {server_name} ({ip}): "
            f"CPU {data.get('cpu')}% RAM {data.get('ram_pct')}% Disk {data.get('disk_pct')}%")
        return {
            "server_name": server_name, "ip": ip, "profile": profile,
            "status": status, "note": "; ".join(reasons),
            "uptime": data.get("uptime", "?"), "load": data.get("load", "?"),
            "cpu": data.get("cpu", "?"),
            "ram_pct": data.get("ram_pct", "?"), "disk_pct": data.get("disk_pct", "?"),
            "ols": data.get("ols", "?"), "mariadb": data.get("mariadb", "?"),
            "domains": data.get("domains", "?"),
        }

    results = [None] * len(targets)
    with ThreadPoolExecutor(max_workers=settings.ssh_health_workers) as pool:
        futures = {pool.submit(_one, t): idx for idx, t in enumerate(targets)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                results[idx] = {"server_name": targets[idx]["server_name"],
                                 "ip": targets[idx]["ip"], "profile": targets[idx]["profile"],
                                 "status": "FAIL", "note": str(exc)}
    return results
