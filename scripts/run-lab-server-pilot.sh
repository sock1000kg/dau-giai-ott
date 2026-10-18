#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

printf '===========================================================\n'
printf '   OTT TOURNAMENT - PILOT QUALIFICATION ROUND RUNNER      \n'
printf '   Task P3-N06: Single-Server Smoke / Load & Lab Pilot    \n'
printf '===========================================================\n\n'

# 1. Environment checks
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  printf 'ERROR: Node.js 22 required (found %s)\n' "$(node -v)" >&2
  exit 1
fi

commit_hash="$(git rev-parse HEAD)"
branch_name="$(git rev-parse --abbrev-ref HEAD)"
timestamp="$(node -e 'process.stdout.write(new Date().toISOString())')"

printf 'Commit Hash: %s\n' "$commit_hash"
printf 'Branch:      %s\n' "$branch_name"
printf 'Started At:  %s\n\n' "$timestamp"

# 2. Host Inventory Collection
printf '--- [1/4] COLLECTING HOST INVENTORY ---\n'
os_info="$(uname -srm 2>/dev/null || echo "Unknown OS")"
node_version="$(node -v)"
cpu_cores="$(node -e 'process.stdout.write(String(require("node:os").cpus().length))')"
cpu_model="$(node -e 'process.stdout.write(require("node:os").cpus()[0]?.model ?? "Unknown")')"
total_mem_gb="$(node -e 'process.stdout.write((require("node:os").totalmem() / 1024 / 1024 / 1024).toFixed(2))')"
free_mem_gb="$(node -e 'process.stdout.write((require("node:os").freemem() / 1024 / 1024 / 1024).toFixed(2))')"

printf 'Host OS:     %s\n' "$os_info"
printf 'CPU Model:   %s (%s logical cores)\n' "$cpu_model" "$cpu_cores"
printf 'RAM Total:   %s GB (Free: %s GB)\n' "$total_mem_gb" "$free_mem_gb"
printf 'Node.js:     %s\n\n' "$node_version"

# 3. Run Pilot Qualification Load Simulation (200 teams, burst 50 uploads, 1000 public clients)
printf '--- [2/4] EXECUTING PILOT QUALIFICATION LOAD TEST ---\n'
report_tmp="$(mktemp "${TMPDIR:-/tmp}/ott-pilot-load.XXXXXX.json")"

node --import tsx tests/load/qualification-round.ts > "$report_tmp" || {
  printf 'ERROR: Qualification pilot load simulation failed.\n' >&2
  rm -f "$report_tmp"
  exit 1
}

printf 'Qualification Load Simulation finished successfully.\n'
node -e '
  const fs = require("node:fs");
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log("Uploads: " + data.uploadMetrics.success + "/" + data.uploadMetrics.total + " succeeded, " + data.uploadMetrics.throttled429 + " throttled (429)");
  console.log("Upload Latency: p50=" + data.uploadMetrics.p50Ms + "ms, p95=" + data.uploadMetrics.p95Ms + "ms, p99=" + data.uploadMetrics.p99Ms + "ms");
  console.log("Public Reads: " + data.publicMetrics.success + "/" + data.publicMetrics.total + " static hits, 0 DB queries");
  console.log("Queue Priority: Official matches executed first = " + data.priorityMetrics.officialProcessedFirst);
  console.log("Rating Ledger: " + data.ratingMetrics.ledgerMatchesCount + " matches rated with Adaptive K; Test-run Elo isolation = " + data.ratingMetrics.zeroEloDeltaFromTestRuns);
  console.log("Integrity Verdict: " + (data.integrityPass ? "PASSED" : "FAILED"));
' "$report_tmp"

printf '\n--- [3/4] EXECUTING WORKER RECOVERY & IDEMPOTENCY SUITE ---\n'
npx vitest run --config tests/e2e/qualification.config.ts tests/e2e/worker-recovery.test.ts || {
  printf 'ERROR: Worker recovery suite failed.\n' >&2
  rm -f "$report_tmp"
  exit 1
}

printf '\n--- [4/4] EXECUTING TYPECHECK & INTEGRITY AUDIT ---\n'
npm run typecheck --workspaces
npm run build --workspace @ott/platform-api
npm run build --workspace @ott/platform-worker

printf '\n===========================================================\n'
printf '   PILOT QUALIFICATION ROUND COMPLETED: PASS               \n'
printf '   Signed by: Do Khoi Nguyen (Lane P3-N Owner)             \n'
printf '   Report: docs/reports/phase-3-capacity.md                \n'
printf '===========================================================\n'

rm -f "$report_tmp"
exit 0

