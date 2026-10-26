#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null || realpath -e "${SCRIPT_DIR}/..")"
COMPOSE_FILE="${OTT_DEMO_COMPOSE_FILE:-${REPO_ROOT}/infra/local/compose.yaml}"
COMPOSE_PROJECT="${OTT_DEMO_PROJECT:-ott-demo-reset}"
ENV_FILE="${OTT_DEMO_ENV_FILE:-${REPO_ROOT}/.local/demo/demo.env}"
ARCHIVE_IMAGE="${OTT_DEMO_ARCHIVE_IMAGE:-busybox:1.36.1}"
OBJECT_STAGING_DIR=""

fail() { printf 'demo-restore-snapshot: %s\n' "$1" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: scripts/demo-restore-snapshot.sh <bundle-path> [--yes]

Restore a verified demo baseline bundle. This replaces PostgreSQL, S3 objects
and public snapshots for one ott-demo Compose project, clears Redis and resets
team01-team04 passwords. Use only on opted-in dev/test demo deployments.
EOF
}
read_env_value() {
  local key="$1" value
  value="${!key:-}"
  if [[ -n "${value}" ]]; then printf '%s' "${value}"; return; fi
  [[ -f "${ENV_FILE}" ]] || return 0
  awk -F= -v wanted="${key}" '$1 == wanted { sub(/^[^=]*=/, ""); sub(/\r$/, ""); value=$0 } END { printf "%s", value }' "${ENV_FILE}"
}
compose() { docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"; }
volume_by_label() {
  local expected_key="$1" volume project key
  local -a candidates=()
  mapfile -t candidates < <(docker volume ls -q \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.volume=${expected_key}")
  [[ "${#candidates[@]}" == 1 ]] || fail "expected exactly one ${expected_key} volume in Compose project ${COMPOSE_PROJECT}"
  volume="${candidates[0]}"
  project="$(docker volume inspect -f '{{ index .Labels "com.docker.compose.project" }}' "${volume}")"
  key="$(docker volume inspect -f '{{ index .Labels "com.docker.compose.volume" }}' "${volume}")"
  [[ "${project}" == "${COMPOSE_PROJECT}" && "${key}" == "${expected_key}" ]] || fail "refusing to replace a volume outside the expected Compose project"
  printf '%s' "${volume}"
}
replace_volume() {
  local volume="$1" key="$2"
  docker volume rm "${volume}" >/dev/null
  docker volume create --label "com.docker.compose.project=${COMPOSE_PROJECT}" --label "com.docker.compose.volume=${key}" "${volume}" >/dev/null
}
restore_volume() {
  local archive="$1" volume="$2"
  docker run --rm -i --network none --volume "${volume}:/data" "${ARCHIVE_IMAGE}" tar -xzf - -C /data < "${archive}"
}
cleanup() {
  if [[ -n "${OBJECT_STAGING_DIR}" && -d "${OBJECT_STAGING_DIR}" && "${OBJECT_STAGING_DIR}" == /tmp/ott-demo-objects.* ]]; then
    rm -rf -- "${OBJECT_STAGING_DIR}"
  fi
}
trap cleanup EXIT

[[ $# -ge 1 ]] || { usage >&2; exit 2; }
if [[ "$1" == --help || "$1" == -h ]]; then usage; exit 0; fi
bundle="$1"
shift
assume_yes=0
if [[ $# -gt 0 ]]; then
  [[ $# == 1 && "$1" == --yes ]] || { usage >&2; exit 2; }
  assume_yes=1
fi

[[ "${COMPOSE_PROJECT}" =~ ^ott-demo[a-z0-9-]*$ ]] || fail "invalid demo Compose project"
[[ "${COMPOSE_PROJECT}" != ott-demo ]] || fail "snapshot restore requires an isolated Compose project, not the public ott-demo project"
[[ -f "${COMPOSE_FILE}" && -f "${ENV_FILE}" ]] || fail "demo Compose file or env file is missing"
[[ "$(read_env_value OTT_DEMO_SNAPSHOT_RESTORE_ENABLED)" == true ]] || fail "OTT_DEMO_SNAPSHOT_RESTORE_ENABLED must be true"
[[ "$(read_env_value OTT_DEMO_MODE)" == true ]] || fail "OTT_DEMO_MODE must be true"
deployment_mode="$(read_env_value OTT_DEPLOYMENT_MODE)"
public_mode="$(read_env_value DEMO_PUBLIC)"
[[ "${deployment_mode}" == dev || "${deployment_mode}" == test ]] || fail "only dev/test deployment mode is allowed"
[[ "${public_mode}" != true && "$(read_env_value OTT_DEMO_PUBLIC)" != true && "$(read_env_value OTT_HOSTED_POC)" != true && "$(read_env_value OTT_FINALS_MODE)" != true ]] || fail "snapshot restore refused in public/hosted/finals mode"
[[ "$(read_env_value APP_BIND)" == 127.0.0.1 ]] || fail "isolated demo restore requires APP_BIND=127.0.0.1"
[[ "$(read_env_value OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES)" == "team01,team02,team03,team04" ]] || fail "password reset allowlist must be exactly team01,team02,team03,team04"
[[ "${bundle}" == /* ]] || fail "bundle path must be absolute"

"${REPO_ROOT}/scripts/demo-snapshot.sh" verify "${bundle}"
docker image inspect "${ARCHIVE_IMAGE}" >/dev/null 2>&1 || fail "archive helper image ${ARCHIVE_IMAGE} must already be available locally"
command -v flock >/dev/null 2>&1 || fail "flock is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

lock_file="${ENV_FILE}.restore.lock"
mkdir -p -m 0700 "$(dirname "${lock_file}")"
exec 9>"${lock_file}"
flock -n 9 || fail "another demo restore operation is running"

scheduler_container="$(compose ps -q demo-password-reset-scheduler)"
[[ -z "${scheduler_container}" ]] || fail "disable the container password scheduler before enabling full snapshot restore"
seaweed_volume="$(volume_by_label seaweedfs-data)"
snapshot_volume="$(volume_by_label snapshots)"
database_name="$(read_env_value POSTGRES_DB)"
database_user="$(read_env_value POSTGRES_USER)"
[[ "${database_name}" =~ ^[A-Za-z0-9_.-]+$ && "${database_user}" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "PostgreSQL database/user configuration is missing or invalid"
accounts_host_dir="$(read_env_value OTT_DEMO_ACCOUNTS_DIR)"
[[ -n "${accounts_host_dir}" ]] || accounts_host_dir="${REPO_ROOT}/.local/demo"
[[ "${accounts_host_dir}" == /* ]] || fail "OTT_DEMO_ACCOUNTS_DIR must be absolute for snapshot restore"
mkdir -p -m 0700 "${accounts_host_dir}"
reset_accounts_csv="${accounts_host_dir}/reset-credentials.csv"
[[ ! -L "${reset_accounts_csv}" ]] || fail "reset credentials CSV must not be a symlink"
team_password="$(read_env_value OTT_DEMO_TEAM_PASSWORD)"
[[ -n "${team_password}" ]] || team_password="ABC123"
python3 - "${REPO_ROOT}/demo/team-accounts.csv" "${reset_accounts_csv}" "${team_password}" <<'PY'
import csv, os, pathlib, sys, tempfile
source_path, target_path, expected_password = sys.argv[1:]
allowed = {"team01", "team02", "team03", "team04"}
with open(source_path, newline="", encoding="utf-8") as source:
    rows = [row for row in csv.DictReader(source) if row.get("username") in allowed]
if {row.get("username") for row in rows} != allowed or any(row.get("role") != "TEAM_ACCOUNT" or row.get("password") != expected_password for row in rows):
    raise SystemExit("demo-restore-snapshot: public team accounts do not match the reset allowlist/default")
target = pathlib.Path(target_path)
fd, temporary = tempfile.mkstemp(prefix=".reset-credentials.", dir=target.parent)
try:
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=["username", "password", "role", "team"])
        writer.writeheader()
        writer.writerows(rows)
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY

if (( assume_yes == 0 )); then
  [[ -t 0 ]] || fail "non-interactive restore requires --yes"
  printf "This replaces all demo data for '%s'. Type the project name to continue: " "${COMPOSE_PROJECT}"
  read -r confirmation
  [[ "${confirmation}" == "${COMPOSE_PROJECT}" ]] || fail "confirmation did not match"
fi

printf 'Stopping the demo stack before restore.\n'
compose down --remove-orphans
replace_volume "${seaweed_volume}" seaweedfs-data
replace_volume "${snapshot_volume}" snapshots

printf 'Starting fresh database and object storage services.\n'
compose up -d --wait postgres redis seaweedfs
compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"'
compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "${bundle}/data/database.dump"
restore_volume "${bundle}/data/snapshots.tar.gz" "${snapshot_volume}"
compose exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli FLUSHALL' >/dev/null

OBJECT_STAGING_DIR="$(mktemp -d /tmp/ott-demo-objects.XXXXXX)"
chmod 0700 "${OBJECT_STAGING_DIR}"
python3 - "${bundle}/data/seaweedfs-objects.tar.gz" "${OBJECT_STAGING_DIR}" <<'PY'
import pathlib, re, sys, tarfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
with tarfile.open(archive, "r:gz") as source:
    for member in source.getmembers():
        name = member.name.removeprefix("./")
        if name in ("", ".", "objects") and member.isdir():
            continue
        if name == "manifest.json" and member.isfile():
            output = root / "manifest.json"
        elif re.fullmatch(r"objects/[0-9a-f]{64}\.blob", name) and member.isfile():
            output = root / name
        else:
            raise SystemExit("demo-restore-snapshot: object archive contains an unsafe entry")
        source_file = source.extractfile(member)
        if source_file is None:
            raise SystemExit("demo-restore-snapshot: object archive payload is unreadable")
        output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        output.write_bytes(source_file.read())
        output.chmod(0o600)
PY

printf 'Restoring and verifying S3 objects from the baseline.\n'
# The host staging directory and payloads stay root-only; this one-shot importer
# runs as container root solely to read that private read-only mount.
compose run --rm --no-deps -T \
  --user 0:0 \
  --volume "${REPO_ROOT}/scripts/demo-snapshot-objects.mjs:/app/src/platform/api/src/demo/demo-snapshot-objects.mjs:ro" \
  --volume "${OBJECT_STAGING_DIR}:/backup:ro" \
  --entrypoint node api /app/src/platform/api/src/demo/demo-snapshot-objects.mjs import /backup

printf 'Applying database migrations before application writers start.\n'
compose run --rm --no-deps migrate

printf 'Resetting team credentials while application writers remain stopped.\n'
compose --profile demo-password-reset run --rm --no-deps \
  -e OTT_DEMO_PASSWORD_RESET_ENABLED=true \
  -e OTT_DEMO_MODE=true \
  -e OTT_DEPLOYMENT_MODE=dev \
  -e DEMO_PUBLIC=false \
  -e OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES=team01,team02,team03,team04 \
  -e OTT_DEMO_ACCOUNTS_DIR=/demo \
  -e OTT_DEMO_ACCOUNTS_CSV=/demo/reset-credentials.csv \
  --entrypoint npm demo-password-reset-scheduler run demo:reset-passwords --workspace @ott/platform-api

metrics_query="SELECT json_build_object('teams',(SELECT count(*) FROM teams),'accounts',(SELECT count(*) FROM accounts),'demo_accounts',(SELECT count(*) FROM accounts WHERE username IN ('btc','team01','team02','team03','team04')),'matches',(SELECT count(*) FROM matches),'replays',(SELECT count(*) FROM replay_publications),'resultBundleKeys',(SELECT count(*) FROM result_bundle_keys WHERE revoked_at IS NULL),'verifiedResultBundles',(SELECT count(*) FROM result_bundles WHERE status = 'VERIFIED'),'resultBundleArtifacts',(SELECT count(*) FROM result_bundle_artifacts))::text"
restored_metrics="$(compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "${metrics_query}")"
python3 - "${bundle}/manifest.json" "${restored_metrics}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    expected = json.load(source)["metrics"]
actual = json.loads(sys.argv[2])
for key in ("teams", "accounts", "demo_accounts", "matches", "replays", "resultBundleKeys", "verifiedResultBundles", "resultBundleArtifacts"):
    if expected.get(key) != actual.get(key):
        raise SystemExit(f"demo-restore-snapshot: restored database invariant failed for {key}")
if actual.get("demo_accounts") != 5 or actual.get("matches", 0) < 1 or actual.get("replays", 0) < 1:
    raise SystemExit("demo-restore-snapshot: required demo accounts/match/replay history is absent")
for key in ("resultBundleKeys", "verifiedResultBundles", "resultBundleArtifacts"):
    if not isinstance(expected.get(key), int) or expected[key] < 1 or actual.get(key, 0) < 1:
        raise SystemExit(f"demo-restore-snapshot: required finals ResultBundle data is absent ({key})")
PY

printf 'Starting the demo application after restore invariants pass.\n'
compose up -d --wait
port="$(read_env_value APP_PORT)"
[[ "${port}" =~ ^[0-9]{1,5}$ ]] || fail "APP_PORT is missing or invalid"
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${port}/api/v1/health/ready" >/dev/null || fail "demo readiness check failed after restore"
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${port}/api/v1/public/finals/snapshot" >/dev/null || fail "public finals snapshot check failed after restore"
printf 'Demo snapshot restore completed and readiness is healthy.\n'
