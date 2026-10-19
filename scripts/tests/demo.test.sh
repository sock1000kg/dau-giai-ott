#!/usr/bin/env bash
# ==============================================================================
# scripts/tests/demo.test.sh
# Verification test suite for scripts/demo.sh (P2-T36).
#
# Modes:
#   bash scripts/tests/demo.test.sh         # Guard & static unit tests (no Docker required)
#   bash scripts/tests/demo.test.sh live    # Full live Docker E2E verification
# ==============================================================================
set -Eeuo pipefail
export PYTHONDONTWRITEBYTECODE=1

MODE="${1:-guards}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEMO_SCRIPT="${REPO_ROOT}/scripts/demo.sh"
LIVE_PROJECT="${OTT_DEMO_PROJECT:-ott-demo-test}"
COMPOSE_FILE="${REPO_ROOT}/infra/local/compose.yaml"

PASSED_TESTS=0
FAILED_TESTS=0
TEST_OUT=""
TEST_CODE=0

run_cmd() {
  local ret=0
  TEST_OUT="$("$@" 2>&1)" || ret=$?
  TEST_CODE="${ret}"
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local desc="$3"
  if [[ "${expected}" == "${actual}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: ${desc}"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: ${desc} (expected '${expected}', got '${actual}')" >&2
  fi
}

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local desc="$3"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: ${desc}"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: ${desc} (expected output to contain '${needle}')" >&2
  fi
}

assert_not_contains() {
  local needle="$1"
  local haystack="$2"
  local desc="$3"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: ${desc}"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: ${desc} (output unexpectedly contained '${needle}')" >&2
  fi
}

# ------------------------------------------------------------------------------
# GUARD TESTS (No Docker needed)
# ------------------------------------------------------------------------------
run_guard_tests() {
  echo "================================================================="
  echo "Running demo.sh Guard Tests (No Docker Required)"
  echo "================================================================="

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local cleanup_dirs=("${tmp_dir}")

  cleanup_guards() {
    local d
    for d in "${cleanup_dirs[@]:-}"; do
      if [[ -n "${d:-}" && -d "${d:-}" ]]; then
        rm -rf "${d}" 2>/dev/null || true
      fi
    done
  }
  trap cleanup_guards EXIT
  trap 'cleanup_guards; exit 130' INT
  trap 'cleanup_guards; exit 143' TERM

  local disposable_project="ott-demo-test-guard-$$"
  export OTT_DEMO_PROJECT="${disposable_project}"

  # ----------------------------------------------------------------------------
  # 1. Usage / Exit Codes
  # ----------------------------------------------------------------------------
  echo "[1/6] Testing usage and exit code guards..."

  run_cmd bash "${DEMO_SCRIPT}"
  assert_eq "2" "${TEST_CODE}" "demo.sh with no arguments exits 2"
  assert_contains "Usage: demo.sh" "${TEST_OUT}" "demo.sh no args outputs usage to stderr"

  run_cmd bash "${DEMO_SCRIPT}" bogus
  assert_eq "2" "${TEST_CODE}" "demo.sh unknown subcommand exits 2"

  run_cmd bash "${DEMO_SCRIPT}" down
  assert_eq "2" "${TEST_CODE}" "demo.sh down is not offered and exits 2"

  run_cmd bash "${DEMO_SCRIPT}" logs bogus
  assert_eq "2" "${TEST_CODE}" "demo.sh logs bogus service exits 2"

  run_cmd bash "${DEMO_SCRIPT}" logs --bogus-flag
  assert_eq "2" "${TEST_CODE}" "demo.sh logs --bogus-flag exits 2"

  run_cmd bash "${DEMO_SCRIPT}" logs api --bogus-flag
  assert_eq "2" "${TEST_CODE}" "demo.sh logs api --bogus-flag exits 2"

  run_cmd bash "${DEMO_SCRIPT}" up --unknown-flag
  assert_eq "2" "${TEST_CODE}" "demo.sh up with unknown flag exits 2"

  run_cmd bash "${DEMO_SCRIPT}" round bogus
  assert_eq "2" "${TEST_CODE}" "demo.sh round with unknown subcommand exits 2"

  run_cmd bash "${DEMO_SCRIPT}" --help
  assert_eq "0" "${TEST_CODE}" "demo.sh --help exits 0"

  local sub
  for sub in up status accounts logs round stop reset; do
    run_cmd bash "${DEMO_SCRIPT}" "${sub}" --help
    assert_eq "0" "${TEST_CODE}" "demo.sh ${sub} --help exits 0"
  done

  # ----------------------------------------------------------------------------
  # 2. Project Name Safety Guards
  # ----------------------------------------------------------------------------
  echo "[2/6] Testing project name pattern guards..."

  local invalid_projects=("prod" "ott-local" "ott-demo;rm" "ott-demo/foo" "other-stack")
  local bad_proj
  for bad_proj in "${invalid_projects[@]}"; do
    run_cmd env OTT_DEMO_PROJECT="${bad_proj}" bash "${DEMO_SCRIPT}" status
    assert_eq "2" "${TEST_CODE}" "Rejects invalid project name '${bad_proj}' with exit 2"
    assert_contains "Must match pattern ^ott-demo[a-z0-9-]*$" "${TEST_OUT}" "Reports pattern mismatch error"
  done

  # ----------------------------------------------------------------------------
  # 3. Reset Confirmation & Target Bounds (Mock Docker)
  # ----------------------------------------------------------------------------
  echo "[3/6] Testing reset confirmation and target guards..."

  local mock_bin="${tmp_dir}/mock_bin"
  mkdir -p "${mock_bin}"
  local docker_log="${tmp_dir}/docker_commands.log"
  touch "${docker_log}"

  cat > "${mock_bin}/docker" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${docker_log}"
if [[ "\$1" == "info" ]]; then
  echo "Server Version: 25.0.0"
  exit 0
fi
if [[ "\$1" == "version" ]]; then
  echo "25.0.0"
  exit 0
fi
if [[ "\$1" == "compose" && "\$2" == "version" ]]; then
  echo "Docker Compose version v2.24.0"
  exit 0
fi
exit 0
EOF
  chmod +x "${mock_bin}/docker"

  # Reset non-interactive without --yes
  run_cmd env PATH="${mock_bin}:${PATH}" OTT_DEMO_PROJECT="${disposable_project}" bash "${DEMO_SCRIPT}" reset < /dev/null
  assert_eq "1" "${TEST_CODE}" "Reset non-interactive without --yes aborts with exit code 1"
  assert_contains "Reset requires confirmation" "${TEST_OUT}" "Reset outputs confirmation requirement notice"

  # Reset with mismatched typed confirmation (simulated via stdin pipe)
  run_cmd bash -c 'printf "wrong-project\n" | env PATH="'"${mock_bin}:${PATH}"'" OTT_DEMO_PROJECT="'"${disposable_project}"'" bash "'"${DEMO_SCRIPT}"'" reset'
  assert_eq "1" "${TEST_CODE}" "Reset with mismatched confirmation exits 1"
  assert_contains "Reset aborted" "${TEST_OUT}" "Reset outputs abort notice on mismatch"

  # Verify in docker log that down was never executed
  local log_content
  log_content="$(cat "${docker_log}")"
  assert_not_contains "down" "${log_content}" "docker down was NEVER called when reset is unconfirmed"

  # Verify only the disposable project was passed
  if grep -E -- "-p[[:space:]]+[a-zA-Z0-9_-]+" "${docker_log}" | grep -v -q "${disposable_project}"; then
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: Docker was invoked with a project other than '${disposable_project}'" >&2
  else
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: Docker compose was only invoked with the disposable project name"
  fi

  # ----------------------------------------------------------------------------
  # 4. Accounts CSV Redaction & Mode Checks
  # ----------------------------------------------------------------------------
  echo "[4/6] Testing accounts CSV password redaction and permissions warnings..."

  local sample_csv="${tmp_dir}/sample_accounts.csv"
  cat > "${sample_csv}" <<'EOF'
username,password,role,team
btc,ABC123,BTC_ADMIN,
team01,ABC123,TEAM_ACCOUNT,Team 01
team02,ABC123,TEAM_ACCOUNT,Team 02
EOF

  chmod 0600 "${sample_csv}"
  run_cmd env OTT_DEMO_ACCOUNTS_CSV="${sample_csv}" bash "${DEMO_SCRIPT}" accounts
  assert_eq "0" "${TEST_CODE}" "Accounts command exits 0"
  assert_not_contains "ABC123" "${TEST_OUT}" "Accounts command never outputs plaintext passwords"
  assert_contains "btc" "${TEST_OUT}" "Accounts output lists btc"
  assert_contains "team01" "${TEST_OUT}" "Accounts output lists team01"
  assert_contains "team02" "${TEST_OUT}" "Accounts output lists team02"
  assert_contains "BTC_ADMIN" "${TEST_OUT}" "Accounts output lists BTC_ADMIN role"
  assert_contains "TEAM_ACCOUNT" "${TEST_OUT}" "Accounts output lists TEAM_ACCOUNT role"
  assert_contains "passwords are in the file" "${TEST_OUT}" "Accounts output explicitly notes passwords are in the file"
  assert_not_contains "Warning" "${TEST_OUT}" "No permissions warning when mode is 0600"

  # Check permissions mode warning on mode 644
  chmod 0644 "${sample_csv}"
  run_cmd env OTT_DEMO_ACCOUNTS_CSV="${sample_csv}" bash "${DEMO_SCRIPT}" accounts
  assert_eq "0" "${TEST_CODE}" "Accounts command exits 0 on mode 644"
  assert_contains "Warning" "${TEST_OUT}" "Warns when accounts CSV has mode 644"
  assert_contains "0600" "${TEST_OUT}" "Warning mentions expected 0600 mode"

  # ----------------------------------------------------------------------------
  # 5. Environment File Generation & Idempotency
  # ----------------------------------------------------------------------------
  echo "[5/6] Testing demo.env generation and idempotency..."

  local test_env_dir="${tmp_dir}/env_test"
  mkdir -p "${test_env_dir}"
  local test_env_file="${test_env_dir}/demo.env"
  local fake_socket="${tmp_dir}/docker.sock"
  touch "${fake_socket}"

  # Create mock curl in mock_bin: only reports ready for readiness check
  cat > "${mock_bin}/curl" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "${arg}" == *"health/ready"* ]]; then
    echo '{"status":"ready"}'
    exit 0
  fi
  if [[ "${arg}" == *"health/live"* ]]; then
    echo '{"status":"ok"}'
    exit 0
  fi
done
exit 0
EOF
  chmod +x "${mock_bin}/curl"

  # First run: should create demo.env with mode 0600
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${test_env_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --no-build --port 19999

  assert_eq "0" "${TEST_CODE}" "up --no-build succeeds with mock docker"

  if [[ -f "${test_env_file}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: demo.env created successfully"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: demo.env was not created" >&2
  fi

  local env_mode
  env_mode="$(stat -c %a "${test_env_file}" 2>/dev/null || stat -f %Lp "${test_env_file}" 2>/dev/null || echo "")"
  assert_eq "600" "${env_mode}" "demo.env has permissions mode 0600"

  local env_content
  env_content="$(cat "${test_env_file}")"
  assert_contains "POSTGRES_PASSWORD=" "${env_content}" "demo.env contains POSTGRES_PASSWORD"
  assert_contains "REDIS_PASSWORD=" "${env_content}" "demo.env contains REDIS_PASSWORD"
  assert_contains "S3_SECRET_ACCESS_KEY=" "${env_content}" "demo.env contains S3_SECRET_ACCESS_KEY"
  assert_contains "OTT_BOOTSTRAP_BTC_PASSWORD=ABC123" "${env_content}" "demo.env aligns bootstrap BTC password to ABC123"

  # Verify secrets are not ABC123
  local pg_p rd_p s3_p
  pg_p="$(grep '^POSTGRES_PASSWORD=' "${test_env_file}" | cut -d= -f2-)"
  rd_p="$(grep '^REDIS_PASSWORD=' "${test_env_file}" | cut -d= -f2-)"
  s3_p="$(grep '^S3_SECRET_ACCESS_KEY=' "${test_env_file}" | cut -d= -f2-)"

  assert_not_contains "ABC123" "${pg_p}" "POSTGRES_PASSWORD is not the public ABC123"
  assert_not_contains "ABC123" "${rd_p}" "REDIS_PASSWORD is not the public ABC123"
  assert_not_contains "ABC123" "${s3_p}" "S3_SECRET_ACCESS_KEY is not the public ABC123"

  local env_sha
  env_sha="$(sha256sum "${test_env_file}" | awk '{print $1}')"

  # Second run: should NOT overwrite demo.env
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${test_env_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --no-build --port 19999

  assert_eq "0" "${TEST_CODE}" "Second up run succeeds as idempotent check"
  local env_sha2
  env_sha2="$(sha256sum "${test_env_file}" | awk '{print $1}')"
  assert_eq "${env_sha}" "${env_sha2}" "demo.env is never overwritten on subsequent runs"

  # ----------------------------------------------------------------------------
  # 6. Round Subcommand Guards
  # ----------------------------------------------------------------------------
  echo "[6/6] Testing round subcommand error guards..."

  run_cmd bash "${DEMO_SCRIPT}" round
  assert_eq "2" "${TEST_CODE}" "demo.sh round with no subcommand exits 2"
  assert_contains "Missing round subcommand" "${TEST_OUT}" "Outputs missing subcommand error"

  # Round against unreachable port exits 1
  run_cmd env OTT_DEMO_ENV_FILE="${test_env_file}" bash "${DEMO_SCRIPT}" round status
  assert_eq "1" "${TEST_CODE}" "demo.sh round status exits 1 when gateway is unreachable"
  assert_contains "Demo stack is not reachable" "${TEST_OUT}" "Reports gateway unreachable error"

  # ----------------------------------------------------------------------------
  # 7. BTC Password Argv Redaction (Curl Argv Mock)
  # ----------------------------------------------------------------------------
  echo "[7/7] Testing BTC password is never exposed on curl argv..."

  local secret_pass="SUPERSECRET_PW_98765"
  local mock_csv="${tmp_dir}/secret_accounts.csv"
  cat > "${mock_csv}" <<EOF
username,password,role,team
btc,${secret_pass},BTC_ADMIN,
EOF
  chmod 0600 "${mock_csv}"

  local curl_argv_log="${tmp_dir}/curl_argv.log"
  touch "${curl_argv_log}"

  local mock_curl_bin="${tmp_dir}/mock_curl_bin"
  mkdir -p "${mock_curl_bin}"

  cat > "${mock_curl_bin}/curl" <<EOF
#!/usr/bin/env bash
echo "ARGV: \$*" >> "${curl_argv_log}"
out_file=""
write_code=0
for ((i=1; i<=\$#; i++)); do
  arg="\${!i}"
  if [[ "\${arg}" == "-o" ]]; then
    ((i++))
    out_file="\${!i}"
  elif [[ "\${arg}" == "-w" || "\${arg}" == -w* ]]; then
    write_code=1
  fi
done

emit() {
  local code="\$1"
  local body="\$2"
  if [[ -n "\${out_file}" ]]; then
    printf '%s' "\${body}" > "\${out_file}"
  else
    printf '%s' "\${body}"
  fi
  if (( write_code == 1 )); then
    printf '%s' "\${code}"
  fi
  exit 0
}

if [[ ! -t 0 ]]; then
  cat > /dev/null
fi

for arg in "\$@"; do
  if [[ "\${arg}" == *"health/live"* ]]; then
    exit 0
  fi
  if [[ "\${arg}" == *"auth/login"* ]]; then
    emit "200" '{"data":{"token":"mock"}}'
  fi
done

emit "200" '{"data":{"items":[]}}'
EOF
  chmod +x "${mock_curl_bin}/curl"

  run_cmd env PATH="${mock_curl_bin}:${PATH}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round status

  assert_eq "0" "${TEST_CODE}" "round status succeeds with mock curl"
  local recorded_argv
  recorded_argv="$(cat "${curl_argv_log}")"
  assert_not_contains "${secret_pass}" "${recorded_argv}" "Curl argv never contains plaintext password"

  # ----------------------------------------------------------------------------
  # 8. Reset Teardown Invokes Docker Compose Down with --env-file
  # ----------------------------------------------------------------------------
  echo "[8/12] Testing reset teardown invokes docker compose down with --env-file..."

  > "${docker_log}"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${test_env_file}" \
    bash "${DEMO_SCRIPT}" reset --yes
  assert_eq "0" "${TEST_CODE}" "Reset with --yes exits 0"
  local reset_log
  reset_log="$(cat "${docker_log}")"
  assert_contains "down --volumes --remove-orphans" "${reset_log}" "Docker compose down was executed on confirmed reset"
  assert_contains "--env-file" "${reset_log}" "Docker compose down passes --env-file when demo.env exists"

  # ----------------------------------------------------------------------------
  # 9. Docker-Free Canned API Stub Tests (Status, Results, Close Target Lookup)
  # ----------------------------------------------------------------------------
  echo "[9/12] Testing round status, results, and round close with canned stub curl..."

  local canned_bin="${tmp_dir}/canned_bin"
  mkdir -p "${canned_bin}"
  local canned_curl_state="${tmp_dir}/canned_curl_state"
  echo "SUBMISSION_OPEN" > "${canned_curl_state}"

  cat > "${canned_bin}/curl" <<'EOF'
#!/usr/bin/env bash
out_file=""
write_code=0
for ((i=1; i<=$#; i++)); do
  arg="${!i}"
  if [[ "${arg}" == "-o" ]]; then
    ((i++))
    out_file="${!i}"
  elif [[ "${arg}" == "-w" || "${arg}" == -w* ]]; then
    write_code=1
  fi
done

emit() {
  local code="$1"
  local body="$2"
  if [[ -n "${out_file}" ]]; then
    printf '%s' "${body}" > "${out_file}"
  else
    printf '%s' "${body}"
  fi
  if (( write_code == 1 )); then
    printf '%s' "${code}"
  fi
  exit 0
}

if [[ ! -t 0 ]]; then
  cat > /dev/null
fi

url=""
for arg in "$@"; do
  if [[ "${arg}" =~ ^http:// ]]; then
    url="${arg}"
  fi
done

if [[ "${url}" == *"health/live"* ]]; then
  emit "200" '{"status":"ok"}'
fi

if [[ "${url}" == *"auth/login"* ]]; then
  emit "200" '{"data":{"token":"mock-token"}}'
fi

if [[ "${url}" == *"admin/rounds?tournamentStage="* ]]; then
  state="SUBMISSION_OPEN"
  if [[ -f "${CANNED_STATE_FILE:-}" ]]; then
    state="$(cat "${CANNED_STATE_FILE}")"
  fi
  emit "200" "{\"data\":{\"items\":[{\"id\":\"canned-round-123\",\"roundNumber\":1,\"status\":\"${state}\",\"ruleSetId\":\"canned-ruleset-abc\",\"createdAt\":\"2026-10-19T00:00:00Z\"}]}}"
fi

if [[ "${url}" == *"results/series?stage="* ]]; then
  emit "200" '{"data":{"items":[{"seriesId":"series-999","teams":{"a":{"name":"AlphaTeam"},"b":{"name":"BetaTeam"}},"score":{"a":3,"b":1},"status":"FINISHED"}]}}'
fi

if [[ "${url}" == *"leaderboard?stage="* ]]; then
  emit "200" '{"data":{"items":[{"rank":1,"team":{"name":"AlphaTeam"},"rating":1650,"ratedSeries":4},{"rank":2,"team":{"name":"BetaTeam"},"rating":1420,"ratedSeries":4}]}}'
fi

if [[ "${url}" == *"admin/rounds/canned-round-123/close"* ]]; then
  if [[ -f "${CANNED_STATE_FILE:-}" ]]; then
    echo "SUBMISSION_CLOSED" > "${CANNED_STATE_FILE}"
  fi
  emit "200" '{"data":{"id":"canned-round-123","status":"SUBMISSION_CLOSED"}}'
fi

if [[ "${url}" == *"admin/rounds/canned-round-123/start"* ]]; then
  if [[ -f "${CANNED_STATE_FILE:-}" ]]; then
    echo "RUNNING" > "${CANNED_STATE_FILE}"
  fi
  emit "200" '{"data":{"id":"canned-round-123","status":"RUNNING"}}'
fi

emit "200" '{"data":{"items":[]}}'
EOF
  chmod +x "${canned_bin}/curl"

  # Test round status
  run_cmd env PATH="${canned_bin}:${PATH}" \
    CANNED_STATE_FILE="${canned_curl_state}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round status
  assert_eq "0" "${TEST_CODE}" "canned round status exits 0"
  assert_contains "Status:     SUBMISSION_OPEN" "${TEST_OUT}" "round status prints formatted 'Status:     SUBMISSION_OPEN'"
  assert_contains "Series series-999: AlphaTeam vs BetaTeam [FINISHED] Score: 3:1" "${TEST_OUT}" "round status prints formatted series match"

  # Test round results
  run_cmd env PATH="${canned_bin}:${PATH}" \
    CANNED_STATE_FILE="${canned_curl_state}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round results
  assert_eq "0" "${TEST_CODE}" "canned round results exits 0"
  assert_contains "AlphaTeam" "${TEST_OUT}" "round results prints AlphaTeam"
  assert_contains "1650" "${TEST_OUT}" "round results prints rating 1650"
  assert_contains "Series series-999: AlphaTeam vs BetaTeam [FINISHED] Score: 3:1" "${TEST_OUT}" "round results prints formatted series outcome"

  # Test round close
  run_cmd env PATH="${canned_bin}:${PATH}" \
    CANNED_STATE_FILE="${canned_curl_state}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round close --yes
  assert_eq "0" "${TEST_CODE}" "canned round close exits 0"
  assert_contains "Round canned-round-123 is now RUNNING." "${TEST_OUT}" "round close completes transition to RUNNING"

  # ----------------------------------------------------------------------------
  # 10. In-Flight Guard Fail-Closed Safety Tests
  # ----------------------------------------------------------------------------
  echo "[10/12] Testing in-flight guard fail-closed behavior..."

  local inflight_bin="${tmp_dir}/inflight_bin"
  mkdir -p "${inflight_bin}"
  local inflight_mode_file="${tmp_dir}/inflight_mode"

  cat > "${inflight_bin}/curl" <<'EOF'
#!/usr/bin/env bash
out_file=""
write_code=0
for ((i=1; i<=$#; i++)); do
  arg="${!i}"
  if [[ "${arg}" == "-o" ]]; then
    ((i++))
    out_file="${!i}"
  elif [[ "${arg}" == "-w" || "${arg}" == -w* ]]; then
    write_code=1
  fi
done

emit() {
  local code="$1"
  local body="$2"
  if [[ -n "${out_file}" ]]; then
    printf '%s' "${body}" > "${out_file}"
  else
    printf '%s' "${body}"
  fi
  if (( write_code == 1 )); then
    printf '%s' "${code}"
  fi
  exit 0
}

if [[ ! -t 0 ]]; then
  cat > /dev/null
fi

url=""
for arg in "$@"; do
  if [[ "${arg}" =~ ^http:// ]]; then
    url="${arg}"
  fi
done

if [[ "${url}" == *"health/live"* ]]; then
  emit "200" '{"status":"ok"}'
fi
if [[ "${url}" == *"auth/login"* ]]; then
  emit "200" '{"data":{"token":"mock"}}'
fi

mode="RUNNING"
if [[ -f "${INFLIGHT_MODE_FILE:-}" ]]; then
  mode="$(cat "${INFLIGHT_MODE_FILE}")"
fi

if [[ "${mode}" == "500" ]]; then
  emit "500" '{"error":{"code":"INTERNAL_ERROR","message":"DB connection failed"}}'
fi
if [[ "${mode}" == "EMPTY" ]]; then
  emit "200" ''
fi
if [[ "${mode}" == "MALFORMED" ]]; then
  emit "200" 'not a json'
fi
if [[ "${mode}" == "PAUSED" ]]; then
  emit "200" '{"data":{"items":[{"id":"r-pause","roundNumber":2,"status":"RUNNING","pausedAt":"2026-10-19T00:00:00Z"}]}}'
fi
if [[ "${mode}" == "SETTLING" ]]; then
  emit "200" '{"data":{"items":[{"id":"r-settle","roundNumber":3,"status":"SETTLING","pausedAt":null}]}}'
fi

# Default: RUNNING
emit "200" '{"data":{"items":[{"id":"r-run","roundNumber":1,"status":"RUNNING","pausedAt":null}]}}'
EOF
  chmod +x "${inflight_bin}/curl"

  # RUNNING
  echo "RUNNING" > "${inflight_mode_file}"
  run_cmd env PATH="${inflight_bin}:${PATH}" \
    INFLIGHT_MODE_FILE="${inflight_mode_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round open --yes
  assert_eq "1" "${TEST_CODE}" "round open refused when round is RUNNING"
  assert_contains "Active round execution in-flight" "${TEST_OUT}" "In-flight guard reports active execution for RUNNING"

  # SETTLING
  echo "SETTLING" > "${inflight_mode_file}"
  run_cmd env PATH="${inflight_bin}:${PATH}" \
    INFLIGHT_MODE_FILE="${inflight_mode_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round close --yes
  assert_eq "1" "${TEST_CODE}" "round close refused when round is SETTLING"
  assert_contains "Active round execution in-flight" "${TEST_OUT}" "In-flight guard reports active execution for SETTLING"

  # PAUSED
  echo "PAUSED" > "${inflight_mode_file}"
  run_cmd env PATH="${inflight_bin}:${PATH}" \
    INFLIGHT_MODE_FILE="${inflight_mode_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round open --yes
  assert_eq "1" "${TEST_CODE}" "round open refused when round is PAUSED"
  assert_contains "PAUSED" "${TEST_OUT}" "In-flight guard reports round is PAUSED"

  # HTTP 500 (fail-closed)
  echo "500" > "${inflight_mode_file}"
  run_cmd env PATH="${inflight_bin}:${PATH}" \
    INFLIGHT_MODE_FILE="${inflight_mode_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round open --yes
  assert_eq "1" "${TEST_CODE}" "In-flight guard fails closed on HTTP 500"

  # Empty body (fail-closed)
  echo "EMPTY" > "${inflight_mode_file}"
  run_cmd env PATH="${inflight_bin}:${PATH}" \
    INFLIGHT_MODE_FILE="${inflight_mode_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round open --yes
  assert_eq "1" "${TEST_CODE}" "In-flight guard fails closed on empty body"

  # Malformed JSON (fail-closed)
  echo "MALFORMED" > "${inflight_mode_file}"
  run_cmd env PATH="${inflight_bin}:${PATH}" \
    INFLIGHT_MODE_FILE="${inflight_mode_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round open --yes
  assert_eq "1" "${TEST_CODE}" "In-flight guard fails closed on malformed JSON"

  # ----------------------------------------------------------------------------
  # 11. Error Printer Formatting (Status, Code, Message, Details)
  # ----------------------------------------------------------------------------
  echo "[11/12] Testing api_call error printer formatting..."

  local err_json='{"error":{"code":"ROUND_RULESET_INVALID","message":"Rule set configuration rejected","details":["Map checksum mismatch: expected abc, got def","Engine version 0.9.0 unsupported"]}}'
  local err_file="${tmp_dir}/err.json"
  printf '%s' "${err_json}" > "${err_file}"
  run_cmd python3 "${REPO_ROOT}/scripts/lib/demo_json.py" error 400 "${err_file}"
  assert_contains "API error 400 ROUND_RULESET_INVALID: Rule set configuration rejected" "${TEST_OUT}" "Error printer formats status, code, and message"
  assert_contains "  - Map checksum mismatch: expected abc, got def" "${TEST_OUT}" "Error printer prints detail 1"
  assert_contains "  - Engine version 0.9.0 unsupported" "${TEST_OUT}" "Error printer prints detail 2"

  # ----------------------------------------------------------------------------
  # 12. Direct Injection Safety Tests on demo_json.py
  # ----------------------------------------------------------------------------
  echo "[12/12] Testing demo_json.py injection safety with special characters..."

  local test_tricky_json='{
    "data": {
      "items": [
        {
          "rank": 1,
          "team": {"name": "Team \"Quotes\" and '\''Single'\'' and \\backslash\\"},
          "rating": 1700,
          "ratedSeries": 5
        },
        {
          "seriesId": "s-trick",
          "teams": {
            "a": {"name": "Foo \"\"\"Triple\"\"\""},
            "b": {"name": "Bar '\''Single'\''"}
          },
          "score": {"a": 1, "b": 0},
          "status": "FINISHED"
        }
      ]
    }
  }'
  local tricky_file="${tmp_dir}/tricky.json"
  printf '%s' "${test_tricky_json}" > "${tricky_file}"

  run_cmd python3 -B "${REPO_ROOT}/scripts/lib/demo_json.py" round-results --stage QUALIFICATION --leaderboard "${tricky_file}" --series "${tricky_file}"
  assert_eq "0" "${TEST_CODE}" "round-results succeeds on strings with quotes, backslashes, and triple quotes"
  assert_contains "Team \"Quotes\"" "${TEST_OUT}" "Properly prints double quoted team name"
  assert_contains "Foo \"\"\"Triple\"\"\" vs Bar" "${TEST_OUT}" "Properly prints triple quote team name in series"

  # ----------------------------------------------------------------------------
  # 13. api_call Connection Error Detection (exit 7 with 000, and rc=0 with 000)
  # ----------------------------------------------------------------------------
  echo "[13/14] Testing api_call connection error detection..."

  local conn_err_bin="${tmp_dir}/conn_err_bin"
  mkdir -p "${conn_err_bin}"
  local conn_err_mode="${tmp_dir}/conn_err_mode"
  echo "exit7" > "${conn_err_mode}"

  cat > "${conn_err_bin}/curl" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "${arg}" == *"health/live"* ]]; then
    exit 0
  fi
  if [[ "${arg}" == *"auth/login"* ]]; then
    for ((i=1; i<=$#; i++)); do
      if [[ "${!i}" == "-o" ]]; then
        next_i=$((i + 1))
        echo '{"data":{"token":"mock"}}' > "${!next_i}"
      fi
    done
    printf '200'
    exit 0
  fi
done

mode="exit7"
if [[ -f "${CONN_ERR_MODE:-}" ]]; then
  mode="$(cat "${CONN_ERR_MODE}")"
fi

if [[ "${mode}" == "exit7" ]]; then
  printf '000'
  exit 7
fi

if [[ "${mode}" == "rc0_000" ]]; then
  printf '000'
  exit 0
fi

exit 0
EOF
  chmod +x "${conn_err_bin}/curl"

  # Case A: curl prints 000 and exits 7
  echo "exit7" > "${conn_err_mode}"
  run_cmd env PATH="${conn_err_bin}:${PATH}" \
    CONN_ERR_MODE="${conn_err_mode}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round status
  assert_eq "1" "${TEST_CODE}" "round status exits non-zero on connection error (exit 7)"
  assert_contains "API error: cannot reach" "${TEST_OUT}" "round status reports 'cannot reach' on curl exit 7"

  # Case B: curl exits 0 but prints 000
  echo "rc0_000" > "${conn_err_mode}"
  run_cmd env PATH="${conn_err_bin}:${PATH}" \
    CONN_ERR_MODE="${conn_err_mode}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    bash "${DEMO_SCRIPT}" round status
  assert_eq "1" "${TEST_CODE}" "round status exits non-zero on connection error (rc=0, code=000)"
  assert_contains "API error: cannot reach" "${TEST_OUT}" "round status reports 'cannot reach' on 000 status code"

  # ----------------------------------------------------------------------------
  # 14. Stdin Handling & GET Safety (No Hang on Open Pipe, No Stdin for GET)
  # ----------------------------------------------------------------------------
  echo "[14/14] Testing stdin handling: no hang on open pipe and no --data-binary for GET..."

  local stdin_test_bin="${tmp_dir}/stdin_test_bin"
  mkdir -p "${stdin_test_bin}"
  local stdin_curl_argv_log="${tmp_dir}/stdin_curl_argv.log"
  touch "${stdin_curl_argv_log}"

  cat > "${stdin_test_bin}/curl" <<EOF
#!/usr/bin/env bash
echo "ARGS: \$*" >> "${stdin_curl_argv_log}"
out_file=""
write_code=0
for ((i=1; i<=\$#; i++)); do
  arg="\${!i}"
  if [[ "\${arg}" == "-o" ]]; then
    ((i++))
    out_file="\${!i}"
  elif [[ "\${arg}" == "-w" || "\${arg}" == -w* ]]; then
    write_code=1
  fi
done

emit() {
  local code="\$1"
  local body="\$2"
  if [[ -n "\${out_file}" ]]; then
    printf '%s' "\${body}" > "\${out_file}"
  else
    printf '%s' "\${body}"
  fi
  if (( write_code == 1 )); then
    printf '%s' "\${code}"
  fi
  exit 0
}

for arg in "\$@"; do
  if [[ "\${arg}" == *"health/live"* ]]; then
    exit 0
  fi
  if [[ "\${arg}" == *"auth/login"* ]]; then
    for a in "\$@"; do
      if [[ "\${a}" == "@-" ]]; then
        cat > /dev/null
      fi
    done
    emit "200" '{"data":{"token":"mock"}}'
  fi
done

emit "200" '{"data":{"items":[]}}'
EOF
  chmod +x "${stdin_test_bin}/curl"

  # Run round status with stdin attached to an open process substitution sleep under timeout 10
  run_cmd env PATH="${stdin_test_bin}:${PATH}" \
    OTT_DEMO_ACCOUNTS_CSV="${mock_csv}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    timeout 10 bash "${DEMO_SCRIPT}" round status < <(sleep 30)
  assert_eq "0" "${TEST_CODE}" "round status with open stdin pipe completes without hanging"

  # Verify GET requests never included --data-binary in curl arguments
  local stdin_argv_content
  stdin_argv_content="$(grep -F -- "-X GET" "${stdin_curl_argv_log}" || true)"
  assert_not_contains "--data-binary" "${stdin_argv_content}" "GET calls never include --data-binary or read stdin"

  echo "================================================================="
  echo "Guard Tests Summary: ${PASSED_TESTS} passed, ${FAILED_TESTS} failed"
  echo "================================================================="
  if (( FAILED_TESTS > 0 )); then
    return 1
  fi
  return 0
}

# ------------------------------------------------------------------------------
# LIVE TESTS (Docker required - Run by Reviewer/Planner)
# ------------------------------------------------------------------------------
run_live_tests() {
  echo "================================================================="
  echo "Running demo.sh Live Docker E2E Tests"
  echo "================================================================="

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "Error: Live tests require an accessible Docker daemon." >&2
    exit 1
  fi

  LIVE_PROJECT="${OTT_DEMO_PROJECT:-ott-demo-test}"
  export OTT_DEMO_PROJECT="${LIVE_PROJECT}"

  # Pick free non-default port
  local live_port="18080"
  if command -v python3 >/dev/null 2>&1; then
    live_port="$("${REPO_ROOT}/scripts/lib/demo_json.py" find-port 2>/dev/null || echo "18080")"
  fi

  local env_file="${REPO_ROOT}/.local/demo/demo.env"

  cleanup_live() {
    local p="${LIVE_PROJECT:-ott-demo-test}"
    echo "==> [LIVE] Cleaning up live test stack (project: ${p})..."
    OTT_DEMO_PROJECT="${p}" bash "${DEMO_SCRIPT}" reset --yes || true

    local leaked_containers
    leaked_containers="$(docker ps -a --filter "label=com.docker.compose.project=${p}" -q 2>/dev/null || true)"
    local leaked_volumes
    leaked_volumes="$(docker volume ls --filter "label=com.docker.compose.project=${p}" -q 2>/dev/null || true)"

    if [[ -n "${leaked_containers}" || -n "${leaked_volumes}" ]]; then
      echo "WARNING: leaked resources for project '${p}':" >&2
      echo "  Containers: ${leaked_containers:-none}" >&2
      echo "  Volumes:    ${leaked_volumes:-none}" >&2
      exit 1
    fi
  }
  trap cleanup_live EXIT
  trap 'cleanup_live; exit 130' INT
  trap 'cleanup_live; exit 143' TERM

  echo "==> Cycle 1: up -> status -> stop"
  bash "${DEMO_SCRIPT}" up --port "${live_port}"
  if [[ "${DEMO_TEST_FAIL_AFTER:-}" == "up" ]]; then
    echo "Failure injected by DEMO_TEST_FAIL_AFTER=up right after cycle 1 up." >&2
    exit 1
  fi
  bash "${DEMO_SCRIPT}" status
  bash "${DEMO_SCRIPT}" stop

  echo "==> Cycle 2: up -> status -> accounts -> verify logins -> round lifecycle -> stop -> reset --yes"
  bash "${DEMO_SCRIPT}" up --port "${live_port}"
  bash "${DEMO_SCRIPT}" status
  bash "${DEMO_SCRIPT}" accounts

  # Assert ready probe returns status:ready
  local probe_body
  probe_body="$(curl -sf "http://127.0.0.1:${live_port}/api/v1/health/ready")"
  assert_contains '"status":"ready"' "${probe_body}" "Live ready probe returns status:ready"

  # Assert logging in as btc, team01, team02 returns 200
  local user
  for user in btc team01 team02; do
    local code
    code="$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"${user}\",\"password\":\"ABC123\"}")"
    assert_eq "200" "${code}" "Login as ${user} with ABC123 returns HTTP 200"
  done

  echo "==> Testing round lifecycle: open -> status -> close"
  bash "${DEMO_SCRIPT}" round open --yes
  local round_status_out
  round_status_out="$(bash "${DEMO_SCRIPT}" round status)"
  assert_contains "Status:     SUBMISSION_OPEN" "${round_status_out}" "Round status shows formatted 'Status:     SUBMISSION_OPEN' after round open"

  # On a bot-less demo stack, round close must exit non-zero and output recovery guidance
  local close_out=""
  local close_code=0
  close_out="$(bash "${DEMO_SCRIPT}" round close --yes 2>&1)" || close_code=$?
  if (( close_code != 0 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: round close on bot-less demo stack exits non-zero (insufficient teams for match schedule)"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: round close on bot-less demo stack unexpectedly exited 0" >&2
  fi
  assert_contains "Round ID:" "${close_out}" "round close output contains round ID"
  assert_contains "Recovery hint:" "${close_out}" "round close output contains recovery hint"
  assert_contains "Round start needs at least 2 teams with ACTIVE (gate-passed) submissions" "${close_out}" "round close output explains bot requirement"

  local round_status_closed
  round_status_closed="$(bash "${DEMO_SCRIPT}" round status)"
  assert_contains "Status:     SUBMISSION_CLOSED" "${round_status_closed}" "Round status shows formatted 'Status:     SUBMISSION_CLOSED' after round close"
  assert_not_contains "Status:     SUBMISSION_OPEN" "${round_status_closed}" "Round status is no longer SUBMISSION_OPEN after round close"

  echo "==> Testing stop on active stack before reset"
  bash "${DEMO_SCRIPT}" stop

  echo "==> Testing reset --yes and verifying volume cleanup"
  bash "${DEMO_SCRIPT}" reset --yes

  # Assert no remaining containers or volumes for the project
  local leftover_containers
  leftover_containers="$(docker ps -a --filter "label=com.docker.compose.project=${LIVE_PROJECT}" -q)"
  assert_eq "" "${leftover_containers}" "No containers left after reset"

  local leftover_volumes
  leftover_volumes="$(docker volume ls --filter "label=com.docker.compose.project=${LIVE_PROJECT}" -q)"
  assert_eq "" "${leftover_volumes}" "No volumes left after reset"

  echo "================================================================="
  echo "Live Tests Summary: ${PASSED_TESTS} passed, ${FAILED_TESTS} failed"
  echo "================================================================="
  if (( FAILED_TESTS > 0 )); then
    return 1
  fi
  return 0
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
case "${MODE}" in
  guards|static)
    run_guard_tests
    ;;
  live)
    run_live_tests
    ;;
  *)
    echo "Usage: $0 [guards|live]" >&2
    exit 2
    ;;
esac
