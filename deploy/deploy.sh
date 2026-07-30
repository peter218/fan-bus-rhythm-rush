#!/usr/bin/env bash
#
# Build and restart the production server.
#
#   ./deploy/deploy.sh            # pull, install, build, restart, verify
#   ./deploy/deploy.sh --no-pull  # build what is already checked out
#
# Safe to re-run. The service is only restarted after a successful build, so a
# broken build leaves the currently serving version untouched.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/admin/fan-bus-rhythm-rush}"
SERVICE="${SERVICE:-fan-bus}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/}"
BRANCH="${BRANCH:-main}"

PULL=1
[[ "${1:-}" == "--no-pull" ]] && PULL=0

log() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mFAILED:\033[0m %s\n' "$1" >&2; exit 1; }

cd "$APP_DIR" || die "APP_DIR not found: $APP_DIR"

if [[ $PULL -eq 1 ]]; then
  log "Fetching origin/$BRANCH"
  # Refuse to clobber uncommitted work — on a server that is almost always an
  # edit someone made in place and has not saved anywhere else.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git status --short
    die "working tree is dirty; commit or stash before deploying"
  fi
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

log "Revision: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

# vinext and wrangler live in devDependencies, so --omit=dev would remove the
# very tools the build needs. Never add it here.
log "Installing dependencies"
npm ci --fetch-retries=5 --fetch-timeout=600000 \
  || die "npm ci failed (on a slow link, retry with --maxsockets=1)"

# A truncated native binary installs without error but fails at dlopen, and the
# error surfaces much later as a confusing build failure. Check up front.
log "Verifying native modules load"
while IFS= read -r binary; do
  node -e "require('$APP_DIR/$binary')" 2>/dev/null \
    || die "corrupt native module: $binary ($(stat -c%s "$binary" 2>/dev/null || echo '?') bytes). Delete it and re-run npm ci."
done < <(find node_modules -name '*.node' -not -path '*/test/*')

log "Building"
npm run build || die "build failed; the running version was left alone"

log "Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

log "Waiting for the app to answer"
for attempt in $(seq 1 30); do
  code="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [[ "$code" == "200" ]]; then
    log "Healthy after ${attempt}s (HTTP 200)"
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    printf '\n--- last 40 log lines ---\n'
    sudo journalctl -u "$SERVICE" -n 40 --no-pager || true
    die "no healthy response after 30s (last status: ${code:-none})"
  fi
  sleep 1
done

log "Reloading nginx"
sudo nginx -t && sudo systemctl reload nginx

log "Done. Serving $(git rev-parse --short HEAD)"
