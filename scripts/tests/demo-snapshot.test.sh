#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SNAPSHOT_SCRIPT="${REPO_ROOT}/scripts/demo-snapshot.sh"
PUBLIC_ACCOUNTS="${REPO_ROOT}/demo/team-accounts.csv"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

if [[ ! -x "${SNAPSHOT_SCRIPT}" ]]; then fail "snapshot command exists and is executable"; fi
pass "snapshot command exists and is executable"

if ! python3 - "${PUBLIC_ACCOUNTS}" <<'PY'
import csv, re, sys
with open(sys.argv[1], newline="", encoding="utf-8") as source:
    rows = list(csv.DictReader(source))
assert len(rows) == 10
assert set(rows[0]) == {"username", "role", "team", "password"}
assert all(re.fullmatch(r"team[0-9]{2}", row["username"]) and row["role"] == "TEAM_ACCOUNT" and row["team"] and row["password"] for row in rows)
PY
then
  fail "public fixture contains the stable demo team test account list"
fi
pass "public fixture contains the stable demo team test account list"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
touch "${TMP_DIR}/compose.yaml" "${TMP_DIR}/demo.env"

if OTT_DEMO_SNAPSHOT_ENABLED=true OTT_DEMO_MODE=true OTT_DEPLOYMENT_MODE=dev OTT_DEMO_PUBLIC=true OTT_DEMO_COMPOSE_FILE="${TMP_DIR}/compose.yaml" OTT_DEMO_ENV_FILE="${TMP_DIR}/demo.env" bash "${SNAPSHOT_SCRIPT}" create "${TMP_DIR}/snapshot" >"${TMP_DIR}/out" 2>&1; then
  fail "snapshot creation refuses public mode"
fi
if ! rg -q 'refused|refuse|public' "${TMP_DIR}/out"; then fail "public-mode refusal is explained"; fi
pass "snapshot creation refuses public mode"

if bash "${SNAPSHOT_SCRIPT}" verify "${TMP_DIR}/missing" >"${TMP_DIR}/out" 2>&1; then
  fail "verification refuses missing bundles"
fi
pass "verification refuses missing bundles"

mkdir -p "${TMP_DIR}/valid/data"
printf 'dump\n' > "${TMP_DIR}/valid/data/database.dump"
mkdir "${TMP_DIR}/objects" "${TMP_DIR}/snapshots"
printf 'replay-object\n' > "${TMP_DIR}/objects/replay.blob"
printf 'public-snapshot\n' > "${TMP_DIR}/snapshots/latest.json"
tar -czf "${TMP_DIR}/valid/data/seaweedfs-objects.tar.gz" -C "${TMP_DIR}/objects" .
tar -czf "${TMP_DIR}/valid/data/snapshots.tar.gz" -C "${TMP_DIR}/snapshots" .
write_manifest() {
  python3 - "${TMP_DIR}/valid/manifest.json" "$@" <<'PY'
import json, sys
path, *metrics = sys.argv[1:]
with open(path, "w", encoding="utf-8") as output:
    json.dump({"format":"ott-demo-snapshot-v2", "source":{"commit":"fixture","composeProject":"ott-demo-test"}, "metrics":dict(zip(("teams", "accounts", "demo_accounts", "matches", "replays", "resultBundleKeys", "verifiedResultBundles", "resultBundleArtifacts"), map(int, metrics))), "payloads":{"database.dump":{}, "seaweedfs-objects.tar.gz":{}, "snapshots.tar.gz":{}}}, output)
PY
  (cd "${TMP_DIR}/valid" && sha256sum data/database.dump data/seaweedfs-objects.tar.gz data/snapshots.tar.gz > checksums.sha256)
}

write_manifest 8 11 5 7 7 0 0 0
if bash "${SNAPSHOT_SCRIPT}" verify "${TMP_DIR}/valid" >"${TMP_DIR}/out" 2>&1; then
  fail "verification rejects a checksum-valid baseline without finals data"
fi
if ! rg -q 'finals|ResultBundle' "${TMP_DIR}/out"; then fail "missing finals data is explained"; fi
pass "verification rejects a checksum-valid baseline without finals data"

write_manifest 8 11 5 7 7 1 1 1
if ! bash "${SNAPSHOT_SCRIPT}" verify "${TMP_DIR}/valid" >"${TMP_DIR}/out" 2>&1; then
  fail "verification accepts intact snapshot bundle ($(tr '\n' ' ' < "${TMP_DIR}/out"))"
fi
pass "verification accepts intact snapshot bundle"

printf 'tampered\n' >> "${TMP_DIR}/valid/data/database.dump"
if bash "${SNAPSHOT_SCRIPT}" verify "${TMP_DIR}/valid" >"${TMP_DIR}/out" 2>&1; then
  fail "verification refuses a modified payload"
fi
pass "verification refuses a modified payload"

printf 'Snapshot guard tests passed.\n'
