#!/usr/bin/env bash
# Deploys server-ops to the production VPS: builds the frontend locally
# (the VPS has no Node.js), ships it, then fast-forwards the backend git
# checkout to a specific commit and restarts the systemd service.
#
# Deliberately NOT wired to CI/auto-trigger on push - this tool SSHes into
# real hosting servers and changes real DNS, so a deploy is a decision a
# human makes on purpose, not a side effect of merging.
#
# Usage:
#   scripts/deploy.sh              # deploy latest origin/main
#   scripts/deploy.sh <git-ref>    # deploy a specific commit/tag (also how
#                                  # you roll back: pass the previous SHA)
#   scripts/deploy.sh -y           # skip the confirmation prompt
#
# Override connection details via env vars if run from a different machine:
#   DEPLOY_VPS_HOST, DEPLOY_VPS_KEY, DEPLOY_VPS_APP_DIR

set -euo pipefail

VPS_HOST="${DEPLOY_VPS_HOST:-root@146.190.87.62}"
VPS_KEY="${DEPLOY_VPS_KEY:-$HOME/Documents/Dev/key/seo1-key-do-root}"
VPS_APP_DIR="${DEPLOY_VPS_APP_DIR:-/opt/server-ops}"
SSH_OPTS=(-i "$VPS_KEY" -o BatchMode=yes -o ConnectTimeout=10)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AUTO_YES=""
GIT_REF="origin/main"
for arg in "$@"; do
  case "$arg" in
    -y|--yes) AUTO_YES=1 ;;
    *) GIT_REF="$arg" ;;
  esac
done

ssh_do() { ssh "${SSH_OPTS[@]}" "$VPS_HOST" "$@"; }

echo "==> Resolving $GIT_REF..."
cd "$REPO_ROOT"
git fetch origin --quiet
TARGET_SHA="$(git rev-parse "$GIT_REF")"
TARGET_SUBJECT="$(git log -1 --format='%s' "$TARGET_SHA")"

CURRENT_SHA="$(ssh_do "cd $VPS_APP_DIR && git rev-parse HEAD")"
if [ "$CURRENT_SHA" = "$TARGET_SHA" ]; then
  echo "==> Production is already at $TARGET_SHA ($TARGET_SUBJECT). Nothing to do."
  exit 0
fi

echo "    Current on production: $CURRENT_SHA"
echo "    Deploying:             $TARGET_SHA  $TARGET_SUBJECT"
if [ -z "$AUTO_YES" ]; then
  read -r -p "Proceed with deploy? [y/N] " reply
  case "$reply" in
    y|Y) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "==> Checking for in-flight jobs on production (running/pending)..."
IN_FLIGHT="$(ssh_do "sudo -u postgres psql -d server_ops -tAc \"SELECT count(*) FROM jobs WHERE status IN ('running','pending');\"" | tr -d '[:space:]')"
if [ "$IN_FLIGHT" != "0" ]; then
  echo "!! ABORT: $IN_FLIGHT job(s) still running/pending on production."
  echo "   Restarting the backend now would kill them mid-flight with no resume."
  echo "   Check /monitor/job-history, wait for them to finish, then re-run."
  exit 1
fi
echo "    OK - no in-flight jobs."

echo "==> Checking production git working tree is clean..."
DIRTY="$(ssh_do "cd $VPS_APP_DIR && git status --porcelain")"
if [ -n "$DIRTY" ]; then
  echo "!! ABORT: production working tree has uncommitted changes - investigate before deploying:"
  echo "$DIRTY"
  exit 1
fi

echo "==> Building frontend (production build)..."
cd "$REPO_ROOT/frontend"
npm run build

echo "==> Syncing frontend/dist to VPS..."
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  "$REPO_ROOT/frontend/dist/" "$VPS_HOST:$VPS_APP_DIR/frontend/dist/"

echo "==> Fetching + checking out $TARGET_SHA on VPS..."
ssh_do "cd $VPS_APP_DIR && git fetch origin --quiet && git checkout --quiet $TARGET_SHA"

echo "==> Installing backend dependencies (in case requirements.txt changed)..."
ssh_do "$VPS_APP_DIR/backend/venv/bin/pip install -q -r $VPS_APP_DIR/backend/requirements.txt"

echo "==> Restarting backend service..."
ssh_do "systemctl restart server-ops-backend"

echo "==> Health check..."
sleep 3
HEALTH="$(ssh_do "curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8010/docs || true")"
if [ "$HEALTH" != "200" ]; then
  echo "!! WARNING: backend did not return HTTP 200 after restart (got: $HEALTH)."
  echo "   Check logs: ssh -i $VPS_KEY $VPS_HOST journalctl -u server-ops-backend -n 50 --no-pager"
  echo "   Rollback:   scripts/deploy.sh $CURRENT_SHA"
  exit 1
fi

echo "==> Recording deployed commit marker..."
ssh_do "echo '$TARGET_SHA' > $VPS_APP_DIR/DEPLOYED_SHA"

echo "Deployed $TARGET_SHA successfully."
echo "Remember to add an entry on /changelog (production) describing what shipped -"
echo "it's a manual, per-environment log, not derived from this deploy automatically."
