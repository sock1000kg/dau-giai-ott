#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_SCRIPT="${REPO_ROOT}/scripts/demo.sh"
RESTORE_SCRIPT="${REPO_ROOT}/scripts/demo-restore-snapshot.sh"

if ! bash "${DEMO_SCRIPT}" restore-demo --help > /dev/null 2>&1; then
  printf 'FAIL: demo.sh exposes restore-demo help\n' >&2
  exit 1
fi
printf 'PASS: demo.sh exposes restore-demo help\n'

if ! bash "${RESTORE_SCRIPT}" --help > /dev/null 2>&1; then
  printf 'FAIL: restore command exposes help\n' >&2
  exit 1
fi
printf 'PASS: restore command exposes help\n'

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
touch "${TMP_DIR}/compose.yaml" "${TMP_DIR}/demo.env"
if OTT_DEMO_SNAPSHOT_RESTORE_ENABLED=true OTT_DEMO_MODE=true OTT_DEPLOYMENT_MODE=dev OTT_DEMO_PUBLIC=true OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES=team01,team02,team03,team04 OTT_DEMO_COMPOSE_FILE="${TMP_DIR}/compose.yaml" OTT_DEMO_ENV_FILE="${TMP_DIR}/demo.env" bash "${RESTORE_SCRIPT}" "${TMP_DIR}/bundle" --yes > "${TMP_DIR}/out" 2>&1; then
  printf 'FAIL: restore refuses public mode\n' >&2
  exit 1
fi
if ! rg -q 'public/hosted/finals' "${TMP_DIR}/out"; then
  printf 'FAIL: public restore refusal is explained\n' >&2
  exit 1
fi
printf 'PASS: restore refuses public mode\n'

if ! rg -q "resultBundleKeys.*verifiedResultBundles.*resultBundleArtifacts" "${RESTORE_SCRIPT}"; then
  printf 'FAIL: restore compares all finals ResultBundle metrics\n' >&2
  exit 1
fi
if ! rg -q '/api/v1/public/finals/snapshot' "${RESTORE_SCRIPT}"; then
  printf 'FAIL: restore probes the public finals snapshot after startup\n' >&2
  exit 1
fi
printf 'PASS: restore compares finals metrics and probes the public snapshot\n'

printf 'Snapshot restore guard tests passed.\n'
