#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_PATH="$(realpath -e "${BASH_SOURCE[0]}")"
BEGIN_MARKER="# BEGIN OTT DEMO SNAPSHOT RESET"
END_MARKER="# END OTT DEMO SNAPSHOT RESET"
CONFIG_KEYS=(REPO_ROOT OTT_DEMO_PROJECT OTT_DEMO_ENV_FILE OTT_DEMO_COMPOSE_FILE OTT_DEMO_SNAPSHOT_BUNDLE OTT_DEMO_RESET_LOG OTT_DEMO_RESET_CRON OTT_DEMO_RESET_TIMEZONE)

fail() { printf 'demo-reset-cron: %s\n' "$1" >&2; exit 1; }
usage() {
  cat <<EOF
Usage:
  scripts/install-demo-reset-cron.sh install <private-config>
  scripts/install-demo-reset-cron.sh status
  scripts/install-demo-reset-cron.sh run-now <private-config>
  scripts/install-demo-reset-cron.sh uninstall

Install manages one marker block in the current OS user's crontab.
EOF
}

read_file_value() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  awk -F= -v wanted="${key}" '$1 == wanted { sub(/^[^=]*=/, ""); sub(/\r$/, ""); value=$0 } END { printf "%s", value }' "${file}"
}

load_config() {
  local config_file="$1" line key value
  declare -gA CONFIG=()
  [[ -f "${config_file}" && ! -L "${config_file}" ]] || fail "config file is missing or a symlink"
  [[ "$(stat -c '%u:%a' "${config_file}")" == "$(id -u):600" ]] || fail "config file must be owned by the current user with mode 0600"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || fail "invalid config line"
    key="${line%%=*}"
    value="${line#*=}"
    [[ " ${CONFIG_KEYS[*]} " == *" ${key} "* ]] || fail "unknown config key ${key}"
    [[ -z "${CONFIG[${key}]+present}" ]] || fail "duplicate config key ${key}"
    [[ -n "${value}" && "${value}" != *$'\n'* && "${value}" != *$'\r'* ]] || fail "empty or invalid config value for ${key}"
    CONFIG["${key}"]="${value}"
  done < "${config_file}"
  local required
  for required in "${CONFIG_KEYS[@]}"; do [[ -n "${CONFIG[${required}]:-}" ]] || fail "missing config key ${required}"; done
  [[ "${CONFIG[OTT_DEMO_PROJECT]}" =~ ^ott-demo[a-z0-9-]*$ ]] || fail "invalid demo Compose project"
  [[ "${CONFIG[OTT_DEMO_PROJECT]}" != ott-demo ]] || fail "cron restore requires an isolated Compose project, not the public ott-demo project"
  for key in REPO_ROOT OTT_DEMO_ENV_FILE OTT_DEMO_COMPOSE_FILE OTT_DEMO_SNAPSHOT_BUNDLE OTT_DEMO_RESET_LOG; do
    [[ "${CONFIG[${key}]}" == /* && "${CONFIG[${key}]}" =~ ^/[A-Za-z0-9_./-]+$ ]] || fail "${key} must be an absolute path without whitespace or shell metacharacters"
  done
  [[ "${CONFIG[OTT_DEMO_RESET_CRON]}" == "0 * * * *" ]] || fail "the demo reset schedule must run once each hour at minute 0"
  [[ "${CONFIG[OTT_DEMO_RESET_TIMEZONE]}" == "Asia/Ho_Chi_Minh" ]] || fail "the demo reset timezone must be Asia/Ho_Chi_Minh"
  [[ -d "${CONFIG[REPO_ROOT]}" && -f "${CONFIG[REPO_ROOT]}/scripts/demo.sh" ]] || fail "REPO_ROOT does not contain scripts/demo.sh"
  [[ -f "${CONFIG[OTT_DEMO_COMPOSE_FILE]}" && -f "${CONFIG[OTT_DEMO_ENV_FILE]}" ]] || fail "Compose or demo env file is missing"
  [[ "$(stat -c '%u:%a' "${CONFIG[OTT_DEMO_ENV_FILE]}")" == "$(id -u):600" ]] || fail "demo env file must be owned by the current user with mode 0600"
  [[ "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" OTT_DEMO_MODE)" == true ]] || fail "demo env must set OTT_DEMO_MODE=true"
  [[ "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" OTT_DEPLOYMENT_MODE)" == dev ]] || fail "demo env must set OTT_DEPLOYMENT_MODE=dev"
  [[ "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" APP_BIND)" == 127.0.0.1 ]] || fail "isolated demo env must set APP_BIND=127.0.0.1"
  [[ "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" DEMO_PUBLIC)" != true ]] || fail "public demo mode must be disabled before installing reset cron"
  [[ "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" OTT_DEMO_PUBLIC)" != true ]] || fail "OTT_DEMO_PUBLIC must be disabled before installing reset cron"
  [[ "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" OTT_HOSTED_POC)" != true && "$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" OTT_FINALS_MODE)" != true ]] || fail "hosted/finals mode must be disabled before installing reset cron"
  local team_password
  team_password="$(read_file_value "${CONFIG[OTT_DEMO_ENV_FILE]}" OTT_DEMO_TEAM_PASSWORD)"
  [[ -n "${team_password}" ]] || team_password="ABC123"
  python3 - "${CONFIG[REPO_ROOT]}/demo/team-accounts.csv" "${team_password}" <<'PY'
import csv, sys
with open(sys.argv[1], newline="", encoding="utf-8") as source:
    rows = list(csv.DictReader(source))
if len(rows) != 10 or any(row.get("role") != "TEAM_ACCOUNT" or row.get("password") != sys.argv[2] for row in rows):
    raise SystemExit("demo-reset-cron: configured default does not match the stable public team-account test list")
PY
}

resolve_config_path() {
  local path="$1"
  [[ -n "${path}" && ! -L "${path}" ]] || fail "config file path must not be a symlink"
  realpath -e "${path}"
}

verify_runtime() {
  local project="$1" env_file="$2" compose_file="$3" bundle="$4" repo="$5"
  "${repo}/scripts/demo-snapshot.sh" verify "${bundle}" >/dev/null || fail "baseline bundle verification failed"
  local scheduler
  scheduler="$(docker compose -p "${project}" -f "${compose_file}" --env-file "${env_file}" ps -q demo-password-reset-scheduler)" || fail "could not inspect Compose scheduler state"
  [[ -z "${scheduler}" ]] || fail "disable the container password scheduler before installing OS restore cron"
}

render_cron_line() {
  local config_file="$1"
  printf '%s\n' "SHELL=/bin/bash" \
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "CRON_TZ=Asia/Ho_Chi_Minh" \
    "0 * * * * /usr/bin/flock -n '${CONFIG[OTT_DEMO_ENV_FILE]}.cron.lock' /usr/bin/timeout --signal=TERM --kill-after=30s 20m /bin/bash '${SCRIPT_PATH}' run '${config_file}'"
}

run_job() {
  local config_file="$1"
  load_config "${config_file}"
  local log_file="${CONFIG[OTT_DEMO_RESET_LOG]}" log_dir
  log_dir="$(dirname "${log_file}")"
  [[ ! -L "${log_dir}" ]] || fail "log directory is a symlink"
  mkdir -p "${log_dir}"
  chmod 0700 "${log_dir}"
  [[ "$(stat -c '%u' "${log_dir}")" == "$(id -u)" ]] || fail "log directory must be owned by the current user"
  [[ ! -L "${log_file}" ]] || fail "log path is a symlink"
  if [[ -f "${log_file}" && "$(stat -c '%s' "${log_file}")" -gt 10485760 ]]; then
    mv -f -- "${log_file}" "${log_file}.1"
  fi
  touch "${log_file}"
  chmod 0600 "${log_file}"
  exec >>"${log_file}" 2>&1
  printf 'Starting scheduled demo baseline restore at %s\n' "$(date -Is)"
  verify_runtime "${CONFIG[OTT_DEMO_PROJECT]}" "${CONFIG[OTT_DEMO_ENV_FILE]}" "${CONFIG[OTT_DEMO_COMPOSE_FILE]}" "${CONFIG[OTT_DEMO_SNAPSHOT_BUNDLE]}" "${CONFIG[REPO_ROOT]}"
  env \
    OTT_DEMO_PROJECT="${CONFIG[OTT_DEMO_PROJECT]}" \
    OTT_DEMO_ENV_FILE="${CONFIG[OTT_DEMO_ENV_FILE]}" \
    OTT_DEMO_COMPOSE_FILE="${CONFIG[OTT_DEMO_COMPOSE_FILE]}" \
    OTT_DEMO_SNAPSHOT_RESTORE_ENABLED=true \
    OTT_DEMO_MODE=true \
    OTT_DEPLOYMENT_MODE=dev \
    OTT_DEMO_PUBLIC=false \
    OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES=team01,team02,team03,team04 \
    "${CONFIG[REPO_ROOT]}/scripts/demo.sh" restore-demo "${CONFIG[OTT_DEMO_SNAPSHOT_BUNDLE]}" --yes
  printf 'Scheduled demo baseline restore finished at %s\n' "$(date -Is)"
}

command="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi
case "${command}" in
  install)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    config_file="$(resolve_config_path "$1")"
    load_config "${config_file}"
    verify_runtime "${CONFIG[OTT_DEMO_PROJECT]}" "${CONFIG[OTT_DEMO_ENV_FILE]}" "${CONFIG[OTT_DEMO_COMPOSE_FILE]}" "${CONFIG[OTT_DEMO_SNAPSHOT_BUNDLE]}" "${CONFIG[REPO_ROOT]}"
    current="$(crontab -l 2>/dev/null || true)"
    begin_count="$(printf '%s\n' "${current}" | rg -c -F "${BEGIN_MARKER}" || true)"
    end_count="$(printf '%s\n' "${current}" | rg -c -F "${END_MARKER}" || true)"
    [[ "${begin_count:-0}" == "${end_count:-0}" && "${begin_count:-0}" -le 1 ]] || fail "existing demo cron markers are unbalanced or duplicated"
    base="$(printf '%s\n' "${current}" | awk -v begin="${BEGIN_MARKER}" -v end="${END_MARKER}" '$0 == begin { skip=1; next } $0 == end { skip=0; next } !skip { print }')"
    {
      [[ -z "${base}" ]] || printf '%s\n' "${base}"
      printf '%s\n' "${BEGIN_MARKER}"
      render_cron_line "${config_file}"
      printf '%s\n' "${END_MARKER}"
    } | crontab -
    printf 'Installed hourly demo snapshot restore for project %s.\n' "${CONFIG[OTT_DEMO_PROJECT]}"
    ;;
  status)
    current="$(crontab -l 2>/dev/null || true)"
    if [[ "${current}" == *"${BEGIN_MARKER}"* && "${current}" == *"${END_MARKER}"* ]]; then
      printf 'Hourly demo snapshot restore is installed.\n'
      printf '%s\n' "${current}" | sed -n "/^${BEGIN_MARKER}$/,/^${END_MARKER}$/p" | rg '^[0-9*]' || true
    else
      printf 'Hourly demo snapshot restore is not installed.\n'
    fi
    ;;
  run-now)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    config_file="$(resolve_config_path "$1")"
    load_config "${config_file}"
    exec /usr/bin/flock -n "${CONFIG[OTT_DEMO_ENV_FILE]}.cron.lock" /usr/bin/timeout --signal=TERM --kill-after=30s 20m /bin/bash "${SCRIPT_PATH}" run "${config_file}"
    ;;
  run)
    [[ $# == 1 ]] || { usage >&2; exit 2; }
    run_job "$(resolve_config_path "$1")"
    ;;
  uninstall)
    [[ $# == 0 ]] || { usage >&2; exit 2; }
    current="$(crontab -l 2>/dev/null || true)"
    begin_count="$(printf '%s\n' "${current}" | rg -c -F "${BEGIN_MARKER}" || true)"
    end_count="$(printf '%s\n' "${current}" | rg -c -F "${END_MARKER}" || true)"
    [[ "${begin_count:-0}" == "${end_count:-0}" && "${begin_count:-0}" -le 1 ]] || fail "existing demo cron markers are unbalanced or duplicated"
    printf '%s\n' "${current}" | awk -v begin="${BEGIN_MARKER}" -v end="${END_MARKER}" '$0 == begin { skip=1; next } $0 == end { skip=0; next } !skip { print }' | crontab -
    printf 'Removed the managed demo snapshot restore block.\n'
    ;;
  --help|-h) usage ;;
  *) usage >&2; exit 2 ;;
esac
