#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null || realpath -e "${SCRIPT_DIR}/..")"
COMPOSE_FILE="${OTT_DEMO_COMPOSE_FILE:-${REPO_ROOT}/infra/local/compose.yaml}"
COMPOSE_PROJECT="${OTT_DEMO_PROJECT:-ott-demo}"
ENV_FILE="${OTT_DEMO_ENV_FILE:-${REPO_ROOT}/.local/demo/demo.env}"
ARCHIVE_IMAGE="${OTT_DEMO_ARCHIVE_IMAGE:-busybox:1.36.1}"
STAGING_DIR=""
WRITERS_STOPPED=0

fail() { printf 'demo-snapshot: %s\n' "$1" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage:
  scripts/demo-snapshot.sh create <absolute-bundle-path>
  scripts/demo-snapshot.sh verify <bundle-path>

Create requires OTT_DEMO_SNAPSHOT_ENABLED=true, OTT_DEMO_MODE=true, a dev/test
deployment and a non-public demo. Bundles contain PostgreSQL, S3 objects and
public snapshots; they must be stored outside Git with root-only access.
EOF
}

read_env_value() {
  local key="$1"
  local environment_value="${!key:-}"
  if [[ -n "${environment_value}" ]]; then
    printf '%s' "${environment_value}"
    return
  fi
  [[ -f "${ENV_FILE}" ]] || return 0
  awk -F= -v wanted="${key}" '$1 == wanted { sub(/^[^=]*=/, ""); sub(/\r$/, ""); value=$0 } END { printf "%s", value }' "${ENV_FILE}"
}

compose() {
  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

verify_bundle() {
  local bundle="$1"
  [[ -d "${bundle}" && ! -L "${bundle}" ]] || fail "bundle directory is missing or is a symlink"
  [[ -f "${bundle}/manifest.json" && ! -L "${bundle}/manifest.json" ]] || fail "manifest.json is missing"
  [[ -f "${bundle}/checksums.sha256" && ! -L "${bundle}/checksums.sha256" ]] || fail "checksums.sha256 is missing"
  local payload
  for payload in database.dump seaweedfs-objects.tar.gz snapshots.tar.gz; do
    [[ -s "${bundle}/data/${payload}" && ! -L "${bundle}/data/${payload}" ]] || fail "required payload ${payload} is missing"
  done
  python3 - "${bundle}/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
expected = {"database.dump", "seaweedfs-objects.tar.gz", "snapshots.tar.gz"}
if manifest.get("format") != "ott-demo-snapshot-v2":
    raise SystemExit("demo-snapshot: unsupported or invalid manifest format")
if set(manifest.get("payloads", {})) != expected:
    raise SystemExit("demo-snapshot: manifest payload list does not match required bundle")
if not isinstance(manifest.get("metrics"), dict) or not isinstance(manifest.get("source"), dict):
    raise SystemExit("demo-snapshot: manifest metrics/source metadata is invalid")
metrics = manifest["metrics"]
for key in ("resultBundleKeys", "verifiedResultBundles", "resultBundleArtifacts"):
    value = metrics.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise SystemExit(f"demo-snapshot: baseline is missing required finals ResultBundle data ({key})")
PY
  (cd "${bundle}" && sha256sum --check --strict checksums.sha256 >/dev/null) || fail "bundle checksum verification failed"
  local entries
  entries="$(awk '{print $2}' "${bundle}/checksums.sha256" | sort | tr '\n' ' ')"
  [[ "${entries}" == "data/database.dump data/seaweedfs-objects.tar.gz data/snapshots.tar.gz " ]] || fail "checksum manifest contains unexpected paths"
  printf 'Verified demo snapshot bundle.\n'
}

cleanup() {
  local status=$?
  if (( WRITERS_STOPPED == 1 )); then
    compose up -d api worker coordinator >/dev/null 2>&1 || true
  fi
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" && "${STAGING_DIR}" == */.ott-demo-snapshot.* ]]; then
    rm -rf -- "${STAGING_DIR}"
  fi
  exit "${status}"
}
trap cleanup EXIT

create_bundle() {
  local target="$1"
  [[ "${target}" == /* ]] || fail "snapshot target must be an absolute path"
  [[ "${COMPOSE_PROJECT}" =~ ^ott-demo[a-z0-9-]*$ ]] || fail "invalid demo Compose project"
  [[ -f "${COMPOSE_FILE}" && -f "${ENV_FILE}" ]] || fail "demo Compose file or env file is missing"
  [[ ! -e "${target}" && ! -L "${target}" ]] || fail "snapshot target already exists; bundles are immutable"
  local resolved_repo resolved_target
  resolved_repo="$(realpath -e "${REPO_ROOT}")"
  mkdir -p -m 0700 "$(dirname "${target}")"
  resolved_target="$(realpath -m "${target}")"
  case "${resolved_target}" in
    "${resolved_repo}"/*)
      git -C "${REPO_ROOT}" check-ignore -q "${resolved_target}" || fail "snapshot target must be outside Git or under an ignored directory"
      ;;
  esac

  [[ "$(read_env_value OTT_DEMO_SNAPSHOT_ENABLED)" == true ]] || fail "OTT_DEMO_SNAPSHOT_ENABLED must be true"
  [[ "$(read_env_value OTT_DEMO_MODE)" == true ]] || fail "OTT_DEMO_MODE must be true"
  local deployment_mode public_mode
  deployment_mode="$(read_env_value OTT_DEPLOYMENT_MODE)"
  public_mode="$(read_env_value DEMO_PUBLIC)"
  [[ "${deployment_mode}" == dev || "${deployment_mode}" == test ]] || fail "only dev/test deployment mode is allowed"
  [[ "${public_mode}" != true && "$(read_env_value OTT_DEMO_PUBLIC)" != true ]] || fail "snapshot creation refused in public mode"
  command -v docker >/dev/null 2>&1 || fail "docker is required"
  command -v python3 >/dev/null 2>&1 || fail "python3 is required"
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
  command -v flock >/dev/null 2>&1 || fail "flock is required"
  docker image inspect "${ARCHIVE_IMAGE}" >/dev/null 2>&1 || fail "archive helper image ${ARCHIVE_IMAGE} must already be available locally"

  local lock_file="${ENV_FILE}.snapshot.lock"
  exec 9>"${lock_file}"
  flock -n 9 || fail "another demo snapshot operation is running"

  local parent container database_name database_user metrics storage_metrics
  parent="$(dirname "${resolved_target}")"
  STAGING_DIR="${parent}/.ott-demo-snapshot.$$.tmp"
  mkdir -m 0700 "${STAGING_DIR}"
  mkdir -m 0700 "${STAGING_DIR}/data"

  WRITERS_STOPPED=1
  compose stop api worker coordinator demo-password-reset-scheduler >/dev/null
  container="$(compose ps -q postgres)"
  [[ -n "${container}" ]] || fail "PostgreSQL service is not running"

  database_name="$(read_env_value POSTGRES_DB)"
  database_user="$(read_env_value POSTGRES_USER)"
  [[ -n "${database_name}" && -n "${database_user}" ]] || fail "PostgreSQL database/user configuration is missing"

  local metrics_query="SELECT json_build_object('teams',(SELECT count(*) FROM teams),'accounts',(SELECT count(*) FROM accounts),'demo_accounts',(SELECT count(*) FROM accounts WHERE username IN ('btc','team01','team02','team03','team04')),'matches',(SELECT count(*) FROM matches),'replays',(SELECT count(*) FROM replay_publications),'resultBundleKeys',(SELECT count(*) FROM result_bundle_keys WHERE revoked_at IS NULL),'verifiedResultBundles',(SELECT count(*) FROM result_bundles WHERE status = 'VERIFIED'),'resultBundleArtifacts',(SELECT count(*) FROM result_bundle_artifacts))::text"
  metrics="$(compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "${metrics_query}")"
  python3 - "${metrics}" <<'PY'
import json, sys
try:
    counts = json.loads(sys.argv[1])
except Exception as exc:
    raise SystemExit("demo-snapshot: could not read baseline database counts") from exc
if counts.get("demo_accounts", 0) != 5 or counts.get("matches", 0) < 1 or counts.get("replays", 0) < 1:
    raise SystemExit("demo-snapshot: baseline must contain btc, team01-team04 and historical match/replay data")
for key in ("resultBundleKeys", "verifiedResultBundles", "resultBundleArtifacts"):
    if not isinstance(counts.get(key), int) or counts[key] < 1:
        raise SystemExit(f"demo-snapshot: baseline is missing required finals ResultBundle data ({key})")
PY
  mkdir -m 0700 "${STAGING_DIR}/objects"
  # The exporter reads the private root-only staging mount; keep host files
  # private and elevate only this one-shot container process.
  storage_metrics="$(compose run --rm --no-deps -T \
    --user 0:0 \
    --volume "${REPO_ROOT}/scripts/demo-snapshot-objects.mjs:/app/src/platform/api/src/demo/demo-snapshot-objects.mjs:ro" \
    --volume "${STAGING_DIR}/objects:/backup" \
    --entrypoint node api /app/src/platform/api/src/demo/demo-snapshot-objects.mjs export /backup)"
  python3 - "${storage_metrics}" <<'PY'
import json, sys
try:
    result = json.loads(sys.argv[1])
except Exception as exc:
    raise SystemExit("demo-snapshot: could not verify exported S3 objects") from exc
if result.get("objectCount", 0) < 1 or result.get("referenceCount", 0) < 1:
    raise SystemExit("demo-snapshot: baseline must contain referenced S3 objects")
PY
  (cd "${STAGING_DIR}/objects" && tar -czf "${STAGING_DIR}/data/seaweedfs-objects.tar.gz" .)
  [[ -s "${STAGING_DIR}/data/seaweedfs-objects.tar.gz" ]] || fail "S3 object archive is empty"
  rm -rf -- "${STAGING_DIR}/objects"

  compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' > "${STAGING_DIR}/data/database.dump"
  [[ -s "${STAGING_DIR}/data/database.dump" ]] || fail "PostgreSQL dump is empty"

  local web_container
  web_container="$(compose ps -q web)"
  [[ -n "${web_container}" ]] || fail "web service must be running"
  local snapshot_volume volume_project volume_label
  snapshot_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/srv/snapshots"}}{{.Name}}{{end}}{{end}}' "${web_container}")"
  [[ -n "${snapshot_volume}" ]] || fail "could not resolve Compose volume snapshots"
  volume_project="$(docker volume inspect -f '{{ index .Labels "com.docker.compose.project" }}' "${snapshot_volume}")"
  volume_label="$(docker volume inspect -f '{{ index .Labels "com.docker.compose.volume" }}' "${snapshot_volume}")"
  [[ "${volume_project}" == "${COMPOSE_PROJECT}" && "${volume_label}" == "snapshots" ]] || fail "refusing to archive a volume outside the expected Compose project"
  docker run --rm --network none --volume "${snapshot_volume}:/data:ro" "${ARCHIVE_IMAGE}" tar -czf - -C /data . > "${STAGING_DIR}/data/snapshots.tar.gz"
  [[ -s "${STAGING_DIR}/data/snapshots.tar.gz" ]] || fail "public snapshot archive is empty"
  local snapshot_files
  snapshot_files="$(tar -tzf "${STAGING_DIR}/data/snapshots.tar.gz" | awk '$0 != "." && $0 != "./" { count++ } END { print count + 0 }')"
  (( snapshot_files > 0 )) || fail "public snapshots volume has no files"

  local commit
  commit="${OTT_RELEASE_SHA:-$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || printf unknown)}"
  python3 - "${metrics}" "${storage_metrics}" "${commit}" "${COMPOSE_PROJECT}" "${snapshot_files}" > "${STAGING_DIR}/manifest.json" <<'PY'
import json, sys
print(json.dumps({
    "format": "ott-demo-snapshot-v2",
    "source": {"commit": sys.argv[3], "composeProject": sys.argv[4]},
    "metrics": {**json.loads(sys.argv[1]), **json.loads(sys.argv[2]), "snapshotFiles": int(sys.argv[5])},
    "payloads": {
        "database.dump": {"kind": "postgresql-custom-dump"},
        "seaweedfs-objects.tar.gz": {"kind": "s3-object-export"},
        "snapshots.tar.gz": {"kind": "public-snapshots-volume"},
    },
}, sort_keys=True, indent=2))
PY
  chmod 0600 "${STAGING_DIR}/manifest.json" "${STAGING_DIR}/data/"*
  (cd "${STAGING_DIR}" && sha256sum data/database.dump data/seaweedfs-objects.tar.gz data/snapshots.tar.gz > checksums.sha256)
  chmod 0600 "${STAGING_DIR}/checksums.sha256"
  mv "${STAGING_DIR}" "${resolved_target}"
  STAGING_DIR=""
  WRITERS_STOPPED=0
  compose up -d api worker coordinator >/dev/null
  verify_bundle "${resolved_target}"
  printf 'Created demo snapshot bundle at %s\n' "${resolved_target}"
}

[[ $# -ge 1 ]] || { usage >&2; exit 2; }
command="$1"
shift
case "${command}" in
  create)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    create_bundle "$1"
    ;;
  verify)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    verify_bundle "$1"
    ;;
  --help|-h)
    usage
    ;;
  *) usage >&2; exit 2 ;;
esac
