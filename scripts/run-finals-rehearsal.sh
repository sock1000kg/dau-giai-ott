#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# OTT TOURNAMENT PLATFORM — FINALS EVENT REHEARSAL ORCHESTRATION (P3-N08)
# ==============================================================================
# Owner: Đỗ Khôi Nguyên (Owner lane P3-N* — Sandbox / Worker / Operations Readiness)
# Usage:
#   bash scripts/run-finals-rehearsal.sh
# ==============================================================================

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

printf '%s\n' "================================================================================"
printf '%s\n' "  OTT ARENA — FULL FINALS EVENT REHEARSAL & TAMPER/RECOVERY HARNESS (P3-N08)   "
printf '%s\n' "================================================================================"

# 1. Environment and toolchain verification
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" -lt 20 ]]; then
  printf '%s\n' "Error: Node.js 20+ required (detected Node.js $node_major)." >&2
  exit 1
fi
printf '[1/4] Node.js runtime verified: v%s\n' "$(node -p 'process.versions.node')"

# 2. Check contract and schema files existence
contracts=(
  "docs/contracts/finals-format-v1.md"
  "docs/contracts/finals-result-bundle-v1.md"
  "docs/contracts/finals-result-bundle-artifacts-v1.schema.json"
  "docs/contracts/finals-api-v1.md"
  "docs/runbooks/finals-lan.md"
  "docs/reports/finals-rehearsal.md"
)

for contract in "${contracts[@]}"; do
  if [[ ! -f "$contract" ]]; then
    printf 'Error: Required contract/runbook missing: %s\n' "$contract" >&2
    exit 1
  fi
done
printf '[2/4] Finals contracts and runbooks verified.\n'

# 3. Check vitest runner
if [[ ! -f "node_modules/.bin/vitest" && ! -f "node_modules/vitest/package.json" ]]; then
  printf 'Error: Vitest is not installed in node_modules. Run npm install first.\n' >&2
  exit 1
fi
printf '[3/4] Vitest test harness located.\n'

# 4. Execute Finals Rehearsal E2E test suite
printf '[4/4] Executing Finals E2E rehearsal test suite (tests/e2e/finals.test.ts)...\n'
npx vitest run --config tests/e2e/finals.config.ts

printf '\n%s\n' "================================================================================"
printf '%s\n' "  FINALS REHEARSAL PASSED — AC-09/20, TAMPER/RECOVERY, AND HANDOFF VERIFIED     "
printf '%s\n' "================================================================================"

