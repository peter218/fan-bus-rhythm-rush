#!/usr/bin/env bash
#
# Start, stop, and inspect the two processes that serve the game: nginx in front
# and the Node app behind it.
#
#   ./deploy/service.sh start
#   ./deploy/service.sh stop
#   ./deploy/service.sh restart
#   ./deploy/service.sh status
#   ./deploy/service.sh logs
#
# Deliberately knows nothing about git. It never checks out, pulls, or builds —
# it starts whatever is already in dist/. Use deploy/deploy.sh when you do want
# to ship a new revision.
#
# Works from any branch and any working directory.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
PID_FILE="$RUN_DIR/app.pid"
LOG_FILE="$RUN_DIR/app.log"

APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-3000}"
# Skip nginx entirely with MANAGE_NGINX=0 if something else fronts the app.
MANAGE_NGINX="${MANAGE_NGINX:-1}"

# 0.0.0.0 is an address to bind, not one to connect to, so health checks always
# dial the loopback no matter what the app is listening on.
HEALTH_HOST="127.0.0.1"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mFAILED:\033[0m %s\n' "$1" >&2; exit 1; }

app_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  # A stale pid file outlives a crash, so confirm the process is really there.
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

nginx_cmd() {
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl "$1" nginx
  else
    case "$1" in
      start)  sudo nginx ;;
      stop)   sudo nginx -s quit ;;
      reload) sudo nginx -s reload ;;
      *)      die "unsupported nginx action: $1" ;;
    esac
  fi
}

nginx_running() {
  pgrep -x nginx >/dev/null 2>&1
}

start_app() {
  if pid="$(app_pid)"; then
    log "App already running (pid $pid)"
    return 0
  fi

  # vinext start serves dist/ and does not build it. Say so plainly rather than
  # letting it fail with a confusing module error.
  [[ -f "$ROOT/dist/server/index.js" ]] \
    || die "dist/ is missing or incomplete — run 'npm run build' first"

  # An orphan from a previous run holds the port and the new process would exit
  # immediately with EADDRINUSE.
  if lsof -ti:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $APP_PORT is already in use (try '$0 stop', or check for a stray process)"
  fi

  mkdir -p "$RUN_DIR"
  log "Starting app on $APP_HOST:$APP_PORT"
  cd "$ROOT"
  WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  NODE_ENV=production \
    nohup npm run start -- -H "$APP_HOST" -p "$APP_PORT" \
    >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for attempt in $(seq 1 30); do
    if curl -s --noproxy '*' -o /dev/null --max-time 3 \
         "http://$HEALTH_HOST:$APP_PORT/" 2>/dev/null; then
      log "App answering after ${attempt}s"
      return 0
    fi
    if ! app_pid >/dev/null; then
      printf '\n--- last 30 log lines ---\n'
      tail -n 30 "$LOG_FILE" 2>/dev/null || true
      die "app exited during startup (see $LOG_FILE)"
    fi
    sleep 1
  done

  printf '\n--- last 30 log lines ---\n'
  tail -n 30 "$LOG_FILE" 2>/dev/null || true
  die "app did not answer within 30s (see $LOG_FILE)"
}

stop_app() {
  if ! pid="$(app_pid)"; then
    log "App not running"
    rm -f "$PID_FILE"
    return 0
  fi
  log "Stopping app (pid $pid)"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do
    app_pid >/dev/null || break
    sleep 1
  done
  if app_pid >/dev/null; then
    warn "Did not exit on SIGTERM, sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

case "${1:-}" in
  start)
    if [[ "$MANAGE_NGINX" == "1" ]]; then
      if nginx_running; then
        log "nginx already running, reloading config"
        sudo nginx -t && nginx_cmd reload
      else
        log "Starting nginx"
        sudo nginx -t && nginx_cmd start
      fi
    fi
    # App second: nginx returns 502 for the few seconds before it answers, and
    # starting nginx first means the site is at least reachable throughout.
    start_app
    log "Up."
    ;;

  stop)
    stop_app
    if [[ "$MANAGE_NGINX" == "1" ]] && nginx_running; then
      log "Stopping nginx"
      nginx_cmd stop
    fi
    log "Down."
    ;;

  restart)
    stop_app
    start_app
    if [[ "$MANAGE_NGINX" == "1" ]]; then
      if nginx_running; then
        log "Reloading nginx"
        sudo nginx -t && nginx_cmd reload
      else
        log "Starting nginx"
        sudo nginx -t && nginx_cmd start
      fi
    fi
    log "Restarted."
    ;;

  status)
    if pid="$(app_pid)"; then
      printf 'app    : running (pid %s) on %s:%s\n' "$pid" "$APP_HOST" "$APP_PORT"
    else
      printf 'app    : stopped\n'
    fi
    if nginx_running; then
      printf 'nginx  : running\n'
    else
      printf 'nginx  : stopped\n'
    fi
    code="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 \
      "http://$HEALTH_HOST:$APP_PORT/" 2>/dev/null || true)"
    printf 'health : %s\n' "${code:-unreachable}"
    printf 'log    : %s\n' "$LOG_FILE"
    ;;

  logs)
    [[ -f "$LOG_FILE" ]] || die "no log yet at $LOG_FILE"
    tail -f "$LOG_FILE"
    ;;

  *)
    printf 'usage: %s {start|stop|restart|status|logs}\n\n' "$0"
    printf 'env overrides: APP_HOST (default 0.0.0.0), APP_PORT, MANAGE_NGINX=0\n'
    printf 'bind to loopback only: APP_HOST=127.0.0.1 %s start\n' "$0"
    exit 2
    ;;
esac
