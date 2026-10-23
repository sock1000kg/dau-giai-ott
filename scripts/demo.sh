#!/usr/bin/env bash
# ==============================================================================
# scripts/demo.sh
# One-command local demo operations for the OTT Tournament stack (P2-T36).
#
# Subcommands:
#   up        Preflight, build, migrate, seed demo accounts, and wait healthy
#   status    Check service health, ready probe, and accounts CSV
#   accounts  Print accounts and roles from CSV without logging passwords
#   refresh   Reset data only and bring stack up fresh with existing env
#   logs      Tail logs from one or all stack services
#   round     BTC operator controls for round lifecycle (status|open|close|results)
#   stop      Stop running containers without removing volumes
#   reset     Confirm and remove stack containers, volumes, env, and CSV
# ==============================================================================
set -Eeuo pipefail
export PYTHONDONTWRITEBYTECODE=1

# ------------------------------------------------------------------------------
# Global Paths & Configuration
# ------------------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd))"
COMPOSE_FILE="${REPO_ROOT}/infra/local/compose.yaml"
COMPOSE_PROJECT="${OTT_DEMO_PROJECT:-ott-demo}"

# Safety guard: fixed Compose project prefix to prevent accidental mutation of other stacks
if [[ ! "${COMPOSE_PROJECT}" =~ ^ott-demo[a-z0-9-]*$ ]]; then
  echo "Error: Invalid project name '${COMPOSE_PROJECT}'. Must match pattern ^ott-demo[a-z0-9-]*$" >&2
  exit 2
fi

DEMO_ENV_FILE="${OTT_DEMO_ENV_FILE:-${REPO_ROOT}/.local/demo/demo.env}"
ACCOUNTS_CSV="${OTT_DEMO_ACCOUNTS_CSV:-${REPO_ROOT}/.local/demo/accounts.csv}"
DOCKER_SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"
DEMO_LIB_DIR="$(cd "${REPO_ROOT}/scripts/lib" 2>/dev/null && pwd || echo "${REPO_ROOT}/scripts/lib")"
DEMO_JSON_PY="${DEMO_LIB_DIR}/demo_json.py"

CLEANUP_FILES=()

cleanup() {
  local f
  for f in "${CLEANUP_FILES[@]:-}"; do
    if [[ -n "${f:-}" && -f "${f:-}" ]]; then
      rm -f "${f}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# ------------------------------------------------------------------------------
# Helper Functions
# ------------------------------------------------------------------------------
detect_docker_gid() {
  local gid=""
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    gid="$(docker run --rm -v "${DOCKER_SOCKET}":/s alpine stat -c %g /s 2>/dev/null || docker run --rm -v "${DOCKER_SOCKET}":/s node:22.12-alpine stat -c %g /s 2>/dev/null || true)"
  fi
  if [[ -z "${gid}" || ! "${gid}" =~ ^[0-9]+$ ]]; then
    if [[ -e "${DOCKER_SOCKET}" || -S "${DOCKER_SOCKET}" ]]; then
      gid="$(stat -c %g "${DOCKER_SOCKET}" 2>/dev/null || stat -f %g "${DOCKER_SOCKET}" 2>/dev/null || true)"
    fi
  fi
  if [[ -z "${gid}" || ! "${gid}" =~ ^[0-9]+$ ]]; then
    gid="0"
  fi
  echo "${gid}"
}

validate_ipv4() {
  local ip="$1"
  local rx='^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$'
  if [[ "${ip}" =~ $rx ]]; then
    local i
    for i in 1 2 3 4; do
      if (( BASH_REMATCH[i] > 255 )); then
        return 1
      fi
    done
    return 0
  fi
  return 1
}

generate_tester_password() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets; chars = [c for c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' if c not in '0O1lI']; print(''.join(secrets.choice(chars) for _ in range(12)))"
  else
    head -c 128 /dev/urandom | tr -dc '2-9A-HJ-NP-Za-km-z' | head -c 12
  fi
}

get_app_port() {
  local p=""
  if [[ -f "${DEMO_ENV_FILE}" ]]; then
    p="$(grep -E '^APP_PORT=' "${DEMO_ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d ' \r\n' || true)"
  fi
  if [[ -z "${p}" || ! "${p}" =~ ^[0-9]+$ ]]; then
    p="8080"
  fi
  echo "${p}"
}

check_port_free() {
  local port="$1"
  if command -v python3 >/dev/null 2>&1 && [[ -f "${DEMO_JSON_PY}" ]]; then
    python3 -B "${DEMO_JSON_PY}" check-port "${port}" 2>/dev/null || return 1
    return 0
  fi
  # Fallback: check /dev/tcp
  if (echo > /dev/tcp/127.0.0.1/"${port}") 2>/dev/null; then
    return 1
  fi
  return 0
}

find_free_port() {
  local avoid=("$@")
  if command -v python3 >/dev/null 2>&1 && [[ -f "${DEMO_JSON_PY}" ]]; then
    local p
    p="$(python3 -B "${DEMO_JSON_PY}" find-port "${avoid[@]:-}" 2>/dev/null)" || true
    if [[ -n "${p}" ]]; then
      echo "${p}"
      return 0
    fi
  fi
  # Fallback shell port scanning
  local p
  for p in $(seq 18181 18380); do
    local clash=0
    local a
    for a in "${avoid[@]:-}"; do
      if [[ "$p" == "$a" ]]; then
        clash=1
        break
      fi
    done
    if (( clash == 0 )) && ! (echo > /dev/tcp/127.0.0.1/"$p") 2>/dev/null; then
      echo "$p"
      return 0
    fi
  done
  echo "18080"
}

generate_secret() {
  openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# ------------------------------------------------------------------------------
# API Call Helper (Plan 2c/2d)
# ------------------------------------------------------------------------------
api_call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local extra_header="${4:-}"

  local port
  port="$(get_app_port)"
  local url="http://127.0.0.1:${port}${path}"

  local resp_file
  resp_file="$(mktemp "${TMPDIR:-/tmp}/ott-api-resp.XXXXXX")"
  CLEANUP_FILES+=("${resp_file}")

  local curl_err_file
  curl_err_file="$(mktemp "${TMPDIR:-/tmp}/ott-curl-err.XXXXXX")"
  CLEANUP_FILES+=("${curl_err_file}")

  local curl_args=(
    -sS
    -o "${resp_file}"
    -w "%{http_code}"
    -X "${method}"
  )

  if [[ -n "${COOKIE_JAR:-}" && -f "${COOKIE_JAR}" ]]; then
    curl_args+=(-c "${COOKIE_JAR}" -b "${COOKIE_JAR}")
  fi

  if [[ -n "${extra_header}" ]]; then
    curl_args+=(-H "${extra_header}")
  fi

  local http_code=""
  local rc=0

  if [[ "${body}" == "-" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data-binary @-)
    http_code="$(curl "${curl_args[@]}" "${url}" 2>"${curl_err_file}")" || rc=$?
  elif [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data-binary @-)
    http_code="$(printf '%s' "${body}" | curl "${curl_args[@]}" "${url}" 2>"${curl_err_file}")" || rc=$?
  else
    http_code="$(curl "${curl_args[@]}" "${url}" 2>"${curl_err_file}")" || rc=$?
  fi

  if (( rc != 0 )) || [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
    echo "API error: cannot reach ${url}" >&2
    if [[ -s "${curl_err_file}" ]]; then
      cat "${curl_err_file}" >&2
    fi
    return 1
  fi

  if [[ ! "${http_code}" =~ ^2[0-9]{2}$ ]]; then
    python3 -B "${DEMO_JSON_PY}" error "${http_code}" < "${resp_file}" >&2
    return 1
  fi

  cat "${resp_file}"
  return 0
}

print_urls() {
  local port="$1"
  local lan_ip=""
  lan_ip="$(hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i !~ /^127\./ && $i ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/){print $i; exit}}' || true)"
  echo ""
  echo "================================================================="
  echo "OTT Local Demo Stack is running!"
  echo "Local URL: http://127.0.0.1:${port}/"
  if [[ -n "${lan_ip}" ]]; then
    echo "LAN: http://${lan_ip}:${port}/ (same Wi-Fi/LAN only)"
  fi
  echo "Demo accounts: btc, team01, team02"
  echo "passwords are in the file: ${ACCOUNTS_CSV}"
  echo "================================================================="
}

print_public_urls() {
  local port="$1"
  echo ""
  echo "================================================================="
  echo "OTT Public Demo Stack is running!"
  echo "Local Gateway URL (point tunnel here): http://127.0.0.1:${port}/"
  echo "Usernames: btc, team01..team10"
  echo "Credentials CSV: ${ACCOUNTS_CSV}"
  echo "To view credentials, run: ./scripts/demo.sh accounts --reveal"
  echo "================================================================="
}

# ------------------------------------------------------------------------------
# Help Messages
# ------------------------------------------------------------------------------
main_help() {
  cat <<EOF
Usage: demo.sh <subcommand> [options]

One-command local demo operations for the OTT Tournament stack.

Subcommands:
  up        Build, start, migrate, seed demo accounts, and wait until healthy
  status    Check container status, ready probe, and accounts CSV
  accounts  Print demo accounts and roles (never prints passwords unless --reveal)
  refresh   Reset data only (wiping volumes) and re-up stack preserving env/credentials
  logs      Tail logs from one or all services (api, worker, web, postgres, ...)
  round     Manage qualification round lifecycle as BTC administrator
  stop      Stop running containers without destroying data volumes
  reset     Confirm and remove demo containers, volumes, env, and CSV

Run 'demo.sh <subcommand> --help' for details on each subcommand.
EOF
}

up_help() {
  cat <<EOF
Usage: demo.sh up [options]

Preflights prerequisites, generates configuration, builds images, starts
containers, runs migrations, seeds demo accounts, and waits for readiness.

Options:
  --public       Generate public demo mode configuration (10 teams, randomized passwords)
  --bind <ADDR>  Bind address for web gateway (default: 0.0.0.0)
  --port <PORT>  Port to publish the web gateway on (default: 8080)
  --no-build     Skip image build step (use pre-existing images)
  --help, -h     Show this help message
EOF
}

status_help() {
  cat <<EOF
Usage: demo.sh status [options]

Inspects local demo stack container status, verifies readiness probe,
and checks accounts CSV presence. Exits 0 if healthy, 1 otherwise.

Options:
  --help, -h     Show this help message
EOF
}

accounts_help() {
  cat <<EOF
Usage: demo.sh accounts [options]

Displays the demo accounts CSV location, verifies permissions mode 0600,
and lists usernames, roles, and teams. Never outputs plaintext passwords
unless explicit --reveal flag is provided.

Options:
  --reveal       Print the full credentials CSV including passwords to stdout
  --help, -h     Show this help message
EOF
}

refresh_help() {
  cat <<EOF
Usage: demo.sh refresh [options]

Performs a data-only reset of the demo stack: wipes containers and volumes,
preserves configuration (demo.env) and credentials (accounts.csv), and
restarts the stack fresh with the existing environment.

Options:
  --yes          Bypass confirmation prompt (required for cron/non-interactive)
  --help, -h     Show this help message
EOF
}

logs_help() {
  cat <<EOF
Usage: demo.sh logs [service] [options]

Wrapper over docker compose logs --tail 200.

Arguments:
  service        One of: api, worker, coordinator, web, migrate, postgres, redis, seaweedfs

Options:
  -f, --follow   Follow log output
  --help, -h     Show this help message
EOF
}

round_help() {
  cat <<EOF
Usage: demo.sh round <subcommand> [options]

BTC operator controls for qualification round lifecycle.

Subcommands:
  status         Show current tournament stage, round status, and active series
  open           Open round submissions (creates round & rule set if needed)
  close          Close submissions and schedule matches for the round
  results        Display current tournament leaderboard and series results

Options:
  --yes          Skip confirmation prompt for open / close actions
  --stage <NAME> Target tournament stage (default: QUALIFICATION)
  --help, -h     Show this help message

Note: The public API does not expose in-flight (RUNNING/SCHEDULED) series or
matches directly. The in-flight guard blocks against active round execution
states (RUNNING, SETTLING, PAUSED) in the round read model.
EOF
}

stop_help() {
  cat <<EOF
Usage: demo.sh stop [options]

Stops all demo containers while preserving database and object storage volumes.

Options:
  --help, -h     Show this help message
EOF
}

reset_help() {
  cat <<EOF
Usage: demo.sh reset [options]

Removes containers, volumes, demo environment file, and accounts CSV for the
fixed Compose project. Requires confirmation matching the project name.

Options:
  --yes          Bypass confirmation prompt (for automated testing)
  --help, -h     Show this help message
EOF
}

# ------------------------------------------------------------------------------
# Subcommand: up
# ------------------------------------------------------------------------------
sub_up() {
  local port="8080"
  local port_specified=0
  local build_flag="--build"
  local is_public=0
  local bind_addr="0.0.0.0"
  local from_refresh=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port)
        shift
        [[ $# -gt 0 ]] || { echo "Error: --port requires an argument" >&2; exit 2; }
        port="$1"
        port_specified=1
        shift
        ;;
      --no-build)
        build_flag=""
        shift
        ;;
      --public)
        is_public=1
        shift
        ;;
      --bind)
        shift
        [[ $# -gt 0 ]] || { echo "Error: --bind requires an argument" >&2; exit 2; }
        bind_addr="$1"
        shift
        ;;
      --from-refresh)
        # internal flag set by refresh; intentionally not in --help
        from_refresh=1
        shift
        ;;
      --help|-h)
        up_help
        exit 0
        ;;
      *)
        echo "Error: Unknown option '$1' for up. See 'demo.sh up --help'." >&2
        exit 2
        ;;
    esac
  done

  if [[ ! "${port}" =~ ^[0-9]+$ || "${port}" -lt 1 || "${port}" -gt 65535 ]]; then
    echo "Error: Port '${port}' must be an integer between 1 and 65535." >&2
    exit 2
  fi

  if ! validate_ipv4 "${bind_addr}"; then
    echo "Error: Invalid bind address '${bind_addr}'. Must be a valid IPv4 address (e.g. 0.0.0.0 or 127.0.0.1)." >&2
    exit 2
  fi

  # Preflight check 1: Bash version >= 4
  if (( BASH_VERSINFO[0] < 4 )); then
    echo "Error: bash version 4 or higher is required (current: ${BASH_VERSION})." >&2
    exit 1
  fi

  # Preflight check 2: Docker CLI & daemon reachable
  if ! command -v docker >/dev/null 2>&1; then
    echo "Error: docker command not found. Please install Docker." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker daemon is not reachable via 'docker info'." >&2
    exit 1
  fi

  # Preflight check 3: Docker version >= 24
  local docker_ver
  docker_ver="$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker version --format '{{.Client.Version}}' 2>/dev/null || true)"
  local major_ver="${docker_ver%%.*}"
  if [[ -n "${major_ver}" && "${major_ver}" =~ ^[0-9]+$ && "${major_ver}" -lt 24 ]]; then
    echo "Error: Docker version >= 24 is required (found ${docker_ver})." >&2
    exit 1
  fi

  # Preflight check 4: Docker compose v2 reachable
  if ! docker compose version >/dev/null 2>&1; then
    echo "Error: docker compose v2 is not available." >&2
    exit 1
  fi

  # Preflight check 5: Docker socket exists
  if [[ ! -e "${DOCKER_SOCKET}" && ! -S "${DOCKER_SOCKET}" ]]; then
    echo "Error: Docker socket not found at '${DOCKER_SOCKET}'." >&2
    exit 1
  fi

  # Preflight check: mode mixing guard if env file exists
  if [[ -f "${DEMO_ENV_FILE}" ]]; then
    if (( is_public == 1 )); then
      if ! grep -q '^DEMO_PUBLIC=true' "${DEMO_ENV_FILE}" 2>/dev/null; then
        echo "Error: env was created in local mode; run demo.sh reset first" >&2
        exit 1
      fi
    fi
  fi

  # If env file exists and port was not explicitly passed, reuse port from env file
  if [[ -f "${DEMO_ENV_FILE}" && "${port_specified}" -eq 0 ]]; then
    port="$(get_app_port)"
  fi

  # Preflight check 6: Idempotent up check (if stack env already initialized)
  if [[ -f "${DEMO_ENV_FILE}" && "${from_refresh}" -eq 0 ]]; then
    local ready_probe
    ready_probe="$(curl -sf -m 2 "http://127.0.0.1:${port}/api/v1/health/ready" 2>/dev/null || true)"
    local ready_pattern='"status":[[:space:]]*"ready"'
    if [[ "${ready_probe}" =~ ${ready_pattern} ]]; then
      echo "Demo stack '${COMPOSE_PROJECT}' is already running and healthy at http://127.0.0.1:${port}/."
      if (( is_public == 1 )) || grep -q '^DEMO_PUBLIC=true' "${DEMO_ENV_FILE}" 2>/dev/null; then
        print_public_urls "${port}"
      else
        print_urls "${port}"
      fi
      exit 0
    fi
  fi

  # Preflight check 7: Port free on host
  if ! check_port_free "${port}"; then
    echo "Error: Port ${port} is already in use on the host. Please choose a different port with --port <N>." >&2
    exit 1
  fi

  # Env file generation: generate .local/demo/demo.env if missing (mode 0600, never overwrite)
  local demo_dir
  demo_dir="$(dirname "${DEMO_ENV_FILE}")"
  mkdir -p -m 700 "${demo_dir}"

  if [[ ! -f "${DEMO_ENV_FILE}" ]]; then
    echo "Generating new demo environment configuration at ${DEMO_ENV_FILE}..."
    local pg_pass rd_pass s3_sec pg_port rd_port s3_port doc_gid
    pg_pass="$(generate_secret)"
    rd_pass="$(generate_secret)"
    s3_sec="$(generate_secret)"
    pg_port="$(find_free_port "${port}")"
    rd_port="$(find_free_port "${port}" "${pg_port}")"
    s3_port="$(find_free_port "${port}" "${pg_port}" "${rd_port}")"
    doc_gid="$(detect_docker_gid)"

    local tmp_env="${DEMO_ENV_FILE}.tmp.$$"
    if (( is_public == 1 )); then
      local btc_pass tester_pass
      btc_pass="$(generate_secret)"
      tester_pass="$(generate_tester_password)"
      cat > "${tmp_env}" <<EOF
POSTGRES_DB=ott_demo
POSTGRES_USER=ott_demo
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_PORT=${pg_port}
REDIS_PASSWORD=${rd_pass}
REDIS_PORT=${rd_port}
S3_ACCESS_KEY_ID=ott-demo-access
S3_SECRET_ACCESS_KEY=${s3_sec}
S3_BUCKET=ott-demo-bucket
S3_API_PORT=${s3_port}
APP_PORT=${port}
APP_BIND=${bind_addr}
DOCKER_SOCKET=${DOCKER_SOCKET}
DOCKER_GID=${doc_gid}
OTT_DEPLOYMENT_MODE=dev
OTT_SECURE_COOKIES=true
OTT_DEMO_MODE=true
OTT_BOOTSTRAP_BTC_USERNAME=btc
OTT_BOOTSTRAP_BTC_PASSWORD=${btc_pass}
OTT_DEMO_BTC_PASSWORD=${btc_pass}
OTT_DEMO_TEAM_COUNT=10
OTT_DEMO_TEAM_PASSWORD=${tester_pass}
OTT_DEMO_REFERENCE_BOT_HOST_DIR=${REPO_ROOT}/.local/demo/reference-bot
DEMO_UID=$(id -u)
DEMO_GID=$(id -g)
DEMO_PUBLIC=true
EOF
    else
      cat > "${tmp_env}" <<EOF
POSTGRES_DB=ott_demo
POSTGRES_USER=ott_demo
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_PORT=${pg_port}
REDIS_PASSWORD=${rd_pass}
REDIS_PORT=${rd_port}
S3_ACCESS_KEY_ID=ott-demo-access
S3_SECRET_ACCESS_KEY=${s3_sec}
S3_BUCKET=ott-demo-bucket
S3_API_PORT=${s3_port}
APP_PORT=${port}
APP_BIND=${bind_addr}
DOCKER_SOCKET=${DOCKER_SOCKET}
DOCKER_GID=${doc_gid}
OTT_DEPLOYMENT_MODE=dev
OTT_SECURE_COOKIES=false
OTT_DEMO_MODE=true
OTT_BOOTSTRAP_BTC_USERNAME=btc
OTT_BOOTSTRAP_BTC_PASSWORD=ABC123
OTT_DEMO_REFERENCE_BOT_HOST_DIR=${REPO_ROOT}/.local/demo/reference-bot
DEMO_UID=$(id -u)
DEMO_GID=$(id -g)
EOF
    fi
    chmod 0600 "${tmp_env}"
    mv -n "${tmp_env}" "${DEMO_ENV_FILE}"
    chmod 0600 "${DEMO_ENV_FILE}"
  fi

  # Keep an optional BTC reference archive outside git and expose only its read-only mount.
  local reference_bot_dir="${OTT_DEMO_REFERENCE_BOT_HOST_DIR:-${REPO_ROOT}/.local/demo/reference-bot}"
  mkdir -p -m 700 "${reference_bot_dir}"
  chmod 700 "${reference_bot_dir}"
  export OTT_DEMO_REFERENCE_BOT_HOST_DIR="$(cd "${reference_bot_dir}" && pwd)"
  if [[ -n "${OTT_DEMO_REFERENCE_BOT_ARCHIVE:-}" ]]; then
    if [[ "${OTT_DEMO_REFERENCE_BOT_ARCHIVE}" == /reference-bot/* ]]; then
      : # Container path is already configured in the private demo env file.
    else
      echo "Error: OTT_DEMO_REFERENCE_BOT_ARCHIVE must use the container path /reference-bot/<filename> in ${DEMO_ENV_FILE}." >&2
      exit 1
    fi
  fi
  if [[ -f "${DEMO_ENV_FILE}" ]] && ! rg -q '^OTT_DEMO_REFERENCE_BOT_HOST_DIR=' "${DEMO_ENV_FILE}"; then
    printf '\nOTT_DEMO_REFERENCE_BOT_HOST_DIR=%s\n' "${OTT_DEMO_REFERENCE_BOT_HOST_DIR}" >> "${DEMO_ENV_FILE}"
    chmod 0600 "${DEMO_ENV_FILE}"
  fi

  # Ensure the accounts CSV directory exists (mode 0700) and is what seed-demo mounts.
  # OTT_DEMO_ACCOUNTS_CSV may point outside .local/demo (e.g. the e2e runner); never write the default dir then.
  mkdir -p -m 700 "$(dirname "${ACCOUNTS_CSV}")"
  OTT_DEMO_ACCOUNTS_DIR="$(cd "$(dirname "${ACCOUNTS_CSV}")" && pwd)"
  OTT_DEMO_ACCOUNTS_BASENAME="$(basename "${ACCOUNTS_CSV}")"
  export OTT_DEMO_ACCOUNTS_DIR OTT_DEMO_ACCOUNTS_BASENAME

  echo "Bringing up Docker Compose project '${COMPOSE_PROJECT}'..."
  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" up ${build_flag:+"$build_flag"} --wait

  echo "Seeding demo accounts..."
  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" --profile demo run --rm seed-demo

  echo "Waiting for healthiness at http://127.0.0.1:${port}/api/v1/health/ready..."
  local timeout=180
  local start_time
  start_time="$(date +%s)"
  local healthy=0

  while true; do
    local probe
    probe="$(curl -sf -m 2 "http://127.0.0.1:${port}/api/v1/health/ready" 2>/dev/null || true)"
    local ready_pattern='"status":[[:space:]]*"ready"'
    if [[ "${probe}" =~ ${ready_pattern} ]]; then
      healthy=1
      break
    fi
    local now
    now="$(date +%s)"
    if (( now - start_time >= timeout )); then
      break
    fi
    sleep 2
  done

  if (( healthy == 0 )); then
    echo "Error: Timed out waiting 180s for ready probe at http://127.0.0.1:${port}/api/v1/health/ready" >&2
    echo "--- Docker Compose Process Status ---" >&2
    docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" ps >&2 || true
    echo "--- Recent Service Logs ---" >&2
    docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" logs --tail 50 >&2 || true
    exit 1
  fi

  if (( is_public == 1 )) || grep -q '^DEMO_PUBLIC=true' "${DEMO_ENV_FILE}" 2>/dev/null; then
    print_public_urls "${port}"
  else
    print_urls "${port}"
  fi
}

# ------------------------------------------------------------------------------
# Subcommand: status
# ------------------------------------------------------------------------------
sub_status() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        status_help
        exit 0
        ;;
      *)
        echo "Error: Unknown option '$1' for status." >&2
        exit 2
        ;;
    esac
  done

  local port
  port="$(get_app_port)"

  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" ps

  local ready=0
  local probe
  probe="$(curl -sf -m 5 "http://127.0.0.1:${port}/api/v1/health/ready" 2>/dev/null || true)"
  local ready_pattern='"status":[[:space:]]*"ready"'
  if [[ "${probe}" =~ ${ready_pattern} ]]; then
    ready=1
    echo "Health ready probe: OK (ready)"
  else
    echo "Health ready probe: FAILED"
  fi

  local csv_ok=0
  if [[ -f "${ACCOUNTS_CSV}" ]]; then
    csv_ok=1
    echo "Accounts CSV: present (${ACCOUNTS_CSV})"
  else
    echo "Accounts CSV: MISSING (${ACCOUNTS_CSV})"
  fi

  if (( ready == 1 && csv_ok == 1 )); then
    echo "Stack status: OK"
    exit 0
  else
    echo "Stack status: FAILED"
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Subcommand: accounts
# ------------------------------------------------------------------------------
sub_accounts() {
  local reveal=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --reveal)
        reveal=1
        shift
        ;;
      --help|-h)
        accounts_help
        exit 0
        ;;
      *)
        echo "Error: Unknown option '$1' for accounts." >&2
        exit 2
        ;;
    esac
  done

  if [[ ! -f "${ACCOUNTS_CSV}" ]]; then
    echo "Error: Accounts CSV not found at '${ACCOUNTS_CSV}'. Has 'demo.sh up' been run?" >&2
    exit 1
  fi

  local mode
  mode="$(stat -c %a "${ACCOUNTS_CSV}" 2>/dev/null || stat -f %Lp "${ACCOUNTS_CSV}" 2>/dev/null || echo "")"
  if [[ -n "${mode}" && "${mode}" != "600" ]]; then
    echo "Warning: CSV permissions mode is ${mode} (expected 0600)" >&2
  fi

  if (( reveal == 1 )); then
    echo "Warning: Revealing credentials including plaintext passwords to stdout." >&2
    cat "${ACCOUNTS_CSV}"
    return 0
  fi

  echo "Accounts CSV: ${ACCOUNTS_CSV}"
  if [[ -z "${mode}" || "${mode}" == "600" ]]; then
    echo "Mode: ${mode:-0600}"
  fi
  echo "passwords are in the file"
  echo ""
  awk -F',' '{printf "%-12s %-16s %s\n", $1, $3, $4}' "${ACCOUNTS_CSV}"
}

# ------------------------------------------------------------------------------
# Subcommand: refresh
# ------------------------------------------------------------------------------
sub_refresh() {
  local yes=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes)
        yes=1
        shift
        ;;
      --help|-h)
        refresh_help
        exit 0
        ;;
      *)
        echo "Error: Unknown argument '$1' for refresh. Usage: demo.sh refresh [--yes]" >&2
        exit 2
        ;;
    esac
  done

  # Safety check project name pattern
  if [[ ! "${COMPOSE_PROJECT}" =~ ^ott-demo[a-z0-9-]*$ ]]; then
    echo "Error: Invalid project name '${COMPOSE_PROJECT}'. Must match pattern ^ott-demo[a-z0-9-]*$" >&2
    exit 2
  fi

  if (( yes == 0 )); then
    local confirmation=""
    if [[ -t 0 ]]; then
      read -r -p "Type '${COMPOSE_PROJECT}' to confirm refresh (data reset only): " confirmation
    else
      if ! read -r confirmation; then
        echo "Error: Refresh requires confirmation. Type '${COMPOSE_PROJECT}' or pass --yes." >&2
        exit 1
      fi
    fi
    if [[ "${confirmation}" != "${COMPOSE_PROJECT}" ]]; then
      echo "Refresh aborted: Confirmation does not match project name '${COMPOSE_PROJECT}'." >&2
      exit 1
    fi
  fi

  # Check demo.env exists before taking any docker action
  if [[ ! -f "${DEMO_ENV_FILE}" ]]; then
    echo "Error: no demo env at ${DEMO_ENV_FILE}; run demo.sh up [--public] first" >&2
    exit 1
  fi

  # Concurrency lock against concurrent runs
  local lock_file="${DEMO_ENV_FILE}.lock"
  mkdir -p -m 700 "$(dirname "${lock_file}")"

  local lock_dir="${DEMO_ENV_FILE}.lock_dir"
  local lock_fd

  if command -v flock >/dev/null 2>&1; then
    exec {lock_fd}>"${lock_file}"
    if ! flock -n "${lock_fd}"; then
      echo "Error: Another demo.sh refresh is currently running (locked via ${lock_file})." >&2
      exit 1
    fi
  else
    if ! mkdir "${lock_dir}" 2>/dev/null; then
      local old_pid=""
      if [[ -f "${lock_dir}/pid" ]]; then
        old_pid="$(cat "${lock_dir}/pid" 2>/dev/null || true)"
      fi
      if [[ -n "${old_pid}" ]] && ! kill -0 "${old_pid}" 2>/dev/null; then
        rm -rf "${lock_dir}" 2>/dev/null || true
        if ! mkdir "${lock_dir}" 2>/dev/null; then
          echo "Error: Another demo.sh refresh is currently running." >&2
          exit 1
        fi
      else
        echo "Error: Another demo.sh refresh is currently running." >&2
        exit 1
      fi
    fi
    echo "$$" > "${lock_dir}/pid"
    CLEANUP_FILES+=("${lock_dir}")
  fi

  echo "Refreshing demo stack for project '${COMPOSE_PROJECT}' (preserving demo.env and accounts.csv)..."
  export DOCKER_GID="${DOCKER_GID:-$(detect_docker_gid)}"
  if [[ -f "${DEMO_ENV_FILE}" ]]; then
    docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" down --volumes --remove-orphans || true
  else
    docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" down --volumes --remove-orphans || true
  fi

  local up_args=(--from-refresh)
  if docker image inspect ott-api:local ott-worker:local ott-web:local >/dev/null 2>&1; then
    up_args+=(--no-build)
  fi

  if [[ -f "${DEMO_ENV_FILE}" ]] && grep -q '^DEMO_PUBLIC=true' "${DEMO_ENV_FILE}" 2>/dev/null; then
    up_args+=(--public)
  fi

  sub_up "${up_args[@]}"
}

# ------------------------------------------------------------------------------
# Subcommand: logs
# ------------------------------------------------------------------------------
sub_logs() {
  local service=""
  local follow=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        logs_help
        exit 0
        ;;
      api|worker|coordinator|web|migrate|postgres|redis|seaweedfs)
        service="$1"
        shift
        ;;
      -f|--follow)
        follow="-f"
        shift
        ;;
      *)
        echo "Error: Unknown argument '$1' for logs. Allowed services: api, worker, coordinator, web, migrate, postgres, redis, seaweedfs. Allowed flags: -f, --follow" >&2
        exit 2
        ;;
    esac
  done

  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" logs --tail 200 ${follow:+"$follow"} ${service:+"$service"}
}

# ------------------------------------------------------------------------------
# Subcommand: stop
# ------------------------------------------------------------------------------
sub_stop() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        stop_help
        exit 0
        ;;
      *)
        echo "Error: Unknown option '$1' for stop." >&2
        exit 2
        ;;
    esac
  done

  echo "Stopping demo stack for project '${COMPOSE_PROJECT}' (volumes preserved)..."
  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" stop
}

# ------------------------------------------------------------------------------
# Subcommand: reset
# ------------------------------------------------------------------------------
sub_reset() {
  local yes=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes)
        yes=1
        shift
        ;;
      --help|-h)
        reset_help
        exit 0
        ;;
      *)
        echo "Error: Unknown argument '$1' for reset. Usage: demo.sh reset [--yes]" >&2
        exit 2
        ;;
    esac
  done

  echo "Target Compose project: ${COMPOSE_PROJECT}"
  echo ""
  echo "Containers to remove:"
  if [[ -f "${DEMO_ENV_FILE}" ]]; then
    docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" ps -a 2>/dev/null || docker ps -a --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" 2>/dev/null || true
  else
    docker ps -a --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" 2>/dev/null || true
  fi
  echo ""
  echo "Volumes to remove:"
  docker volume ls --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" 2>/dev/null || true
  echo ""
  echo "Files to delete (clean start):"
  echo "  - ${ACCOUNTS_CSV}"
  echo "  - ${DEMO_ENV_FILE}"
  echo ""

  if (( yes == 0 )); then
    local confirmation=""
    if [[ -t 0 ]]; then
      read -r -p "Type '${COMPOSE_PROJECT}' to confirm reset: " confirmation
    else
      if ! read -r confirmation; then
        echo "Error: Reset requires confirmation. Type '${COMPOSE_PROJECT}' or pass --yes." >&2
        exit 1
      fi
    fi
    if [[ "${confirmation}" != "${COMPOSE_PROJECT}" ]]; then
      echo "Reset aborted: Confirmation does not match project name '${COMPOSE_PROJECT}'." >&2
      exit 1
    fi
  fi

  echo "Removing containers and volumes for project '${COMPOSE_PROJECT}'..."
  export DOCKER_GID="${DOCKER_GID:-$(detect_docker_gid)}"
  if [[ -f "${DEMO_ENV_FILE}" ]]; then
    docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${DEMO_ENV_FILE}" down --volumes --remove-orphans || true
  else
    echo "No env file; removing project resources by label..."
    local c_ids v_names n_names
    c_ids="$(docker ps -aq --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" 2>/dev/null || true)"
    if [[ -n "${c_ids}" ]]; then
      docker rm -f ${c_ids} >/dev/null 2>&1 || true
    fi
    v_names="$(docker volume ls -q --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" 2>/dev/null || true)"
    if [[ -n "${v_names}" ]]; then
      docker volume rm -f ${v_names} >/dev/null 2>&1 || true
    fi
    n_names="$(docker network ls -q --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" 2>/dev/null || true)"
    if [[ -n "${n_names}" ]]; then
      docker network rm ${n_names} >/dev/null 2>&1 || true
    fi
  fi

  rm -f "${ACCOUNTS_CSV}" "${DEMO_ENV_FILE}"
  echo "Reset complete."
}

# ------------------------------------------------------------------------------
# Subcommand: round
# ------------------------------------------------------------------------------
sub_round() {
  local sub=""
  local yes=0
  local force=0
  local stage="QUALIFICATION"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      status|open|close|results)
        sub="$1"
        shift
        ;;
      --yes)
        yes=1
        shift
        ;;
      --force)
        force=1
        shift
        ;;
      --stage)
        shift
        [[ $# -gt 0 ]] || { echo "Error: --stage requires an argument" >&2; exit 2; }
        stage="$1"
        shift
        ;;
      --help|-h)
        round_help
        exit 0
        ;;
      *)
        echo "Error: Unknown argument '$1' for round. See 'demo.sh round --help'." >&2
        exit 2
        ;;
    esac
  done

  if [[ -z "${sub}" ]]; then
    echo "Error: Missing round subcommand. Usage: demo.sh round <status|open|close|results> [--yes] [--stage STAGE]" >&2
    exit 2
  fi

  local port
  port="$(get_app_port)"

  # Preflight check: Python 3 required on host for round operations
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for JSON processing in 'demo.sh round'. Please install python3." >&2
    exit 1
  fi

  if [[ ! -f "${DEMO_JSON_PY}" ]]; then
    echo "Error: Helper script '${DEMO_JSON_PY}' not found." >&2
    exit 1
  fi

  # Verify gateway is reachable
  if ! curl -sf -m 3 "http://127.0.0.1:${port}/api/v1/health/live" >/dev/null 2>&1; then
    echo "Error: Demo stack is not reachable at http://127.0.0.1:${port}. Run 'demo.sh up' first." >&2
    exit 1
  fi

  # Authenticate as BTC admin using password from accounts CSV without putting credentials on argv
  if [[ ! -f "${ACCOUNTS_CSV}" ]]; then
    echo "Error: Accounts CSV not found at '${ACCOUNTS_CSV}'. Cannot authenticate as btc." >&2
    exit 1
  fi

  local btc_pass
  btc_pass="$(awk -F',' '$1=="btc"{print $2}' "${ACCOUNTS_CSV}")"
  if [[ -z "${btc_pass}" ]]; then
    echo "Error: Could not read BTC password from '${ACCOUNTS_CSV}'." >&2
    exit 1
  fi

  export COOKIE_JAR
  COOKIE_JAR="$(mktemp "${TMPDIR:-/tmp}/ott-cookie.XXXXXX")"
  chmod 0600 "${COOKIE_JAR}"
  CLEANUP_FILES+=("${COOKIE_JAR}")

  local login_body
  login_body="$(DEMO_USER=btc DEMO_PASS="${btc_pass}" python3 -B "${DEMO_JSON_PY}" login-body)"

  if ! printf '%s' "${login_body}" | api_call POST "/api/v1/auth/login" - >/dev/null; then
    echo "Error: BTC login failed at http://127.0.0.1:${port}/api/v1/auth/login." >&2
    exit 1
  fi

  case "${sub}" in
    status)
      round_status "${stage}"
      ;;
    open)
      round_open "${stage}" "${yes}" "${force}"
      ;;
    close)
      round_close "${stage}" "${yes}" "${force}"
      ;;
    results)
      round_results "${stage}"
      ;;
  esac
}

round_check_in_flight() {
  local stage="$1"
  local force="${2:-0}"

  if (( force == 1 )); then
    echo "Warning: --force passed; bypassing round in-flight safety check." >&2
    return 0
  fi

  local rounds_json
  rounds_json="$(api_call GET "/api/v1/admin/rounds?tournamentStage=${stage}")" || {
    echo "Error: In-flight guard failed to query round read model. Guard fails closed." >&2
    return 1
  }

  local in_flight=""
  in_flight="$(printf '%s' "${rounds_json}" | python3 -B "${DEMO_JSON_PY}" inflight-check)" || {
    local rc=$?
    if (( rc == 2 )); then
      echo "Error: In-flight guard failed to parse round read model. Guard fails closed." >&2
    else
      echo "Error: Active round execution in-flight: ${in_flight}. Operation refused while execution is active." >&2
    fi
    return 1
  }

  return 0
}

round_confirm() {
  local action="$1"
  local yes="$2"
  if (( yes == 1 )); then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    echo "Error: Round ${action} requires confirmation. Pass --yes in non-interactive mode." >&2
    exit 1
  fi
  local confirm=""
  read -r -p "Confirm round ${action}? [y/N]: " confirm
  if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
    echo "Round ${action} aborted." >&2
    exit 1
  fi
}

round_status() {
  local stage="$1"

  local rounds_file
  rounds_file="$(mktemp "${TMPDIR:-/tmp}/ott-rounds.XXXXXX")"
  CLEANUP_FILES+=("${rounds_file}")
  api_call GET "/api/v1/admin/rounds?tournamentStage=${stage}" > "${rounds_file}" || exit 1

  local series_file
  series_file="$(mktemp "${TMPDIR:-/tmp}/ott-series.XXXXXX")"
  CLEANUP_FILES+=("${series_file}")
  api_call GET "/api/v1/results/series?stage=${stage}" > "${series_file}" || exit 1

  python3 -B "${DEMO_JSON_PY}" round-status --stage "${stage}" --rounds "${rounds_file}" --series "${series_file}"
}

round_open() {
  local stage="$1"
  local yes="$2"
  local force="${3:-0}"

  round_check_in_flight "${stage}" "${force}" || exit 1
  round_confirm "open" "${yes}"

  local rounds_file
  rounds_file="$(mktemp "${TMPDIR:-/tmp}/ott-rounds-open.XXXXXX")"
  CLEANUP_FILES+=("${rounds_file}")

  api_call GET "/api/v1/admin/rounds?tournamentStage=${stage}" > "${rounds_file}" || exit 1

  local open_id
  open_id="$(python3 -B "${DEMO_JSON_PY}" round-find --action open "${rounds_file}" || true)"
  if [[ -n "${open_id}" ]]; then
    echo "Round ${open_id} is already SUBMISSION_OPEN."
    return 0
  fi

  # Step A: Resolve or create rule set BEFORE creating the round
  local rulesets_file
  rulesets_file="$(mktemp "${TMPDIR:-/tmp}/ott-rulesets.XXXXXX")"
  CLEANUP_FILES+=("${rulesets_file}")

  api_call GET "/api/v1/admin/round-rule-sets?tournamentStage=${stage}" > "${rulesets_file}" || exit 1

  local ruleset_id
  ruleset_id="$(python3 -B "${DEMO_JSON_PY}" field data.items.0.id "${rulesets_file}" || true)"

  if [[ -z "${ruleset_id}" ]]; then
    echo "No existing rule set found. Fetching catalog to construct default rule set for stage ${stage}..."
    local cat_json
    cat_json="$(api_call GET "/api/v1/admin/rounds/catalog")" || exit 1

    local rule_set_payload
    rule_set_payload="$(printf '%s' "${cat_json}" | python3 -B "${DEMO_JSON_PY}" catalog-ruleset --stage "${stage}")" || exit 1

    local rs_resp
    rs_resp="$(printf '%s' "${rule_set_payload}" | api_call POST "/api/v1/admin/round-rule-sets" -)" || exit 1

    ruleset_id="$(printf '%s' "${rs_resp}" | python3 -B "${DEMO_JSON_PY}" field data.id)" || exit 1
    echo "Created rule set: ${ruleset_id}"
  else
    echo "Using existing rule set: ${ruleset_id}"
  fi

  # Step B: Create qualification round
  echo "Creating new qualification round for stage ${stage}..."
  local create_body
  create_body="$(printf '{"tournamentStage":"%s","reason":"Demo qualification round via demo.sh"}' "${stage}")"

  local round_resp
  round_resp="$(printf '%s' "${create_body}" | api_call POST "/api/v1/admin/rounds" -)" || exit 1

  local target_round_id
  target_round_id="$(printf '%s' "${round_resp}" | python3 -B "${DEMO_JSON_PY}" field data.id)" || exit 1

  # Step C: Transition to SUBMISSION_OPEN
  echo "Transitioning round ${target_round_id} to SUBMISSION_OPEN..."
  local open_body
  open_body="$(printf '{"reason":"Opening round submissions via demo.sh","ruleSetId":"%s"}' "${ruleset_id}")"

  if ! printf '%s' "${open_body}" | api_call POST "/api/v1/admin/rounds/${target_round_id}/open" - >/dev/null; then
    echo "Error: Failed to open round ${target_round_id}." >&2
    echo "Round ID: ${target_round_id}" >&2
    echo "Recovery hint: Run 'demo.sh round status' to check state; retry with 'demo.sh round open'." >&2
    exit 1
  fi

  echo "Round ${target_round_id} is now open for bot submissions (SUBMISSION_OPEN)."
}

round_close() {
  local stage="$1"
  local yes="${2:-0}"
  local force="${3:-0}"

  round_check_in_flight "${stage}" "${force}" || exit 1
  round_confirm "close" "${yes}"

  local rounds_file
  rounds_file="$(mktemp "${TMPDIR:-/tmp}/ott-rounds-close.XXXXXX")"
  CLEANUP_FILES+=("${rounds_file}")

  api_call GET "/api/v1/admin/rounds?tournamentStage=${stage}" > "${rounds_file}" || exit 1

  local target_round_info
  target_round_info="$(python3 -B "${DEMO_JSON_PY}" round-find --action close "${rounds_file}" || true)"

  if [[ -z "${target_round_info}" ]]; then
    echo "Error: No round found in SUBMISSION_OPEN or SUBMISSION_CLOSED state for stage ${stage}." >&2
    exit 1
  fi

  local target_round_id
  local target_round_status
  local ruleset_id
  target_round_id="$(echo "${target_round_info}" | cut -d: -f1)"
  target_round_status="$(echo "${target_round_info}" | cut -d: -f2)"
  ruleset_id="$(echo "${target_round_info}" | cut -d: -f3)"

  if [[ "${target_round_status}" == "SUBMISSION_OPEN" ]]; then
    echo "Closing submissions for round ${target_round_id}..."
    local close_body='{"reason":"Closing submissions via demo.sh"}'
    if ! printf '%s' "${close_body}" | api_call POST "/api/v1/admin/rounds/${target_round_id}/close" - >/dev/null; then
      echo "Error: Failed to close round submissions for ${target_round_id}." >&2
      echo "Round ID: ${target_round_id}" >&2
      echo "Recovery hint: Run 'demo.sh round status' to check state; retry with 'demo.sh round close'." >&2
      exit 1
    fi
    echo "Round ${target_round_id} is now SUBMISSION_CLOSED."
  fi

  echo "Starting round ${target_round_id} (scheduling match jobs)..."
  local key="demo-start-${target_round_id}-$(date +%s)"
  local start_body
  start_body="$(printf '{"reason":"Starting round via demo.sh","ruleSetId":"%s"}' "${ruleset_id}")"
  local start_resp_file
  start_resp_file="$(mktemp "${TMPDIR:-/tmp}/ott-start-resp.XXXXXX")"
  CLEANUP_FILES+=("${start_resp_file}")

  if ! printf '%s' "${start_body}" | api_call POST "/api/v1/admin/rounds/${target_round_id}/start" - "Idempotency-Key: ${key}" > "${start_resp_file}"; then
    echo "Error: Failed to start round ${target_round_id}." >&2
    echo "Round ID: ${target_round_id}" >&2
    echo "Recovery hint: Run 'demo.sh round status' to check state; retry with 'demo.sh round close'." >&2
    echo "Round start needs at least 2 teams with ACTIVE (gate-passed) submissions. Have team01/team02 upload bots in the web UI, wait for preflight, then run: demo.sh round close" >&2
    echo "Note: If the error above is 500 INTERNAL_ERROR, this is a known API gap (SCHEDULING_INSUFFICIENT_TEAMS is not yet mapped to a 4xx client error)." >&2
    exit 1
  fi

  local start_status
  start_status="$(python3 -B "${DEMO_JSON_PY}" field data.status "${start_resp_file}" 2>/dev/null || true)"
  local replayed
  replayed="$(python3 -B "${DEMO_JSON_PY}" field replayed "${start_resp_file}" 2>/dev/null || true)"

  if [[ "${start_status}" == "RUNNING" || "${start_status}" == "SETTLING" || "${start_status}" == "RATED" || "${start_status}" == "PUBLISHED" || "${replayed}" == "True" || "${replayed}" == "true" ]]; then
    echo "Round ${target_round_id} is now ${start_status:-RUNNING}. Matches scheduled to queue."
  else
    echo "Error: Round ${target_round_id} is in unexpected state '${start_status}' after start." >&2
    echo "Round ID: ${target_round_id}" >&2
    echo "Recovery hint: Run 'demo.sh round status' to check state; retry with 'demo.sh round close'." >&2
    exit 1
  fi
}

round_results() {
  local stage="$1"

  local lb_file
  lb_file="$(mktemp "${TMPDIR:-/tmp}/ott-lb.XXXXXX")"
  CLEANUP_FILES+=("${lb_file}")

  local series_file
  series_file="$(mktemp "${TMPDIR:-/tmp}/ott-series-res.XXXXXX")"
  CLEANUP_FILES+=("${series_file}")

  api_call GET "/api/v1/leaderboard?stage=${stage}" > "${lb_file}" || exit 1
  api_call GET "/api/v1/results/series?stage=${stage}" > "${series_file}" || exit 1

  python3 -B "${DEMO_JSON_PY}" round-results --stage "${stage}" --leaderboard "${lb_file}" --series "${series_file}"
}

# ------------------------------------------------------------------------------
# Subcommand Dispatcher
# ------------------------------------------------------------------------------
if [[ $# -eq 0 ]]; then
  main_help >&2
  exit 2
fi

COMMAND="$1"
shift

case "${COMMAND}" in
  up)
    sub_up "$@"
    ;;
  status)
    sub_status "$@"
    ;;
  accounts)
    sub_accounts "$@"
    ;;
  refresh)
    sub_refresh "$@"
    ;;
  logs)
    sub_logs "$@"
    ;;
  round)
    sub_round "$@"
    ;;
  stop)
    sub_stop "$@"
    ;;
  reset)
    sub_reset "$@"
    ;;
  --help|-h)
    main_help
    exit 0
    ;;
  *)
    echo "Error: Unknown subcommand '${COMMAND}'." >&2
    main_help >&2
    exit 2
    ;;
esac
