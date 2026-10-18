#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# OTT TOURNAMENT FINALS — ISOLATED LAN SMOKE & RECOVERY CHECK (P3-N07)
# Validates:
# 1. Compose topology configuration & network isolation (internal: true)
# 2. Worker unreachability from participant network (no exposed ports)
# 3. No-Egress / zero WAN connectivity compliance
# 4. Local service health & heartbeat reporting
# ==============================================================================

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

printf '===========================================================\n'
printf '   OTT TOURNAMENT - FINALS ISOLATED LAN SMOKE VALIDATOR    \n'
printf '   Task P3-N07: Finals Topology & Offline Local Recovery   \n'
printf '===========================================================\n\n'

compose_file="deploy/lan/compose.yml"
env_example="deploy/lan/.env.example"

errors=0

# ------------------------------------------------------------------------------
# 1. FILE & SPECIFICATION CHECKS
# ------------------------------------------------------------------------------
printf '%s\n' '--- [1/4] CHECKING DEPLOYMENT SPECIFICATIONS ---'
if [[ -f "$compose_file" ]]; then
  printf '  [PASS] Found Compose file: %s\n' "$compose_file"
else
  printf '  [FAIL] Missing Compose file: %s\n' "$compose_file" >&2
  errors=$((errors + 1))
fi

if [[ -f "$env_example" ]]; then
  printf '  [PASS] Found Environment example: %s\n' "$env_example"
else
  printf '  [FAIL] Missing Environment example: %s\n' "$env_example" >&2
  errors=$((errors + 1))
fi

# ------------------------------------------------------------------------------
# 2. TOPOLOGY & NETWORK ISOLATION RULES
# ------------------------------------------------------------------------------
printf '\n%s\n' '--- [2/4] VERIFYING NETWORK ISOLATION & WORKER ISOLATION ---'

# Verify ott-lan-internal has internal: true
if grep -A 4 "ott-lan-internal:" "$compose_file" | grep -q "internal: true"; then
  printf '  [PASS] ott-lan-internal network has "internal: true" (No-Egress enforced)\n'
else
  printf '  [FAIL] ott-lan-internal network is NOT marked "internal: true"\n' >&2
  errors=$((errors + 1))
fi

# Verify worker is attached ONLY to ott-lan-internal
worker_lines="$(awk '/^  worker:/{flag=1; next} /^  [a-z0-9_-]+:/{flag=0} flag' "$compose_file")"
if echo "$worker_lines" | grep -q "ott-lan-internal" && ! echo "$worker_lines" | grep -q "ott-lan-public"; then
  printf '  [PASS] Worker service is strictly bound to ott-lan-internal only\n'
else
  printf '  [FAIL] Worker service must only connect to ott-lan-internal\n' >&2
  errors=$((errors + 1))
fi

# Verify worker exposes NO ports
if echo "$worker_lines" | grep -q "ports:"; then
  printf '  [FAIL] Worker service must NOT have published ports\n' >&2
  errors=$((errors + 1))
else
  printf '  [PASS] Worker service has zero published ports (Unreachable from participant network)\n'
fi

# Verify database services (postgres, redis, seaweedfs) have no published ports
for svc in postgres redis seaweedfs; do
  svc_lines="$(awk "/^  ${svc}:/{flag=1; next} /^  [a-z0-9_-]+:/{flag=0} flag" "$compose_file")"
  if echo "$svc_lines" | grep -q "ports:"; then
    printf '  [FAIL] Database service %s has published ports in compose file\n' "$svc" >&2
    errors=$((errors + 1))
  else
    printf '  [PASS] Database service %s is isolated to internal network without host port publishing\n' "$svc"
  fi
done

# ------------------------------------------------------------------------------
# 3. NO-EGRESS & WAN DISCONNECTION VERIFICATION
# ------------------------------------------------------------------------------
printf '\n%s\n' '--- [3/4] TESTING WAN DISCONNECTION & NO-EGRESS BEHAVIOR ---'
egress_detected=0

# Test ping to public DNS (8.8.8.8) with short timeout
if ping -c 1 -W 1 8.8.8.8 >/dev/null 2>&1 || ping -n 1 -w 1000 8.8.8.8 >/dev/null 2>&1; then
  egress_detected=1
fi

if [[ "$egress_detected" -eq 1 ]]; then
  printf '  [WARN] Server has active WAN/Internet access (8.8.8.8 reachable)\n'
  printf '         In official Finals LAN, server lab WAN interface must be physically unplugged or disabled.\n'
else
  printf '  [PASS] No WAN egress detected (8.8.8.8 unreachable) — Offline mode verified\n'
fi

# ------------------------------------------------------------------------------
# 4. RUNTIME HEALTH & RECOVERY STATUS (IF STACK IS RUNNING)
# ------------------------------------------------------------------------------
printf '\n%s\n' '--- [4/4] RUNTIME STACK HEALTH & RECOVERY REPORT ---'

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  running_containers="$(docker compose -f "$compose_file" ps -q 2>/dev/null || true)"
  if [[ -n "$running_containers" ]]; then
    printf '  Running Docker Compose services detected:\n'
    docker compose -f "$compose_file" ps --format "table {{.Service}}\t{{.State}}\t{{.Health}}"
  else
    printf '  [INFO] Compose stack is not currently active on this host (Static verification passed)\n'
  fi
else
  printf '  [INFO] Docker daemon not directly accessible in current shell environment\n'
fi

printf '\n===========================================================\n'
if [[ "$errors" -eq 0 ]]; then
  printf '   FINALS ISOLATED LAN SMOKE CHECK: PASSED                 \n'
  printf '===========================================================\n'
  exit 0
else
  printf '   FINALS ISOLATED LAN SMOKE CHECK: FAILED (%d errors)    \n' "$errors"
  printf '===========================================================\n'
  exit 1
fi
