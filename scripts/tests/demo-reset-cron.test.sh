#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="${REPO_ROOT}/scripts/install-demo-reset-cron.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
MOCK_BIN="${TMP_DIR}/bin"
mkdir -m 0700 "${MOCK_BIN}"

cat > "${MOCK_BIN}/crontab" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-}" in
  -l) [[ -f "${DEMO_TEST_CRONTAB_FILE}" ]] && cat "${DEMO_TEST_CRONTAB_FILE}"; exit 0 ;;
  -) cat > "${DEMO_TEST_CRONTAB_FILE}" ;;
  *) exit 2 ;;
esac
MOCK
cat > "${MOCK_BIN}/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
exit 0
MOCK
chmod 0700 "${MOCK_BIN}/crontab" "${MOCK_BIN}/docker"
export PATH="${MOCK_BIN}:${PATH}"
export DEMO_TEST_CRONTAB_FILE="${TMP_DIR}/crontab"

mkdir -p -m 0700 "${TMP_DIR}/bundle/data" "${TMP_DIR}/seaweed" "${TMP_DIR}/snapshots"
printf 'dump\n' > "${TMP_DIR}/bundle/data/database.dump"
printf 'object\n' > "${TMP_DIR}/seaweed/object"
printf 'snapshot\n' > "${TMP_DIR}/snapshots/latest.json"
tar -czf "${TMP_DIR}/bundle/data/seaweedfs-objects.tar.gz" -C "${TMP_DIR}/seaweed" .
tar -czf "${TMP_DIR}/bundle/data/snapshots.tar.gz" -C "${TMP_DIR}/snapshots" .
python3 - "${TMP_DIR}/bundle/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump({"format":"ott-demo-snapshot-v2", "source":{"commit":"fixture","composeProject":"ott-demo-test"}, "metrics":{}, "payloads":{"database.dump":{}, "seaweedfs-objects.tar.gz":{}, "snapshots.tar.gz":{}}}, output)
PY
(cd "${TMP_DIR}/bundle" && sha256sum data/database.dump data/seaweedfs-objects.tar.gz data/snapshots.tar.gz > checksums.sha256)

python3 - "${TMP_DIR}/demo.env" "${REPO_ROOT}/demo/team-accounts.csv" <<'PY'
import csv, sys
with open(sys.argv[2], newline="", encoding="utf-8") as source:
    password = next(csv.DictReader(source))["password"]
with open(sys.argv[1], "w", encoding="utf-8") as output:
    output.write("OTT_DEMO_MODE=true\nOTT_DEPLOYMENT_MODE=dev\nDEMO_PUBLIC=false\nAPP_BIND=127.0.0.1\n")
    output.write(f"OTT_DEMO_TEAM_PASSWORD={password}\n")
PY
chmod 0600 "${TMP_DIR}/demo.env"
touch "${TMP_DIR}/compose.yaml"
printf '*/5 * * * * /usr/bin/true\n' > "${DEMO_TEST_CRONTAB_FILE}"
printf 'REPO_ROOT=%s\nOTT_DEMO_PROJECT=ott-demo-test\nOTT_DEMO_ENV_FILE=%s\nOTT_DEMO_COMPOSE_FILE=%s\nOTT_DEMO_SNAPSHOT_BUNDLE=%s\nOTT_DEMO_RESET_LOG=%s\nOTT_DEMO_RESET_CRON=0 * * * *\nOTT_DEMO_RESET_TIMEZONE=Asia/Ho_Chi_Minh\n' \
  "${REPO_ROOT}" "${TMP_DIR}/demo.env" "${TMP_DIR}/compose.yaml" "${TMP_DIR}/bundle" "${TMP_DIR}/reset.log" > "${TMP_DIR}/cron.env"
chmod 0600 "${TMP_DIR}/cron.env"

cat > "${MOCK_BIN}/rg" <<MOCK
#!/usr/bin/env bash
: > "${TMP_DIR}/rg-was-called"
exit 127
MOCK
chmod 0700 "${MOCK_BIN}/rg"
bash "${INSTALLER}" install "${TMP_DIR}/cron.env" >/dev/null
[[ ! -e "${TMP_DIR}/rg-was-called" ]]
rm "${MOCK_BIN}/rg"
bash "${INSTALLER}" install "${TMP_DIR}/cron.env" >/dev/null
[[ "$(rg -c -F '# BEGIN OTT DEMO SNAPSHOT RESET' "${DEMO_TEST_CRONTAB_FILE}")" == 1 ]]
rg -q '^\*/5 \* \* \* \* /usr/bin/true$' "${DEMO_TEST_CRONTAB_FILE}"
rg -q '^SHELL=/bin/bash$' "${DEMO_TEST_CRONTAB_FILE}"
rg -q '^PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin$' "${DEMO_TEST_CRONTAB_FILE}"
rg -q '^CRON_TZ=Asia/Ho_Chi_Minh$' "${DEMO_TEST_CRONTAB_FILE}"
rg -q '^0 \* \* \* \* /usr/bin/flock -n ' "${DEMO_TEST_CRONTAB_FILE}"
! rg -q 'password=[^ ]+' "${DEMO_TEST_CRONTAB_FILE}"
printf 'PASS: installer is idempotent, hourly, timezone-aware, locked and preserves unrelated cron entries\n'

bash "${INSTALLER}" status > "${TMP_DIR}/status"
rg -q 'is installed' "${TMP_DIR}/status"
bash "${INSTALLER}" uninstall >/dev/null
rg -q '^\*/5 \* \* \* \* /usr/bin/true$' "${DEMO_TEST_CRONTAB_FILE}"
! rg -q 'OTT DEMO SNAPSHOT RESET' "${DEMO_TEST_CRONTAB_FILE}"
printf 'PASS: status and uninstall affect only the managed cron block\n'

for public_flag in DEMO_PUBLIC OTT_DEMO_PUBLIC OTT_HOSTED_POC OTT_FINALS_MODE; do
  cp "${TMP_DIR}/demo.env" "${TMP_DIR}/${public_flag}.env"
  chmod 0600 "${TMP_DIR}/${public_flag}.env"
  printf '%s=true\n' "${public_flag}" >> "${TMP_DIR}/${public_flag}.env"
  sed "s|^OTT_DEMO_ENV_FILE=.*|OTT_DEMO_ENV_FILE=${TMP_DIR}/${public_flag}.env|" "${TMP_DIR}/cron.env" > "${TMP_DIR}/${public_flag}.cron.env"
  chmod 0600 "${TMP_DIR}/${public_flag}.cron.env"
  if bash "${INSTALLER}" install "${TMP_DIR}/${public_flag}.cron.env" > "${TMP_DIR}/${public_flag}.out" 2>&1; then
    printf 'FAIL: installer must reject %s=true\n' "${public_flag}" >&2
    exit 1
  fi
  ! rg -q 'OTT DEMO SNAPSHOT RESET' "${DEMO_TEST_CRONTAB_FILE}"
done
printf 'PASS: installer rejects public, hosted and finals modes without changing crontab\n'

for config_override in \
  "OTT_DEMO_SNAPSHOT_BUNDLE=${TMP_DIR}/missing-bundle" \
  'OTT_DEMO_RESET_CRON=5 * * * *' \
  'OTT_DEMO_PROJECT=public-stack' \
  'OTT_DEMO_PROJECT=ott-demo' \
  'OTT_DEMO_TEAM_PASSWORD=not-the-stable-password'; do
  key="${config_override%%=*}"
  value="${config_override#*=}"
  if [[ "${key}" == OTT_DEMO_TEAM_PASSWORD ]]; then
    cp "${TMP_DIR}/demo.env" "${TMP_DIR}/wrong-password.env"
    chmod 0600 "${TMP_DIR}/wrong-password.env"
    printf '%s=%s\n' "${key}" "${value}" >> "${TMP_DIR}/wrong-password.env"
    sed "s|^OTT_DEMO_ENV_FILE=.*|OTT_DEMO_ENV_FILE=${TMP_DIR}/wrong-password.env|" "${TMP_DIR}/cron.env" > "${TMP_DIR}/invalid.cron.env"
  else
    sed "s|^${key}=.*|${key}=${value}|" "${TMP_DIR}/cron.env" > "${TMP_DIR}/invalid.cron.env"
  fi
  chmod 0600 "${TMP_DIR}/invalid.cron.env"
  if bash "${INSTALLER}" install "${TMP_DIR}/invalid.cron.env" > "${TMP_DIR}/invalid.out" 2>&1; then
    printf 'FAIL: installer must reject invalid %s\n' "${key}" >&2
    exit 1
  fi
  ! rg -q 'OTT DEMO SNAPSHOT RESET' "${DEMO_TEST_CRONTAB_FILE}"
done

ln -s "${TMP_DIR}/cron.env" "${TMP_DIR}/cron-symlink.env"
if bash "${INSTALLER}" install "${TMP_DIR}/cron-symlink.env" > "${TMP_DIR}/symlink.out" 2>&1; then
  printf 'FAIL: installer must reject a symlink config path\n' >&2
  exit 1
fi
! rg -q 'OTT DEMO SNAPSHOT RESET' "${DEMO_TEST_CRONTAB_FILE}"
printf 'PASS: installer rejects invalid paths/config and symlink config without changing crontab\n'

printf 'Demo reset cron tests passed.\n'
