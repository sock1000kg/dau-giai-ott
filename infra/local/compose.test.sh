#!/usr/bin/env bash
# ==============================================================================
# infra/local/compose.test.sh
# Verification script for local Docker Compose stack (P2-T34).
#
# Usage:
#   ./infra/local/compose.test.sh static  # Static schema & security assertion
#   ./infra/local/compose.test.sh live    # Live end-to-end spinup & smoke test
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"

MODE="${1:-static}"
TMP_DIR=""
ENV_FILE=""

cleanup() {
  if [ -n "${TMP_DIR:-}" ] && [ -d "${TMP_DIR:-}" ]; then
    if [ "${MODE:-}" = "live" ] && [ -n "${ENV_FILE:-}" ] && [ -f "${ENV_FILE:-}" ]; then
      echo "==> [LIVE] Cleaning up test stack (project: ott-local-test)..."
      docker compose -p ott-local-test -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" down -v --remove-orphans 2>/dev/null || true
    fi
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

find_free_port() {
  python3 -c '
import socket
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.bind(("127.0.0.1", 0))
    print(s.getsockname()[1])
'
}

create_throwaway_env() {
  local target_dir="$1"
  local env_path="${target_dir}/.env"
  local pg_port="${2:-5432}"
  local rd_port="${3:-6379}"
  local s3_port="${4:-8333}"
  local web_port="${5:-8080}"
  local doc_gid="${6:-999}"
  local btc_user="${7:-btc}"
  local btc_pass
  if [ -n "${8:-}" ]; then
    btc_pass="$8"
  else
    btc_pass="$(openssl rand -hex 12 2>/dev/null || head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi

  cat > "${env_path}" <<EOF
POSTGRES_DB=ott_test
POSTGRES_USER=ott_test
POSTGRES_PASSWORD=test_postgres_pass
POSTGRES_PORT=${pg_port}
REDIS_PASSWORD=test_redis_pass
REDIS_PORT=${rd_port}
S3_ACCESS_KEY_ID=test_access_key
S3_SECRET_ACCESS_KEY=test_secret_key
S3_BUCKET=ott-test-bucket
S3_API_PORT=${s3_port}
APP_PORT=${web_port}
DOCKER_GID=${doc_gid}
DOCKER_SOCKET=/var/run/docker.sock
OTT_BOOTSTRAP_BTC_USERNAME=${btc_user}
OTT_BOOTSTRAP_BTC_PASSWORD=${btc_pass}
OTT_DEPLOYMENT_MODE=dev
OTT_SECURE_COOKIES=false
OTT_ADMIN_TOTP_REQUIRED=false
OTT_ADMIN_ALLOWLIST=
OTT_TRUSTED_PROXIES=none
EOF
  echo "${env_path}"
}

run_static_test() {
  echo "==> [STATIC] Running Compose static assertions..."
  TMP_DIR="$(mktemp -d)"
  ENV_FILE="$(create_throwaway_env "${TMP_DIR}")"

  echo "Checking Compose configuration syntax with docker compose config -q..."
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config -q
  echo "  OK: Syntax valid."

  echo "Validating port bindings, socket mounts, and privilege policies..."
  local config_json
  config_json="$(docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config --format json)"
  local config_file="${TMP_DIR}/config.json"
  printf '%s\n' "${config_json}" > "${config_file}"

  if command -v jq >/dev/null 2>&1; then
    # 1. Assert only 'web' has 0.0.0.0 or unspecified host-ip publish
    local public_services
    public_services="$(echo "${config_json}" | jq -r '
      [.services | to_entries[] | .key as $name | .value.ports[]? |
       select((.host_ip == null or .host_ip == "" or .host_ip == "0.0.0.0" or .host_ip == "::")) | $name] | unique | sort | join(",")
    ')"
    if [ "${public_services}" != "web" ]; then
      echo "FAIL: Expected only 'web' to publish to 0.0.0.0/unspecified, got: '${public_services}'" >&2
      exit 1
    fi
    echo "  OK: Only 'web' publishes to 0.0.0.0."

    # 2. Assert all other published ports are bound to 127.0.0.1
    local non_loopback_other
    non_loopback_other="$(echo "${config_json}" | jq -r '
      [.services | to_entries[] | select(.key != "web") | .key as $name | .value.ports[]? |
       select(.host_ip != "127.0.0.1") | "\($name):\(.host_ip // "unspecified")"] | join(", ")
    ')"
    if [ -n "${non_loopback_other}" ]; then
      echo "FAIL: Found services publishing to non-loopback host IPs: ${non_loopback_other}" >&2
      exit 1
    fi
    echo "  OK: All other published ports bound to 127.0.0.1."

    # 3. Assert only worker and coordinator mount docker.sock
    local socket_services
    socket_services="$(echo "${config_json}" | jq -r '
      [.services | to_entries[] | .key as $name | .value.volumes[]? |
       (if type == "string" then . else (.source // "") + ":" + (.target // "") end) |
       select(test("docker\\.sock")) | $name] | unique | sort | join(",")
    ')"
    if [ "${socket_services}" != "coordinator,worker" ]; then
      echo "FAIL: Expected only 'coordinator,worker' to mount docker.sock, got: '${socket_services}'" >&2
      exit 1
    fi
    echo "  OK: Only worker and coordinator mount Docker socket."

    # 4. Assert no service has privileged: true
    local privileged_services
    privileged_services="$(echo "${config_json}" | jq -r '
      [.services | to_entries[] | select(.value.privileged == true) | .key] | join(", ")
    ')"
    if [ -n "${privileged_services}" ]; then
      echo "FAIL: Found privileged services: ${privileged_services}" >&2
      exit 1
    fi
    echo "  OK: No service has privileged flag."

    # 5. Assert coordinator has no replicas > 1
    local coord_replicas
    coord_replicas="$(echo "${config_json}" | jq -r '
      .services.coordinator.deploy.replicas // 1
    ')"
    if [ "${coord_replicas}" -gt 1 ]; then
      echo "FAIL: Coordinator replicas is ${coord_replicas} (must be <= 1)" >&2
      exit 1
    fi
    echo "  OK: Coordinator replicas = ${coord_replicas} (single instance)."

    # 6. Assert APP_BIND=127.0.0.1 yields loopback publish for web
    local loopback_json
    loopback_json="$(env APP_BIND=127.0.0.1 docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config --format json)"
    local web_loopback_ip
    web_loopback_ip="$(echo "${loopback_json}" | jq -r '
      .services.web.ports[]? | select(.target == 8080) | .host_ip
    ')"
    if [ "${web_loopback_ip}" != "127.0.0.1" ]; then
      echo "FAIL: Expected web to publish to 127.0.0.1 when APP_BIND=127.0.0.1, got: '${web_loopback_ip}'" >&2
      exit 1
    fi
    echo "  OK: APP_BIND=127.0.0.1 binds web to loopback."

  else
    local loopback_json
    loopback_json="$(env APP_BIND=127.0.0.1 docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" config --format json)"
    local loopback_file="${TMP_DIR}/loopback.json"
    printf '%s\n' "${loopback_json}" > "${loopback_file}"

    # Python3 fallback reading JSON from file argument
    python3 - "${config_file}" "${loopback_file}" <<'PY'
import json, sys

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
services = data.get('services', {})

# 1 & 2. Check ports
for sname, sdef in services.items():
    ports = sdef.get('ports', []) or []
    for p in ports:
        host_ip = p.get('host_ip') if isinstance(p, dict) else (p.split(':')[0] if ':' in p else '')
        if sname == 'web':
            if host_ip not in ('0.0.0.0', '', None, '::'):
                sys.exit(f'FAIL: web should bind 0.0.0.0, got {host_ip}')
        else:
            if host_ip != '127.0.0.1':
                sys.exit(f'FAIL: Service {sname} published port to {host_ip}, expected 127.0.0.1')

# 3. Check socket mounts
socket_svcs = set()
for sname, sdef in services.items():
    for v in sdef.get('volumes', []) or []:
        v_str = f"{v.get('source','')}:{v.get('target','')}" if isinstance(v, dict) else str(v)
        if 'docker.sock' in v_str:
            socket_svcs.add(sname)
if socket_svcs != {'worker', 'coordinator'}:
    sys.exit(f'FAIL: Expected only worker and coordinator to mount socket, got: {socket_svcs}')

# 4. Check privileged
for sname, sdef in services.items():
    if sdef.get('privileged') is True:
        sys.exit(f'FAIL: Service {sname} has privileged: true')

# 5. Check coordinator replicas
coord = services.get('coordinator', {})
replicas = (coord.get('deploy') or {}).get('replicas', 1)
if int(replicas) > 1:
    sys.exit(f'FAIL: Coordinator replicas = {replicas} > 1')

# 6. Check APP_BIND=127.0.0.1 yields loopback publish
with open(sys.argv[2], 'r', encoding='utf-8') as f:
    lb_data = json.load(f)
lb_ports = lb_data.get('services', {}).get('web', {}).get('ports', []) or []
for p in lb_ports:
    hip = p.get('host_ip') if isinstance(p, dict) else (p.split(':')[0] if ':' in p else '')
    if hip != '127.0.0.1':
        sys.exit(f'FAIL: web should bind 127.0.0.1 when APP_BIND=127.0.0.1, got {hip}')
PY
    echo "  OK: All checks passed via python3."
  fi

  # Assert .dockerignore negates the demo bot so it is included in the web image build
  local dockerignore_file="${SCRIPT_DIR}/../../.dockerignore"
  local oci_line negation_line all_negations
  oci_line="$(grep -n '^\*\*/\*\.oci\.tar$' "${dockerignore_file}" | cut -d: -f1)"
  negation_line="$(grep -n '^!src/platform/web/public/downloads/ott-demo-bot-go-v1\.oci\.tar$' "${dockerignore_file}" | cut -d: -f1)"
  all_negations="$(grep -E '^!.*\.oci\.tar$' "${dockerignore_file}")"

  if [[ -z "${negation_line}" || -z "${oci_line}" || "${negation_line}" -le "${oci_line}" ]]; then
    echo "FAIL: .dockerignore negation !src/platform/web/public/downloads/ott-demo-bot-go-v1.oci.tar must come after **/*.oci.tar" >&2
    exit 1
  fi
  if [[ "${all_negations}" != "!src/platform/web/public/downloads/ott-demo-bot-go-v1.oci.tar" ]]; then
    echo "FAIL: exactly one .oci.tar negation must exist in .dockerignore, got: ${all_negations}" >&2
    exit 1
  fi
  echo "  OK: .dockerignore includes downloadable demo bot in web image context (after **/*.oci.tar with no other oci negations)."

  echo "==> [STATIC] All Compose static assertions PASSED."
}

run_live_test() {
  echo "==> [LIVE] Running Compose live integration test (project: ott-local-test)..."

  if ! command -v docker >/dev/null 2>&1; then
    echo "FAIL: 'docker' CLI not found. Live test requires Docker Engine." >&2
    exit 1
  fi

  TMP_DIR="$(mktemp -d)"

  local pg_port rd_port s3_port web_port doc_gid btc_user btc_pass
  pg_port="$(find_free_port)"
  rd_port="$(find_free_port)"
  s3_port="$(find_free_port)"
  web_port="$(find_free_port)"
  doc_gid="$(stat -c %g "${DOCKER_SOCKET:-/var/run/docker.sock}" 2>/dev/null || echo 999)"
  btc_user="btc"
  btc_pass="$(openssl rand -hex 12 2>/dev/null || head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"

  ENV_FILE="$(create_throwaway_env "${TMP_DIR}" "${pg_port}" "${rd_port}" "${s3_port}" "${web_port}" "${doc_gid}" "${btc_user}" "${btc_pass}")"

  echo "Spinning up fresh stack with up --build --wait on ports: web=${web_port}, pg=${pg_port}, rd=${rd_port}, s3=${s3_port}..."
  docker compose -p ott-local-test -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up --build --wait

  echo "Verifying gateway /healthz..."
  local healthz_body
  healthz_body="$(curl -fsS "http://127.0.0.1:${web_port}/healthz")"
  if [ "${healthz_body}" != "ok" ]; then
    echo "FAIL: /healthz returned '${healthz_body}', expected 'ok'" >&2
    exit 1
  fi
  echo "  OK: /healthz responded 'ok'."

  echo "Verifying API readiness through gateway at /api/v1/health/ready..."
  local ready_body
  ready_body="$(curl -fsS "http://127.0.0.1:${web_port}/api/v1/health/ready")"
  if ! echo "${ready_body}" | grep -q '"status":"ready"'; then
    echo "FAIL: /api/v1/health/ready did not indicate ready status. Response: ${ready_body}" >&2
    exit 1
  fi
  echo "  OK: /api/v1/health/ready responded with ready status."

  echo "Verifying bootstrap BTC admin login (POST /api/v1/auth/login)..."
  local login_body
  login_body="$(curl -fsS -X POST "http://127.0.0.1:${web_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${btc_user}\",\"password\":\"${btc_pass}\"}")"
  if ! echo "${login_body}" | grep -q "BTC_ADMIN"; then
    echo "FAIL: Login did not return BTC_ADMIN role. Response: ${login_body}" >&2
    exit 1
  fi
  echo "  OK: Successfully logged in as bootstrap BTC admin."

  echo "Testing coordinator restart resilience..."
  docker compose -p ott-local-test -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" restart coordinator

  echo "Waiting for coordinator to report healthy..."
  local coord_id
  coord_id="$(docker compose -p ott-local-test -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" ps -q coordinator)"
  if [ -z "${coord_id}" ]; then
    echo "FAIL: Could not determine container ID for coordinator." >&2
    exit 1
  fi

  local healthy=false
  local health_status="unknown"
  for _ in $(seq 1 60); do
    health_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${coord_id}" 2>/dev/null || echo "")"
    if [ "${health_status}" = "healthy" ]; then
      healthy=true
      break
    fi
    sleep 2
  done

  if [ "${healthy}" != "true" ]; then
    echo "FAIL: Coordinator did not become healthy after restart within 120s (last status: '${health_status}'). Logs:" >&2
    docker logs --tail 100 "${coord_id}" >&2 || true
    exit 1
  fi
  echo "  OK: Coordinator healthy after restart."

  echo "==> [LIVE] All Compose live integration checks PASSED."
}

case "${MODE}" in
  static)
    run_static_test
    ;;
  live)
    run_live_test
    ;;
  *)
    echo "Usage: $0 [static|live]" >&2
    exit 1
    ;;
esac
