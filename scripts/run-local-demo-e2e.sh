#!/usr/bin/env bash
# ==============================================================================
# scripts/run-local-demo-e2e.sh
# Clean-checkout demo qualification through the gateway (P2-T37 API-level).
#
# Gateway Port Selection:
#   Default: Scans fixed range 18080..18180, skipping reserved (8080, 5432,
#            6379, 8333) and in-use ports, verifying bindability on 0.0.0.0.
#   Override: Pass --port <PORT> or set APP_PORT=<PORT>.
#
# Flags:
#   --clean-checkout  Run the E2E suite in an isolated git worktree from HEAD
#   --port <PORT>     Use a specific gateway port (skips port scan)
# ==============================================================================
set -Eeuo pipefail
export PYTHONDONTWRITEBYTECODE=1

# ------------------------------------------------------------------------------
# Script-level Globals for State and Cleanup Trap
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_DIR="${REPO_ROOT}"
PROJECT_NAME="${OTT_DEMO_PROJECT:-ott-demo-e2e}"
APP_PORT="${APP_PORT:-}"
CLEANUP_CALLED=0
DEMO_E2E_DIR=""
WORKTREE_DIR=""
CLEAN_CHECKOUT=0
DEV_DEMO_DIR="${REPO_ROOT}/.local/demo"
DEV_DEMO_INITIAL_FINGERPRINT=""
OTT_DEMO_SCRIPT="${OTT_DEMO_SCRIPT:-}"

# ------------------------------------------------------------------------------
# Utility Functions (Testable and exportable when sourced)
# ------------------------------------------------------------------------------

compute_demo_fingerprint() {
  local target_dir="${1:-}"
  if [[ -z "${target_dir}" || ! -d "${target_dir}" ]]; then
    echo "absent"
    return 0
  fi

  local entry_count
  entry_count="$(LC_ALL=C find "${target_dir}" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)"
  if (( entry_count == 0 )); then
    echo "absent"
    return 0
  fi

  (
    cd "${target_dir}" || exit 1
    # Check directory entries without . and .. (stable locale, attributes and subsecond timestamp)
    if find . -maxdepth 0 -printf "" 2>/dev/null; then
      LC_ALL=C find . -mindepth 1 -maxdepth 1 -printf '%M %u %g %s %T@ %P\n' 2>/dev/null | LC_ALL=C sort
    else
      LC_ALL=C ls -lA 2>/dev/null | grep -v '^total' | LC_ALL=C sort
    fi
    # Checksums for all regular files (including dotfiles)
    LC_ALL=C find . -mindepth 1 -maxdepth 1 -type f -exec sha256sum {} + 2>/dev/null | LC_ALL=C sort -k2
  )
}

is_port_bindable() {
  local port="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("0.0.0.0", int(sys.argv[1])))
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)' "${port}" 2>/dev/null
    return $?
  fi

  # Fallback probing if python3 is unavailable
  if command -v ss >/dev/null 2>&1; then
    ! ss -ltn "( sport = :${port} )" 2>/dev/null | grep -q ":${port} "
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    ! nc -z 127.0.0.1 "${port}" 2>/dev/null
    return $?
  fi
  return 0
}

find_free_demo_port() {
  local reserved=(8080 5432 6379 8333)
  local candidate
  for ((candidate=18080; candidate<=18180; candidate++)); do
    local is_reserved=0
    for r in "${reserved[@]}"; do
      if (( candidate == r )); then
        is_reserved=1
        break
      fi
    done
    if (( is_reserved == 1 )); then
      continue
    fi
    if is_port_bindable "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
  done
  echo "Error: No free port found in range 18080..18180 for web gateway." >&2
  return 1
}

# ------------------------------------------------------------------------------
# Guarded EXIT Trap (Top-level definition so all globals remain in scope)
# ------------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  if (( ${CLEANUP_CALLED:-0} == 1 )); then
    return
  fi
  CLEANUP_CALLED=1

  local p="${PROJECT_NAME:-ott-demo-e2e}"
  echo "==> Cleaning up demo E2E stack (project: ${p})..."

  local demo_script="${OTT_DEMO_SCRIPT:-${RUN_DIR:-}/scripts/demo.sh}"
  local e2e_dir="${DEMO_E2E_DIR:-${RUN_DIR:-${REPO_ROOT}}/.local/demo-e2e}"
  local env_file="${OTT_DEMO_ENV_FILE:-${e2e_dir}/demo.env}"
  local accounts_csv="${OTT_DEMO_ACCOUNTS_CSV:-${e2e_dir}/accounts.csv}"

  if [[ -n "${RUN_DIR:-}" && -f "${demo_script}" ]]; then
    (cd "${RUN_DIR}" && OTT_DEMO_PROJECT="${p}" OTT_DEMO_ENV_FILE="${env_file}" OTT_DEMO_ACCOUNTS_CSV="${accounts_csv}" bash "${demo_script}" reset --yes 2>&1) || true
    if [[ -d "${e2e_dir}" ]]; then
      rm -rf "${e2e_dir}" 2>/dev/null || true
    fi
  fi

  local leaked_containers=""
  local leaked_volumes=""
  if command -v docker >/dev/null 2>&1; then
    leaked_containers="$(docker ps -a --filter "label=com.docker.compose.project=${p}" -q 2>/dev/null || true)"
    leaked_volumes="$(docker volume ls --filter "label=com.docker.compose.project=${p}" -q 2>/dev/null || true)"
  fi

  local leak_error=0
  if [[ -n "${leaked_containers:-}" || -n "${leaked_volumes:-}" ]]; then
    echo "ERROR: Leaked Docker resources detected for project '${p}':" >&2
    echo "  Containers: ${leaked_containers:-none}" >&2
    echo "  Volumes:    ${leaked_volumes:-none}" >&2
    leak_error=1
  fi

  # Verify developer credentials isolation: ensure ${REPO_ROOT}/.local/demo was not modified
  local dev_demo_final_fingerprint
  dev_demo_final_fingerprint="$(compute_demo_fingerprint "${DEV_DEMO_DIR:-}")"
  if [[ "${DEV_DEMO_INITIAL_FINGERPRINT:-}" != "${dev_demo_final_fingerprint}" ]]; then
    echo "ERROR: Credential isolation violated! Developer directory ${DEV_DEMO_DIR:-} was modified during E2E run:" >&2
    echo "  Expected before run: ${DEV_DEMO_INITIAL_FINGERPRINT:-}" >&2
    echo "  Observed after run:  ${dev_demo_final_fingerprint}" >&2
    leak_error=1
  else
    echo "==> Verified: developer credentials in ${DEV_DEMO_DIR:-} remained untouched (fingerprint: ${DEV_DEMO_INITIAL_FINGERPRINT:-})."
  fi

  if [[ -n "${WORKTREE_DIR:-}" && -d "${WORKTREE_DIR:-}" ]]; then
    echo "==> Removing temporary worktree ${WORKTREE_DIR}..."
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || rm -rf "${WORKTREE_DIR}" 2>/dev/null || true
    git -C "${REPO_ROOT}" worktree prune 2>/dev/null || true
    if git -C "${REPO_ROOT}" worktree list 2>/dev/null | grep -q "${WORKTREE_DIR}"; then
      echo "WARNING: worktree ${WORKTREE_DIR} still listed in git worktree list; pruning again..." >&2
      git -C "${REPO_ROOT}" worktree prune 2>/dev/null || true
    fi
  fi

  if (( leak_error != 0 )); then
    exit 1
  fi
  exit "${exit_code}"
}

# ------------------------------------------------------------------------------
# Main Execution Entry Point
# ------------------------------------------------------------------------------
run_demo_e2e_main() {
  # Parse CLI arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --clean-checkout)
        CLEAN_CHECKOUT=1
        shift
        ;;
      --port)
        if [[ -z "${2:-}" ]]; then
          echo "Error: --port requires an integer argument." >&2
          exit 2
        fi
        APP_PORT="$2"
        shift 2
        ;;
      --help|-h)
        echo "Usage: $0 [--clean-checkout] [--port <PORT>]"
        exit 0
        ;;
      *)
        echo "Error: Unknown argument '$1'. Use --help for usage." >&2
        exit 2
        ;;
    esac
  done

  # ----------------------------------------------------------------------------
  # Prerequisite Guards: Node 22, Docker Daemon, Free Port (18080..18180)
  # ----------------------------------------------------------------------------
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is required but not found in PATH." >&2
    exit 1
  fi

  local node_ver
  node_ver="$(node -v 2>/dev/null || echo "")"
  if [[ ! "${node_ver}" =~ ^v22\. ]]; then
    echo "Error: Node.js 22 is required. Detected version: ${node_ver:-none}" >&2
    exit 1
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "Error: Docker daemon is required but unreachable." >&2
    exit 1
  fi

  if [[ -z "${APP_PORT}" ]]; then
    APP_PORT="$(find_free_demo_port)" || exit 1
  fi

  DEV_DEMO_INITIAL_FINGERPRINT="$(compute_demo_fingerprint "${DEV_DEMO_DIR}")"
  echo "==> Developer demo credential baseline (${DEV_DEMO_DIR}): ${DEV_DEMO_INITIAL_FINGERPRINT}"

  # Install guarded EXIT trap
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT
  trap 'cleanup; exit 143' TERM

  # Failure-injection hook: DEMO_E2E_FAIL_AFTER=trap exits right after trap installation
  if [[ "${DEMO_E2E_FAIL_AFTER:-}" == "trap" ]]; then
    echo "Failure injected by DEMO_E2E_FAIL_AFTER=trap right after trap installation." >&2
    exit 1
  fi

  # ----------------------------------------------------------------------------
  # Optional Clean Checkout Worktree Setup
  # ----------------------------------------------------------------------------
  if (( CLEAN_CHECKOUT == 1 )); then
    local tmp_parent="${TMPDIR:-/tmp}"
    WORKTREE_DIR="$(mktemp -d "${tmp_parent}/ott-e2e.XXXXXX")"
    echo "==> Creating clean worktree from HEAD at ${WORKTREE_DIR}..."
    git worktree add --detach "${WORKTREE_DIR}" HEAD
    RUN_DIR="${WORKTREE_DIR}"
    echo "==> Installing dependencies in clean worktree (npm ci)..."
    (cd "${RUN_DIR}" && npm ci)

    # If bot fixtures exist in source tree, preserve them into the worktree
    if [[ -d "${REPO_ROOT}/src/bots/sandbox-corpus/artifacts" ]]; then
      echo "==> Preserving bot fixture artifacts into clean worktree..."
      mkdir -p "${RUN_DIR}/src/bots/sandbox-corpus/artifacts"
      cp -r "${REPO_ROOT}/src/bots/sandbox-corpus/artifacts/"* "${RUN_DIR}/src/bots/sandbox-corpus/artifacts/" 2>/dev/null || true
    fi
  fi

  # ----------------------------------------------------------------------------
  # Isolated Demo E2E Environment & Accounts CSV Configuration
  # Prevents overriding or resetting the developer's default .local/demo/ credentials
  # ----------------------------------------------------------------------------
  DEMO_E2E_DIR="${RUN_DIR}/.local/demo-e2e"
  mkdir -p -m 700 "${DEMO_E2E_DIR}" 2>/dev/null || mkdir -p "${DEMO_E2E_DIR}"
  export OTT_DEMO_PROJECT="${PROJECT_NAME}"
  export OTT_DEMO_ENV_FILE="${DEMO_E2E_DIR}/demo.env"
  export OTT_DEMO_ACCOUNTS_CSV="${DEMO_E2E_DIR}/accounts.csv"
  export OTT_E2E_ACCOUNTS_CSV="${OTT_DEMO_ACCOUNTS_CSV}"
  export APP_PORT="${APP_PORT}"

  # Detect container-accessible docker socket GID (avoids WSL user-namespace 65534 mismatch)
  local sock_path="${DOCKER_SOCKET:-/var/run/docker.sock}"
  local target_gid="${DOCKER_GID:-}"
  if [[ -z "${target_gid}" || "${target_gid}" == "65534" ]]; then
    target_gid="$(docker run --rm -v "${sock_path}":/s alpine stat -c %g /s 2>/dev/null || true)"
    if [[ -z "${target_gid}" || ! "${target_gid}" =~ ^[0-9]+$ ]]; then
      target_gid="$(stat -c %g "${sock_path}" 2>/dev/null || echo "0")"
    fi
  fi
  export DOCKER_GID="${target_gid}"

  # ----------------------------------------------------------------------------
  # Main Execution: Stack Launch, Failure Injection Hook, E2E Vitest Suite
  # ----------------------------------------------------------------------------
  cd "${RUN_DIR}"

  local demo_script="${OTT_DEMO_SCRIPT:-${RUN_DIR}/scripts/demo.sh}"
  echo "==> Bringing up demo stack on port ${APP_PORT} (project: ${PROJECT_NAME})..."
  bash "${demo_script}" up --port "${APP_PORT}"

  # Fail fast: ensure demo accounts CSV was generated at the expected isolated path
  if [[ ! -f "${OTT_DEMO_ACCOUNTS_CSV}" ]]; then
    echo "ERROR: accounts CSV not found at ${OTT_DEMO_ACCOUNTS_CSV} after demo.sh up" >&2
    exit 1
  fi

  # Failure-injection hook: DEMO_E2E_FAIL_AFTER=up exits right after up; trap must still clean
  if [[ "${DEMO_E2E_FAIL_AFTER:-}" == "up" ]]; then
    echo "Failure injected by DEMO_E2E_FAIL_AFTER=up right after stack up." >&2
    exit 1
  fi

  echo "==> Running local demo API qualification test suite..."
  export OTT_E2E_BASE_URL="http://127.0.0.1:${APP_PORT}"
  export OTT_DEMO_PROJECT="${PROJECT_NAME}"

  npx vitest run --config tests/e2e/local-demo.config.ts
}

if [[ "${BASH_SOURCE[0]}" == "$0" && "${RUN_LOCAL_DEMO_E2E_SOURCED:-0}" != "1" ]]; then
  run_demo_e2e_main "$@"
fi
