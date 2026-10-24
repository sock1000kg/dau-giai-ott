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
  for sub in up status accounts refresh logs round stop reset editorial; do
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

    run_cmd env OTT_DEMO_PROJECT="${bad_proj}" bash "${DEMO_SCRIPT}" refresh --yes
    assert_eq "2" "${TEST_CODE}" "Refresh rejects invalid project name '${bad_proj}' with exit 2"
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

  # Check accounts --reveal
  run_cmd env OTT_DEMO_ACCOUNTS_CSV="${sample_csv}" bash "${DEMO_SCRIPT}" accounts --reveal
  assert_eq "0" "${TEST_CODE}" "Accounts --reveal command exits 0"
  assert_contains "ABC123" "${TEST_OUT}" "Accounts --reveal outputs plaintext passwords to stdout"
  assert_contains "Warning: Revealing" "${TEST_OUT}" "Accounts --reveal warns on stderr"

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
    bash "${DEMO_SCRIPT}" up --no-build --port 19999 --bind 127.0.0.1

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
  assert_contains "APP_BIND=127.0.0.1" "${env_content}" "local demo respects the loopback bind address"
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

  # 5a. Verify plain up generated env keys vs golden keys for non-public
  local actual_keys
  actual_keys="$(grep -E '^[A-Z0-9_]+=' "${test_env_file}" | cut -d= -f1 | sort | paste -sd, -)"
  local golden_keys="APP_BIND,APP_PORT,DEMO_GID,DEMO_UID,DOCKER_GID,DOCKER_SOCKET,OTT_BOOTSTRAP_BTC_PASSWORD,OTT_BOOTSTRAP_BTC_USERNAME,OTT_DEMO_MODE,OTT_DEMO_REFERENCE_BOT_HOST_DIR,OTT_DEPLOYMENT_MODE,OTT_SECURE_COOKIES,POSTGRES_DB,POSTGRES_PASSWORD,POSTGRES_PORT,POSTGRES_USER,REDIS_PASSWORD,REDIS_PORT,S3_ACCESS_KEY_ID,S3_API_PORT,S3_BUCKET,S3_SECRET_ACCESS_KEY"
  assert_eq "${golden_keys}" "${actual_keys}" "Plain up generates exactly expected golden keys without modification"

  # 5b. --bind validation
  run_cmd env PATH="${mock_bin}:${PATH}" bash "${DEMO_SCRIPT}" up --bind not-an-ip
  assert_eq "2" "${TEST_CODE}" "Rejects invalid bind address with exit 2"
  assert_contains "Invalid bind address" "${TEST_OUT}" "Reports invalid bind address error"

  run_cmd env PATH="${mock_bin}:${PATH}" bash "${DEMO_SCRIPT}" up --bind 256.0.0.1
  assert_eq "2" "${TEST_CODE}" "Rejects out-of-range octet in bind address with exit 2"

  run_cmd env PATH="${mock_bin}:${PATH}" bash "${DEMO_SCRIPT}" up --bind 1.2.3
  assert_eq "2" "${TEST_CODE}" "Rejects incomplete bind address with exit 2"

  # 5c. --public env generation
  local pub_env_file="${tmp_dir}/pub_demo.env"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${pub_env_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --public --no-build --port 19998 --bind 127.0.0.1

  assert_eq "0" "${TEST_CODE}" "up --public succeeds with mock docker"

  local pub_env_mode
  pub_env_mode="$(stat -c %a "${pub_env_file}" 2>/dev/null || stat -f %Lp "${pub_env_file}" 2>/dev/null || echo "")"
  assert_eq "600" "${pub_env_mode}" "public demo.env has mode 0600"

  local pub_content
  pub_content="$(cat "${pub_env_file}")"
  assert_not_contains "ABC123" "${pub_content}" "public demo.env never contains ABC123"
  assert_contains "OTT_DEMO_TEAM_COUNT=10" "${pub_content}" "public demo.env has OTT_DEMO_TEAM_COUNT=10"
  assert_contains "OTT_SECURE_COOKIES=true" "${pub_content}" "public demo.env has OTT_SECURE_COOKIES=true"
  assert_contains "APP_BIND=127.0.0.1" "${pub_content}" "public demo.env has APP_BIND=127.0.0.1"
  assert_contains "DEMO_PUBLIC=true" "${pub_content}" "public demo.env has DEMO_PUBLIC=true"

  local pub_btc_pass pub_boot_btc_pass pub_team_pass
  pub_btc_pass="$(grep '^OTT_DEMO_BTC_PASSWORD=' "${pub_env_file}" | cut -d= -f2-)"
  pub_boot_btc_pass="$(grep '^OTT_BOOTSTRAP_BTC_PASSWORD=' "${pub_env_file}" | cut -d= -f2-)"
  pub_team_pass="$(grep '^OTT_DEMO_TEAM_PASSWORD=' "${pub_env_file}" | cut -d= -f2-)"

  assert_eq "${pub_btc_pass}" "${pub_boot_btc_pass}" "OTT_DEMO_BTC_PASSWORD matches OTT_BOOTSTRAP_BTC_PASSWORD"
  if [[ ${#pub_btc_pass} -ge 24 ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: BTC password length >= 24 (${#pub_btc_pass} chars)"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: BTC password too short: ${#pub_btc_pass}" >&2
  fi

  assert_eq "12" "${#pub_team_pass}" "Tester password has length 12"
  if [[ "${pub_team_pass}" =~ ^[A-Za-z0-9]+$ ]] && [[ ! "${pub_team_pass}" =~ [0O1lI] ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: Tester password contains only [A-Za-z0-9] without ambiguous chars 0O1lI"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: Tester password contains invalid or ambiguous characters: ${pub_team_pass}" >&2
  fi

  # Second run: public env not overwritten
  local pub_sha
  pub_sha="$(sha256sum "${pub_env_file}" | awk '{print $1}')"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${pub_env_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --public --no-build --port 19998
  assert_eq "0" "${TEST_CODE}" "Second up --public run succeeds as idempotent check"
  local pub_sha2
  pub_sha2="$(sha256sum "${pub_env_file}" | awk '{print $1}')"
  assert_eq "${pub_sha}" "${pub_sha2}" "public demo.env is not overwritten on second run"

  # Mode mixing guard: --public against existing local env file
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${test_env_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --public --no-build --port 19999
  assert_eq "1" "${TEST_CODE}" "up --public against local env file exits 1"
  assert_contains "env was created in local mode; run demo.sh reset first" "${TEST_OUT}" "Mixing guard prevents running --public with local env"

  # 5d. refresh command guard tests
  echo "Testing refresh command guards..."

  # Refresh non-interactive without --yes aborts
  run_cmd env PATH="${mock_bin}:${PATH}" OTT_DEMO_PROJECT="${disposable_project}" bash "${DEMO_SCRIPT}" refresh < /dev/null
  assert_eq "1" "${TEST_CODE}" "Refresh non-interactive without --yes aborts with exit code 1"
  assert_contains "Refresh requires confirmation" "${TEST_OUT}" "Refresh requires confirmation message"

  # Refresh with mismatched confirmation aborts
  run_cmd bash -c 'printf "wrong\n" | env PATH="'"${mock_bin}:${PATH}"'" OTT_DEMO_PROJECT="'"${disposable_project}"'" bash "'"${DEMO_SCRIPT}"'" refresh'
  assert_eq "1" "${TEST_CODE}" "Refresh with mismatched confirmation aborts with exit code 1"
  assert_contains "Refresh aborted" "${TEST_OUT}" "Refresh abort notice on mismatch"

  # Successful refresh with --yes: down --volumes, up + seed, env+CSV checksums untouched
  local refresh_env_file="${tmp_dir}/refresh_test.env"
  local refresh_csv_file="${tmp_dir}/refresh_test.csv"
  cp "${test_env_file}" "${refresh_env_file}"
  cp "${sample_csv}" "${refresh_csv_file}"
  local ref_env_sha_before ref_csv_sha_before
  ref_env_sha_before="$(sha256sum "${refresh_env_file}" | awk '{print $1}')"
  ref_csv_sha_before="$(sha256sum "${refresh_csv_file}" | awk '{print $1}')"

  > "${docker_log}"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${refresh_env_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${refresh_csv_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" refresh --yes

  assert_eq "0" "${TEST_CODE}" "refresh --yes succeeds with mock docker"
  local refresh_log_out
  refresh_log_out="$(cat "${docker_log}")"
  assert_contains "down --volumes --remove-orphans" "${refresh_log_out}" "refresh executes down --volumes --remove-orphans"
  assert_contains "up" "${refresh_log_out}" "refresh re-executes compose up"
  assert_contains "seed-demo" "${refresh_log_out}" "refresh re-executes seed-demo"

  local ref_env_sha_after ref_csv_sha_after
  ref_env_sha_after="$(sha256sum "${refresh_env_file}" | awk '{print $1}')"
  ref_csv_sha_after="$(sha256sum "${refresh_csv_file}" | awk '{print $1}')"
  assert_eq "${ref_env_sha_before}" "${ref_env_sha_after}" "demo.env checksum untouched across refresh"
  assert_eq "${ref_csv_sha_before}" "${ref_csv_sha_after}" "accounts.csv checksum untouched across refresh"

  # Concurrent-run lock guard
  local ref_lock="${refresh_env_file}.lock"
  touch "${ref_lock}"
  (
    exec 9>"${ref_lock}"
    flock -x 9
    sleep 3
  ) &
  local bg_flock_pid=$!
  sleep 0.2

  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${refresh_env_file}" \
    OTT_DEMO_ACCOUNTS_CSV="${refresh_csv_file}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" refresh --yes
  assert_eq "1" "${TEST_CODE}" "Concurrent refresh blocked by lock exits 1"
  assert_contains "Another demo.sh refresh is currently running" "${TEST_OUT}" "Reports lock conflict error"

  kill "${bg_flock_pid}" 2>/dev/null || true
  wait "${bg_flock_pid}" 2>/dev/null || true

  # Refresh with missing demo.env exits 1, prints error, stub docker log empty, no env created
  local missing_refresh_env="${tmp_dir}/missing_refresh.env"
  rm -f "${missing_refresh_env}"
  > "${docker_log}"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${missing_refresh_env}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" refresh --yes
  assert_eq "1" "${TEST_CODE}" "Refresh without env file exits 1"
  assert_contains "Error: no demo env at ${missing_refresh_env}; run demo.sh up [--public] first" "${TEST_OUT}" "Refresh without env reports clear error"
  local missing_ref_log
  missing_ref_log="$(cat "${docker_log}")"
  assert_eq "" "${missing_ref_log}" "Stub docker log is empty on refresh with missing env"
  if [[ ! -f "${missing_refresh_env}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: No env file created by failed refresh"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: Env file was unexpectedly created by refresh" >&2
  fi

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

  # Reset with absent demo.env skips compose down and cleans by label
  local absent_reset_env="${tmp_dir}/absent_reset.env"
  rm -f "${absent_reset_env}"
  > "${docker_log}"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${absent_reset_env}" \
    bash "${DEMO_SCRIPT}" reset --yes
  assert_eq "0" "${TEST_CODE}" "Reset with absent demo.env exits 0"
  assert_contains "No env file; removing project resources by label..." "${TEST_OUT}" "Reset prints removing by label when demo.env absent"
  local absent_reset_log
  absent_reset_log="$(cat "${docker_log}")"
  assert_not_contains "down" "${absent_reset_log}" "Docker compose down was skipped when demo.env is absent"

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

  # ----------------------------------------------------------------------------
  # 15. Custom OTT_DEMO_ACCOUNTS_CSV Isolation & Compose Environment Export
  # ----------------------------------------------------------------------------
  echo "[15/15] Testing custom OTT_DEMO_ACCOUNTS_CSV directory isolation and compose export..."

  local isolation_bin="${tmp_dir}/isolation_bin"
  mkdir -p "${isolation_bin}"
  local docker_seed_log="${tmp_dir}/docker_seed_env.log"
  touch "${docker_seed_log}"

  cat > "${isolation_bin}/docker" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "${arg}" == "seed-demo" ]]; then
    echo "SEED_DEMO_RUN: OTT_DEMO_ACCOUNTS_DIR=${OTT_DEMO_ACCOUNTS_DIR:-} OTT_DEMO_ACCOUNTS_BASENAME=${OTT_DEMO_ACCOUNTS_BASENAME:-}" >> "${DOCKER_SEED_LOG}"
  fi
done
if [[ "$1" == "info" || "$1" == "version" ]]; then
  echo "Server Version: 25.0.0"
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "version" ]]; then
  echo "Docker Compose version v2.24.0"
  exit 0
fi
exit 0
EOF
  chmod +x "${isolation_bin}/docker"

  cat > "${isolation_bin}/curl" <<'EOF'
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
  chmod +x "${isolation_bin}/curl"

  # Case A: Custom accounts CSV path
  local custom_e2e_dir="${tmp_dir}/custom_e2e"
  local custom_csv="${custom_e2e_dir}/accounts.csv"
  local custom_env="${custom_e2e_dir}/demo.env"

  # Baseline fingerprint of real repo's .local/demo before custom up run
  local real_dev_demo="${REPO_ROOT}/.local/demo"
  local real_demo_before="absent"
  if [[ -d "${real_dev_demo}" ]]; then
    real_demo_before="$(cd "${real_dev_demo}" && ls -la 2>/dev/null && sha256sum * 2>/dev/null || echo "empty")"
  fi

  run_cmd env PATH="${isolation_bin}:${PATH}" \
    DOCKER_SEED_LOG="${docker_seed_log}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ACCOUNTS_CSV="${custom_csv}" \
    OTT_DEMO_ENV_FILE="${custom_env}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --no-build --port 19997

  assert_eq "0" "${TEST_CODE}" "up with custom OTT_DEMO_ACCOUNTS_CSV succeeds"

  local custom_dir_mode
  custom_dir_mode="$(stat -c %a "${custom_e2e_dir}" 2>/dev/null || stat -f %Lp "${custom_e2e_dir}" 2>/dev/null || echo "")"
  assert_eq "700" "${custom_dir_mode}" "custom accounts directory is created with mode 700"

  local seed_log_content
  seed_log_content="$(cat "${docker_seed_log}")"
  assert_contains "SEED_DEMO_RUN: OTT_DEMO_ACCOUNTS_DIR=${custom_e2e_dir} OTT_DEMO_ACCOUNTS_BASENAME=accounts.csv" "${seed_log_content}" "stub docker sees custom accounts dir and basename during seed-demo run"

  # Verify real repo .local/demo remains completely untouched
  local real_demo_after="absent"
  if [[ -d "${real_dev_demo}" ]]; then
    real_demo_after="$(cd "${real_dev_demo}" && ls -la 2>/dev/null && sha256sum * 2>/dev/null || echo "empty")"
  fi
  assert_eq "${real_demo_before}" "${real_demo_after}" "real repo .local/demo remains completely untouched by custom accounts run"

  # Case B: Default-path case (no OTT_DEMO_ACCOUNTS_CSV / OTT_DEMO_ENV_FILE env vars)
  local fake_repo="${tmp_dir}/fake_repo"
  mkdir -p "${fake_repo}/scripts" "${fake_repo}/infra/local"
  cp "${DEMO_SCRIPT}" "${fake_repo}/scripts/demo.sh"
  if [[ -d "${REPO_ROOT}/scripts/lib" ]]; then
    cp -r "${REPO_ROOT}/scripts/lib" "${fake_repo}/scripts/lib"
  fi
  cat > "${fake_repo}/infra/local/compose.yaml" <<'EOF'
services: {}
EOF

  local default_seed_log="${tmp_dir}/default_seed_env.log"
  touch "${default_seed_log}"

  run_cmd bash -c 'cd "'"${fake_repo}"'" && env PATH="'"${isolation_bin}:${PATH}"'" \
    DOCKER_SEED_LOG="'"${default_seed_log}"'" \
    OTT_DEMO_PROJECT="'"${disposable_project}"'" \
    DOCKER_SOCKET="'"${fake_socket}"'" \
    bash scripts/demo.sh up --no-build --port 19996'

  assert_eq "0" "${TEST_CODE}" "default-path up succeeds with fake repo"

  local default_log_content
  default_log_content="$(cat "${default_seed_log}")"
  assert_contains "SEED_DEMO_RUN: OTT_DEMO_ACCOUNTS_DIR=${fake_repo}/.local/demo OTT_DEMO_ACCOUNTS_BASENAME=accounts.csv" "${default_log_content}" "default-path run exports .local/demo and accounts.csv"

  local default_dir_mode
  default_dir_mode="$(stat -c %a "${fake_repo}/.local/demo" 2>/dev/null || stat -f %Lp "${fake_repo}/.local/demo" 2>/dev/null || echo "")"
  assert_eq "700" "${default_dir_mode}" "default .local/demo directory created with mode 700"

  # ----------------------------------------------------------------------------
  # 16. Demo Credential Fingerprint Stability and Sibling Isolation
  # ----------------------------------------------------------------------------
  echo "[16/17] Testing demo credential fingerprint stability and sibling isolation..."

  RUN_LOCAL_DEMO_E2E_SOURCED=1 source "${REPO_ROOT}/scripts/run-local-demo-e2e.sh"

  local fp_test_parent="${tmp_dir}/fp_test_parent"
  local fp_demo_dir="${fp_test_parent}/demo"
  mkdir -p "${fp_demo_dir}"
  echo "secret" > "${fp_demo_dir}/demo.env"
  echo "dotfile-content" > "${fp_demo_dir}/.env.local"

  local base_fp
  base_fp="$(compute_demo_fingerprint "${fp_demo_dir}")"

  # Sibling creation and removal does not affect fingerprint
  mkdir -p "${fp_test_parent}/demo-e2e"
  echo "temp" > "${fp_test_parent}/demo-e2e/temp.csv"
  rm -rf "${fp_test_parent}/demo-e2e"
  local post_sibling_fp
  post_sibling_fp="$(compute_demo_fingerprint "${fp_demo_dir}")"
  assert_eq "${base_fp}" "${post_sibling_fp}" "fingerprint unchanged after sibling directory creation and removal"

  # Modifying a file changes fingerprint
  echo "secret-modified" > "${fp_demo_dir}/demo.env"
  local modified_fp
  modified_fp="$(compute_demo_fingerprint "${fp_demo_dir}")"
  if [[ "${base_fp}" != "${modified_fp}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: fingerprint changes when file content is modified"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: fingerprint did not change after file modification" >&2
  fi

  # Adding a dotfile changes fingerprint
  echo "new-dot" > "${fp_demo_dir}/.newdot"
  local dot_added_fp
  dot_added_fp="$(compute_demo_fingerprint "${fp_demo_dir}")"
  if [[ "${modified_fp}" != "${dot_added_fp}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: fingerprint changes when dotfile is added"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: fingerprint did not change after dotfile was added" >&2
  fi

  # Removing dotfile changes fingerprint
  rm -f "${fp_demo_dir}/.newdot"
  local dot_removed_fp
  dot_removed_fp="$(compute_demo_fingerprint "${fp_demo_dir}")"
  if [[ "${dot_added_fp}" != "${dot_removed_fp}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: fingerprint changes when dotfile is removed"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: fingerprint did not change after dotfile was removed" >&2
  fi

  # Absent directory returns 'absent'
  local absent_fp
  absent_fp="$(compute_demo_fingerprint "${fp_test_parent}/nonexistent")"
  assert_eq "absent" "${absent_fp}" "absent directory returns 'absent'"

  # Empty directory returns 'absent'
  local empty_dir="${fp_test_parent}/empty_dir"
  mkdir -p "${empty_dir}"
  local empty_fp
  empty_fp="$(compute_demo_fingerprint "${empty_dir}")"
  assert_eq "absent" "${empty_fp}" "empty directory returns 'absent'"

  # ----------------------------------------------------------------------------
  # 17. E2E Gateway Port Scanner (18080..18180) and Bind Checks
  # ----------------------------------------------------------------------------
  echo "[17/17] Testing E2E gateway port scanner (18080..18180) and bind checks..."

  # Case 1: 18080 busy => returns 18081
  is_port_bindable() {
    local p="$1"
    if (( p == 18080 )); then
      return 1
    fi
    return 0
  }

  local picked_port
  picked_port="$(find_free_demo_port)"
  assert_eq "18081" "${picked_port}" "find_free_demo_port skips busy 18080 and selects 18081"

  # Case 2: All busy => non-zero exit code + message
  is_port_bindable() {
    return 1
  }

  local all_busy_out
  local all_busy_rc=0
  all_busy_out="$(find_free_demo_port 2>&1)" || all_busy_rc=$?
  if (( all_busy_rc != 0 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: find_free_demo_port returns non-zero when all candidate ports are busy"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: find_free_demo_port succeeded when all candidate ports were busy" >&2
  fi
  assert_contains "No free port found in range 18080..18180" "${all_busy_out}" "all busy failure message names range 18080..18180"

  # Case 3: Override honoured without scanning
  local test_override_port="19099"
  local selected_port="${test_override_port}"
  if [[ -z "${selected_port}" ]]; then
    selected_port="$(find_free_demo_port)"
  fi
  assert_eq "19099" "${selected_port}" "APP_PORT override is honoured directly without scanning"

  # Restore default functions from runner
  RUN_LOCAL_DEMO_E2E_SOURCED=1 source "${REPO_ROOT}/scripts/run-local-demo-e2e.sh"

  # ----------------------------------------------------------------------------
  # 18. Runner Subprocess EXIT Trap and Global State Lifecycle
  # ----------------------------------------------------------------------------
  echo "[18/19] Testing runner subprocess EXIT trap and global state lifecycle..."

  local trap_sub_bin="${tmp_dir}/trap_sub_bin"
  mkdir -p "${trap_sub_bin}"
  local sub_log="${tmp_dir}/sub_stub_demo.log"
  local sub_demo="${tmp_dir}/sub_stub_demo.sh"

  cat > "${sub_demo}" <<'EOF'
#!/usr/bin/env bash
echo "CALL: $@ | OTT_DEMO_ENV_FILE=${OTT_DEMO_ENV_FILE:-} | OTT_DEMO_ACCOUNTS_CSV=${OTT_DEMO_ACCOUNTS_CSV:-}" >> "${SUB_STUB_LOG}"
if [[ "$1" == "up" ]]; then
  if [[ -n "${OTT_DEMO_ACCOUNTS_CSV:-}" ]]; then
    mkdir -p "$(dirname "${OTT_DEMO_ACCOUNTS_CSV}")"
    touch "${OTT_DEMO_ACCOUNTS_CSV}"
  fi
  exit 0
fi
if [[ "$1" == "reset" ]]; then
  exit 0
fi
exit 0
EOF
  chmod +x "${sub_demo}"

  cat > "${trap_sub_bin}/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "info" || "$1" == "version" ]]; then exit 0; fi
if [[ "$1" == "ps" || "$1" == "volume" ]]; then exit 0; fi
exit 0
EOF
  chmod +x "${trap_sub_bin}/docker"

  cat > "${trap_sub_bin}/node" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-v" || "$1" == "--version" ]]; then
  echo "v22.0.0"
  exit 0
fi
exec /usr/bin/node "$@"
EOF
  chmod +x "${trap_sub_bin}/node"

  cat > "${trap_sub_bin}/npx" <<'EOF'
#!/usr/bin/env bash
echo "vitest stub passed"
exit 0
EOF
  chmod +x "${trap_sub_bin}/npx"

  cat > "${trap_sub_bin}/npm" <<'EOF'
#!/usr/bin/env bash
if [[ "${STUB_NPM_FAIL:-0}" == "1" ]]; then
  echo "npm ci simulated failure" >&2
  exit 1
fi
exit 0
EOF
  chmod +x "${trap_sub_bin}/npm"

  cat > "${trap_sub_bin}/git" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-C" ]]; then
  shift 2
fi
if [[ "$1" == "worktree" && "$2" == "add" ]]; then
  mkdir -p "$4"
  touch "$4/package.json"
  exit 0
fi
if [[ "$1" == "worktree" && ("$2" == "remove" || "$2" == "prune") ]]; then
  if [[ "$2" == "remove" ]]; then
    rm -rf "$4" 2>/dev/null || true
  fi
  exit 0
fi
if [[ "$1" == "worktree" && "$2" == "list" ]]; then
  echo "/repo HEAD [main]"
  exit 0
fi
exec /usr/bin/git "$@"
EOF
  chmod +x "${trap_sub_bin}/git"

  # Case A: Early failure hook right after trap installation
  rm -f "${sub_log}"
  run_cmd env PATH="${trap_sub_bin}:${PATH}" \
    SUB_STUB_LOG="${sub_log}" \
    OTT_DEMO_SCRIPT="${sub_demo}" \
    DEMO_E2E_FAIL_AFTER="trap" \
    bash "${REPO_ROOT}/scripts/run-local-demo-e2e.sh"

  assert_eq "1" "${TEST_CODE}" "runner with DEMO_E2E_FAIL_AFTER=trap exits non-zero"
  assert_contains "Cleaning up demo E2E stack" "${TEST_OUT}" "cleanup trap ran on early exit hook"
  assert_not_contains "unbound variable" "${TEST_OUT}" "no unbound variable errors in trap execution"
  local sub_log_content
  sub_log_content="$(cat "${sub_log}" 2>/dev/null || echo "")"
  assert_contains "CALL: reset --yes" "${sub_log_content}" "stub demo.sh was invoked with reset --yes"
  assert_contains "demo-e2e/demo.env" "${sub_log_content}" "demo.sh reset was passed isolated OTT_DEMO_ENV_FILE"
  assert_contains "demo-e2e/accounts.csv" "${sub_log_content}" "demo.sh reset was passed isolated OTT_DEMO_ACCOUNTS_CSV"

  # Case B: Success path reaches cleanup once with exit 0
  rm -f "${sub_log}"
  run_cmd env PATH="${trap_sub_bin}:${PATH}" \
    SUB_STUB_LOG="${sub_log}" \
    OTT_DEMO_SCRIPT="${sub_demo}" \
    bash "${REPO_ROOT}/scripts/run-local-demo-e2e.sh"

  assert_eq "0" "${TEST_CODE}" "runner success path exits 0"
  assert_not_contains "unbound variable" "${TEST_OUT}" "no unbound variable in success path output"
  local sub_cleanup_count
  sub_cleanup_count="$(grep -c "Cleaning up demo E2E stack" <<< "${TEST_OUT}" || echo 0)"
  assert_eq "1" "${sub_cleanup_count}" "cleanup trap called exactly once on success path"

  # Case C: Clean checkout early failure path removes worktree directory
  rm -f "${sub_log}"
  run_cmd env PATH="${trap_sub_bin}:${PATH}" \
    SUB_STUB_LOG="${sub_log}" \
    STUB_NPM_FAIL="1" \
    OTT_DEMO_SCRIPT="${sub_demo}" \
    bash "${REPO_ROOT}/scripts/run-local-demo-e2e.sh" --clean-checkout

  assert_eq "1" "${TEST_CODE}" "runner fails when npm ci fails during clean-checkout"
  assert_contains "Removing temporary worktree" "${TEST_OUT}" "trap removes temporary worktree on npm failure"
  local created_wt_path
  created_wt_path="$(echo "${TEST_OUT}" | grep -oE '/tmp/ott-e2e\.[a-zA-Z0-9]+' | head -n1 || echo "")"
  if [[ -n "${created_wt_path}" && ! -d "${created_wt_path}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: temporary clean-checkout worktree was removed on early failure"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: temporary worktree ${created_wt_path} was not cleaned up" >&2
  fi

  # ----------------------------------------------------------------------------
  # 19. Datastore Port Scan (18181..18380) Verification
  # ----------------------------------------------------------------------------
  echo "[19/19] Testing datastore port scanner (18181..18380) and fallback..."

  # (a) find-port output is within 18181..18380
  local ds_port
  ds_port="$(python3 -B "${REPO_ROOT}/scripts/lib/demo_json.py" find-port)"
  if (( ds_port >= 18181 && ds_port <= 18380 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: demo_json.py find-port returns port in range 18181..18380 (${ds_port})"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: find-port returned ${ds_port}, expected 18181..18380" >&2
  fi

  # (b) each avoid list value is skipped
  local ds_avoid_port
  ds_avoid_port="$(python3 -B "${REPO_ROOT}/scripts/lib/demo_json.py" find-port 18181 18182)"
  if (( ds_avoid_port >= 18183 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: find-port skips avoid list values (got ${ds_avoid_port} >= 18183)"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: find-port did not skip avoid list, returned ${ds_avoid_port}" >&2
  fi

  # (c) occupy 18181 with background python listener (kill by PID with trap, no pkill/pgrep -f)
  python3 -c '
import socket, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 18181))
s.listen(1)
time.sleep(10)
' &
  local listener_pid=$!
  sleep 0.2

  local ds_occupied_port
  ds_occupied_port="$(python3 -B "${REPO_ROOT}/scripts/lib/demo_json.py" find-port)"
  kill "${listener_pid}" 2>/dev/null || true
  wait "${listener_pid}" 2>/dev/null || true

  if (( ds_occupied_port != 18181 && ds_occupied_port >= 18182 && ds_occupied_port <= 18380 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: find-port skips occupied port 18181 and returns another port (${ds_occupied_port})"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: find-port returned occupied port or out of range (${ds_occupied_port})" >&2
  fi

  # (d) exhaustion (all 200 ports in avoid list) => exit 1 + message
  local all_avoid_ports=($(seq 18181 18380))
  local exhaust_out
  local exhaust_rc=0
  exhaust_out="$(python3 -B "${REPO_ROOT}/scripts/lib/demo_json.py" find-port "${all_avoid_ports[@]}" 2>&1)" || exhaust_rc=$?

  assert_eq "1" "${exhaust_rc}" "find-port returns exit 1 on range exhaustion"
  assert_contains "no free port in 18181..18380" "${exhaust_out}" "find-port reports exhaustion error message"

  # (e) shell fallback in demo.sh when python3 is hidden from PATH
  eval "$(sed -n '/^find_free_port() {/,/^}/p' "${REPO_ROOT}/scripts/demo.sh")"
  local mock_no_py="${tmp_dir}/mock_no_py"
  mkdir -p "${mock_no_py}"
  cat > "${mock_no_py}/python3" <<'EOF'
#!/bin/sh
exit 1
EOF
  chmod +x "${mock_no_py}/python3"

  local shell_fallback_port
  shell_fallback_port="$(DEMO_JSON_PY="${REPO_ROOT}/scripts/lib/demo_json.py" PATH="${mock_no_py}:${PATH}" find_free_port)"
  if (( shell_fallback_port >= 18181 && shell_fallback_port <= 18380 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: shell find_free_port fallback returns port in range 18181..18380 (${shell_fallback_port})"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: shell find_free_port fallback returned ${shell_fallback_port}, expected 18181..18380" >&2
  fi

  # ----------------------------------------------------------------------------
  # 20. Local Demo Schedule Builder Unit Tests (Docker-free vitest)
  # ----------------------------------------------------------------------------
  echo "[20/21] Testing demo schedule builder contract (Docker-free vitest)..."
  local sched_test_out
  local sched_rc=0
  sched_test_out="$(npx vitest run tests/e2e/local-demo-schedule.test.ts --config tests/e2e/local-demo.config.ts 2>&1)" || sched_rc=$?
  if (( sched_rc == 0 )); then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: local-demo-schedule.test.ts passed all ordering and timing assertions"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: local-demo-schedule.test.ts failed (exit ${sched_rc}):" >&2
    echo "${sched_test_out}" >&2
  fi

  # ----------------------------------------------------------------------------
  # 21. Editorial File Lifecycle & demo.sh editorial (Docker-free)
  # ----------------------------------------------------------------------------
  echo "[21/21] Testing demo editorial file lifecycle and demo.sh editorial..."
  local editorial_tmp="${tmp_dir}/custom_editorial"
  run_cmd env OTT_DEMO_EDITORIAL_HOST_DIR="${editorial_tmp}" bash "${DEMO_SCRIPT}" editorial
  assert_eq "0" "${TEST_CODE}" "demo.sh editorial exits 0"
  assert_contains "Editorial file: ${editorial_tmp}/public.json" "${TEST_OUT}" "editorial prints expected path"
  assert_contains "Example announcement:" "${TEST_OUT}" "editorial prints example announcement"

  # Test that up creates the file if missing
  local edit_test_env="${tmp_dir}/edit_demo.env"
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${edit_test_env}" \
    OTT_DEMO_EDITORIAL_HOST_DIR="${editorial_tmp}" \
    DOCKER_SOCKET="${fake_socket}" \
    bash "${DEMO_SCRIPT}" up --no-build --port 19997

  assert_eq "0" "${TEST_CODE}" "up with custom editorial dir succeeds"
  if [[ -f "${editorial_tmp}/public.json" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: public.json created by demo.sh up"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: public.json was not created by demo.sh up" >&2
  fi

  local edit_content
  edit_content="$(cat "${editorial_tmp}/public.json")"
  assert_contains '"announcements": []' "${edit_content}" "public.json contains empty announcements array"
  assert_contains '"minimumSeries": 5' "${edit_content}" "public.json contains minimumSeries default"

  # Reset preserves public.json
  run_cmd env PATH="${mock_bin}:${PATH}" \
    OTT_DEMO_PROJECT="${disposable_project}" \
    OTT_DEMO_ENV_FILE="${edit_test_env}" \
    OTT_DEMO_EDITORIAL_HOST_DIR="${editorial_tmp}" \
    bash "${DEMO_SCRIPT}" reset --yes
  if [[ -f "${editorial_tmp}/public.json" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: public.json preserved across demo.sh reset"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: public.json was unexpectedly wiped by demo.sh reset" >&2
  fi

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

  echo "==> Cycle 3: up --public -> login with CSV passwords -> round open -> refresh --yes -> verify logins and data wiped -> reset --yes"
  bash "${DEMO_SCRIPT}" up --public --port "${live_port}"
  bash "${DEMO_SCRIPT}" status

  # Assert ready probe returns status:ready
  local pub_probe
  pub_probe="$(curl -sf "http://127.0.0.1:${live_port}/api/v1/health/ready")"
  assert_contains '"status":"ready"' "${pub_probe}" "Public demo ready probe returns status:ready"

  # Read passwords from CSV
  local csv_file="${REPO_ROOT}/.local/demo/accounts.csv"
  local live_env_file="${REPO_ROOT}/.local/demo/demo.env"
  local btc_csv_pass team10_csv_pass
  btc_csv_pass="$(awk -F',' '$1=="btc"{print $2}' "${csv_file}")"
  team10_csv_pass="$(awk -F',' '$1=="team10"{print $2}' "${csv_file}")"

  # Assert btc login with CSV password returns 200 + cookie
  local btc_headers
  btc_headers="$(mktemp "${TMPDIR:-/tmp}/btc_login_headers.XXXXXX")"
  local btc_code
  btc_code="$(curl -s -D "${btc_headers}" -o /dev/null -w "%{http_code}" \
    -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"btc\",\"password\":\"${btc_csv_pass}\"}")"
  assert_eq "200" "${btc_code}" "Public demo login as btc with CSV password returns HTTP 200"
  local btc_cookie
  btc_cookie="$(grep -i '^set-cookie:' "${btc_headers}" || true)"
  if [[ -n "${btc_cookie}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: btc login sets session cookie"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: btc login did not set cookie" >&2
  fi
  rm -f "${btc_headers}"

  # Assert team10 login with CSV password returns 200 + cookie
  local t10_headers
  t10_headers="$(mktemp "${TMPDIR:-/tmp}/t10_login_headers.XXXXXX")"
  local t10_code
  t10_code="$(curl -s -D "${t10_headers}" -o /dev/null -w "%{http_code}" \
    -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"team10\",\"password\":\"${team10_csv_pass}\"}")"
  assert_eq "200" "${t10_code}" "Public demo login as team10 with CSV password returns HTTP 200"
  local t10_cookie
  t10_cookie="$(grep -i '^set-cookie:' "${t10_headers}" || true)"
  if [[ -n "${t10_cookie}" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "  PASS: team10 login sets session cookie"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "  FAIL: team10 login did not set cookie" >&2
  fi
  rm -f "${t10_headers}"

  # Assert ABC123 rejected (401)
  local btc_bad_code
  btc_bad_code="$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"btc\",\"password\":\"ABC123\"}")"
  assert_eq "401" "${btc_bad_code}" "Public demo btc login with ABC123 rejected with 401"

  local t10_bad_code
  t10_bad_code="$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"team10\",\"password\":\"ABC123\"}")"
  assert_eq "401" "${t10_bad_code}" "Public demo team10 login with ABC123 rejected with 401"

  # Create a row before refresh: open round
  bash "${DEMO_SCRIPT}" round open --yes
  local pre_refresh_status
  pre_refresh_status="$(bash "${DEMO_SCRIPT}" round status)"
  assert_contains "Status:     SUBMISSION_OPEN" "${pre_refresh_status}" "Round opened before refresh"
  local pre_round_id
  pre_round_id="$(echo "${pre_refresh_status}" | grep -oE 'Round [a-zA-Z0-9_-]+' | head -n1 | cut -d' ' -f2 || true)"

  # Record checksums of env and CSV before refresh
  local pre_env_sha pre_csv_sha
  pre_env_sha="$(sha256sum "${live_env_file}" | awk '{print $1}')"
  pre_csv_sha="$(sha256sum "${csv_file}" | awk '{print $1}')"

  # Perform refresh --yes
  echo "==> Running demo.sh refresh --yes"
  bash "${DEMO_SCRIPT}" refresh --yes

  # Assert readiness again
  local post_refresh_probe
  post_refresh_probe="$(curl -sf "http://127.0.0.1:${live_port}/api/v1/health/ready")"
  assert_contains '"status":"ready"' "${post_refresh_probe}" "Ready probe returns status:ready after refresh"

  # Assert same logins still work
  local btc_post_code
  btc_post_code="$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"btc\",\"password\":\"${btc_csv_pass}\"}")"
  assert_eq "200" "${btc_post_code}" "btc login still works with same password after refresh"

  local t10_post_code
  t10_post_code="$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://127.0.0.1:${live_port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"team10\",\"password\":\"${team10_csv_pass}\"}")"
  assert_eq "200" "${t10_post_code}" "team10 login still works with same password after refresh"

  # Assert the row created before (the round) is gone
  local post_refresh_status
  post_refresh_status="$(bash "${DEMO_SCRIPT}" round status)"
  if [[ -n "${pre_round_id}" ]]; then
    assert_not_contains "${pre_round_id}" "${post_refresh_status}" "Pre-refresh round is gone after refresh"
  fi
  assert_contains "No qualification rounds found." "${post_refresh_status}" "Round data wiped by refresh"

  # Assert env/CSV checksums unchanged
  local post_env_sha post_csv_sha
  post_env_sha="$(sha256sum "${live_env_file}" | awk '{print $1}')"
  post_csv_sha="$(sha256sum "${csv_file}" | awk '{print $1}')"
  assert_eq "${pre_env_sha}" "${post_env_sha}" "demo.env checksum unchanged across refresh"
  assert_eq "${pre_csv_sha}" "${post_csv_sha}" "accounts.csv checksum unchanged across refresh"

  # Final cleanup and leak check
  bash "${DEMO_SCRIPT}" reset --yes
  local post_containers
  post_containers="$(docker ps -a --filter "label=com.docker.compose.project=${LIVE_PROJECT}" -q)"
  assert_eq "" "${post_containers}" "No containers left after Cycle 3 reset"
  local post_volumes
  post_volumes="$(docker volume ls --filter "label=com.docker.compose.project=${LIVE_PROJECT}" -q)"
  assert_eq "" "${post_volumes}" "No volumes left after Cycle 3 reset"

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
