#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  printf '%s\n' 'Qualification harness requires Node.js 22.' >&2
  exit 1
fi
command -v docker >/dev/null || { printf '%s\n' 'Qualification harness requires Docker Engine.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
[[ -x node_modules/.bin/tsx ]] || { printf '%s\n' 'Missing local tsx dependency; run npm install first.' >&2; exit 1; }
[[ -x node_modules/.bin/vitest ]] || { printf '%s\n' 'Missing local Vitest dependency; run npm install first.' >&2; exit 1; }

# Validate corpus/profile before allocating any Docker resources.
./node_modules/.bin/tsx tests/e2e/qualification-run.ts preflight

qualification_namespace="$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
qualification_project="ott-qualification-${qualification_namespace}"
qualification_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ott-qualification.XXXXXXXX")"
qualification_env_file="${qualification_tmp_dir}/compose.env"
qualification_compose_file="${repo_root}/infra/local/compose.yaml"
qualification_compose_args=(compose --project-name "$qualification_project" --env-file "$qualification_env_file" -f "$qualification_compose_file")

postgres_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
redis_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
s3_secret="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"

export OTT_E2E_NAMESPACE="$qualification_namespace"
export OTT_E2E_BTC_USERNAME="qualification-btc-${qualification_namespace}"
export OTT_E2E_BTC_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
export OTT_E2E_TEAM_X_USERNAME="qualification-x-${qualification_namespace}"
export OTT_E2E_TEAM_X_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
export OTT_E2E_TEAM_O_USERNAME="qualification-o-${qualification_namespace}"
export OTT_E2E_TEAM_O_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
export S3_ACCESS_KEY_ID="ottqualification"
export S3_SECRET_ACCESS_KEY="$s3_secret"
export S3_BUCKET="ottq-${qualification_namespace}"

cleanup() {
  local run_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM
  set +e

  if [[ "$qualification_project" =~ ^ott-qualification-[a-f0-9]{32}$ && -f "$qualification_env_file" ]]; then
    docker "${qualification_compose_args[@]}" down --volumes --remove-orphans --timeout 10 >/dev/null || cleanup_status=$?
    local remaining_containers
    remaining_containers="$(docker "${qualification_compose_args[@]}" ps --all --quiet 2>/dev/null)" || cleanup_status=$?
    if [[ -n "$remaining_containers" ]]; then
      printf 'Qualification containers remain in project %s.\n' "$qualification_project" >&2
      cleanup_status=1
    fi
    local remaining_volumes
    remaining_volumes="$(docker volume ls --quiet --filter "label=com.docker.compose.project=${qualification_project}" 2>/dev/null)" || cleanup_status=$?
    if [[ -n "$remaining_volumes" ]]; then
      printf 'Qualification volumes remain in project %s.\n' "$qualification_project" >&2
      cleanup_status=1
    fi
  fi

  rm -f -- "$qualification_env_file"
  rmdir -- "$qualification_tmp_dir" 2>/dev/null || cleanup_status=$?
  if [[ "$run_status" -eq 0 && "$cleanup_status" -ne 0 ]]; then run_status=1; fi
  if [[ "$cleanup_status" -ne 0 ]]; then printf 'Qualification teardown failed for %s.\n' "$qualification_project" >&2; fi
  exit "$run_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
{
  printf 'POSTGRES_DB=ottq%s\n' "$qualification_namespace"
  printf 'POSTGRES_USER=ottqualification\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  printf 'POSTGRES_PORT=0\n'
  printf 'REDIS_PASSWORD=%s\n' "$redis_password"
  printf 'REDIS_PORT=0\n'
  printf 'S3_ACCESS_KEY_ID=%s\n' "$S3_ACCESS_KEY_ID"
  printf 'S3_SECRET_ACCESS_KEY=%s\n' "$S3_SECRET_ACCESS_KEY"
  printf 'S3_BUCKET=%s\n' "$S3_BUCKET"
  printf 'S3_API_PORT=0\n'
} > "$qualification_env_file"

docker "${qualification_compose_args[@]}" up --detach --wait
postgres_port="$(docker "${qualification_compose_args[@]}" port postgres 5432 | ./node_modules/.bin/tsx --eval 'import { parsePublishedPort } from "./tests/e2e/helpers.ts"; let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(String(parsePublishedPort(input))));')"
redis_port="$(docker "${qualification_compose_args[@]}" port redis 6379 | ./node_modules/.bin/tsx --eval 'import { parsePublishedPort } from "./tests/e2e/helpers.ts"; let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(String(parsePublishedPort(input))));')"
s3_port="$(docker "${qualification_compose_args[@]}" port seaweedfs 8333 | ./node_modules/.bin/tsx --eval 'import { parsePublishedPort } from "./tests/e2e/helpers.ts"; let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => process.stdout.write(String(parsePublishedPort(input))));')"

export DATABASE_URL="postgresql://ottqualification:${postgres_password}@127.0.0.1:${postgres_port}/ottq${qualification_namespace}"
export REDIS_URL="redis://:${redis_password}@127.0.0.1:${redis_port}/0"
export S3_ENDPOINT="http://127.0.0.1:${s3_port}"

npm run db:migrate
./node_modules/.bin/tsx tests/e2e/qualification-run.ts seed

vitest_args=()
for argument in "$@"; do
  if [[ "$argument" == "--runInBand" ]]; then
    vitest_args+=(--no-file-parallelism)
  else
    vitest_args+=("$argument")
  fi
done
./node_modules/.bin/vitest run --config tests/e2e/qualification.config.ts "${vitest_args[@]}"
