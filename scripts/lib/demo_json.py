#!/usr/bin/env python3
"""scripts/lib/demo_json.py

JSON helper CLI for scripts/demo.sh (P2-T36).
Provides safe JSON parsing, payload generation, and formatting for BTC operator controls.
All input data is accepted via stdin or explicit file paths to prevent shell interpolation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import socket
import sys
from typing import Any


def load_input(filepath: str | None = None) -> Any:
    """Load JSON from specified file or stdin."""
    if filepath and filepath != "-":
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return json.load(sys.stdin)


def cmd_error(args: argparse.Namespace) -> int:
    """Format and print API error response to stderr."""
    status = args.status
    if getattr(args, "file", None) and args.file != "-":
        with open(args.file, "r", encoding="utf-8") as f:
            raw_text = f.read()
    else:
        raw_text = sys.stdin.read()
    if not raw_text.strip():
        sys.stderr.write(f"API error {status}: <empty response body>\n")
        return 1

    try:
        data = json.loads(raw_text)
    except Exception:
        sys.stderr.write(f"API error {status}: {raw_text.strip()}\n")
        return 1

    err = data.get("error") if isinstance(data, dict) else None
    if not isinstance(err, dict):
        sys.stderr.write(f"API error {status}: {json.dumps(data)}\n")
        return 1

    code = err.get("code", "UNKNOWN_ERROR")
    message = err.get("message", "")
    sys.stderr.write(f"API error {status} {code}: {message}\n")

    details = err.get("details")
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict) and "path" in item and "code" in item:
                sys.stderr.write(f"  - {item['path']}: {item['code']}\n")
            else:
                sys.stderr.write(f"  - {item}\n")
    elif isinstance(details, dict):
        for k, v in details.items():
            sys.stderr.write(f"  - {k}: {v}\n")
    elif details is not None:
        sys.stderr.write(f"  - {details}\n")

    return 1


def cmd_field(args: argparse.Namespace) -> int:
    """Extract a dotted or indexed path from JSON."""
    try:
        obj = load_input(args.file)
    except Exception as e:
        sys.stderr.write(f"Error reading JSON for field {args.path}: {e}\n")
        return 3

    parts = args.path.split(".")
    curr = obj
    for part in parts:
        if isinstance(curr, dict):
            if part in curr:
                curr = curr[part]
            else:
                return 3
        elif isinstance(curr, list):
            try:
                idx = int(part)
                curr = curr[idx]
            except (ValueError, IndexError):
                return 3
        else:
            return 3

    if curr is None:
        return 3

    if isinstance(curr, (dict, list)):
        print(json.dumps(curr))
    elif isinstance(curr, bool):
        print("true" if curr else "false")
    else:
        print(str(curr))
    return 0


def cmd_login_body(_args: argparse.Namespace) -> int:
    """Emit JSON login payload from DEMO_USER and DEMO_PASS environment variables."""
    user = os.environ.get("DEMO_USER", "")
    pw = os.environ.get("DEMO_PASS", "")
    if not user:
        sys.stderr.write("Error: DEMO_USER environment variable is required\n")
        return 1
    sys.stdout.write(json.dumps({"username": user, "password": pw}))
    return 0


def compute_relative_schedule() -> dict[str, Any]:
    """Compute relative schedule dates matching types.ts constraints."""
    now = datetime.now(timezone.utc)
    t_opens = now - timedelta(hours=2)
    t_deadline = now - timedelta(hours=1)
    t_grace = now - timedelta(minutes=5)
    t_run_starts = now
    t_appeal = now + timedelta(days=2)

    def fmt(dt: datetime) -> str:
        return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    return {
        "submissionOpensAt": fmt(t_opens),
        "submissionDeadlineAt": fmt(t_deadline),
        "graceEndsAt": fmt(t_grace),
        "runStartsAt": fmt(t_run_starts),
        "runMaxHours": 24,
        "appealEndsAt": fmt(t_appeal),
    }


def cmd_schedule(_args: argparse.Namespace) -> int:
    """Print relative schedule JSON object."""
    print(json.dumps(compute_relative_schedule(), indent=2))
    return 0


def cmd_catalog_ruleset(args: argparse.Namespace) -> int:
    """Construct a full round-rule-set creation payload from catalog JSON."""
    try:
        cat_data = load_input(args.file)
    except Exception as e:
        sys.stderr.write(f"Error reading catalog JSON: {e}\n")
        return 1

    cat = cat_data.get("data", {}) if isinstance(cat_data, dict) else {}
    maps = cat.get("maps", [])
    if not maps or not isinstance(maps, list):
        sys.stderr.write("Error: No maps found in catalog response\n")
        return 1

    map_entry = maps[0]
    map_id = map_entry.get("mapId", "default")
    map_checksum = map_entry.get("checksum", "")

    engine_versions = cat.get("engineVersions", ["1.0.0"])
    engine_ver = engine_versions[0] if engine_versions else "1.0.0"

    fault_policy_versions = cat.get("faultPolicyVersions", ["P2_BASELINE_V1"])
    fault_policy = fault_policy_versions[0] if fault_policy_versions else "P2_BASELINE_V1"

    schedule = compute_relative_schedule()

    payload = {
        "tournamentStage": args.stage,
        "reason": f"Default demo rule set from catalog for stage {args.stage}",
        "rules": {
            "schemaVersion": "ott.round-rules.v1",
            "engineVersion": engine_ver,
            "mapSet": [{"mapId": map_id, "checksum": map_checksum}],
            "maxTurns": 200,
            "faultPolicyVersion": fault_policy,
            "timeControl": {
                "startupMs": 5000,
                "totalBotBudgetMs": 60000,
                "matchWallClockMs": 120000,
                "perTurn": {"mode": "FIXED", "fixedMs": 200},
            },
            "resources": {
                "memoryMiB": 256,
                "milliCpu": 1000,
                "pids": 32,
                "tmpfsMiB": 64,
                "archiveMiB": 32,
                "unpackedMiB": 128,
                "maxLayers": 16,
            },
            "schedule": schedule,
            "testRun": {
                "quotaPerTeamPerDay": 5,
                "opponents": ["OWN_SUBMISSION", "BTC_REFERENCE"],
            },
        },
    }

    print(json.dumps(payload))
    return 0


def cmd_round_find(args: argparse.Namespace) -> int:
    """Find round matching criteria from rounds list JSON."""
    try:
        data = load_input(args.file)
    except Exception as e:
        sys.stderr.write(f"Error reading rounds JSON: {e}\n")
        return 1

    items = data.get("data", {}).get("items", []) if isinstance(data, dict) else []
    if not isinstance(items, list):
        return 1

    action = args.action
    for r in items:
        if not isinstance(r, dict):
            continue
        status = r.get("status")
        rid = r.get("id")
        ruleset_id = r.get("ruleSetId") or ""
        if action == "open" and status == "SUBMISSION_OPEN":
            print(rid)
            return 0
        if action == "close" and status in ("SUBMISSION_OPEN", "SUBMISSION_CLOSED"):
            print(f"{rid}:{status}:{ruleset_id}")
            return 0
        if action == "any" and rid:
            print(f"{rid}:{status}:{ruleset_id}")
            return 0

    return 1


def cmd_inflight_check(args: argparse.Namespace) -> int:
    """Fail-closed check for active rounds in read model."""
    try:
        data = load_input(args.file)
        if not isinstance(data, dict):
            raise ValueError("Root element is not a JSON object")
        items = data.get("data", {}).get("items")
        if not isinstance(items, list):
            raise ValueError("data.items is not a list")
    except Exception as e:
        sys.stderr.write(f"In-flight guard failed to parse rounds: {e}\n")
        return 2

    blocking: list[str] = []
    for r in items:
        if not isinstance(r, dict):
            continue
        status = r.get("status")
        paused = r.get("pausedAt")
        rid = r.get("id", "")
        rnum = r.get("roundNumber", "?")
        if paused is not None:
            blocking.append(f"round #{rnum} ({rid}) is PAUSED")
        elif status in ("RUNNING", "SETTLING"):
            blocking.append(f"round #{rnum} ({rid}) is {status}")

    if blocking:
        print("; ".join(blocking))
        return 1

    return 0


def cmd_round_status(args: argparse.Namespace) -> int:
    """Format and print round and series status."""
    stage = args.stage
    try:
        rounds_data = load_input(args.rounds)
    except Exception as e:
        sys.stderr.write(f"Error reading rounds: {e}\n")
        return 1

    items = rounds_data.get("data", {}).get("items", []) if isinstance(rounds_data, dict) else []

    print(f"=== Tournament Stage: {stage} ===")
    if not items:
        print("No qualification rounds found.")
    else:
        for r in items:
            rnum = r.get("roundNumber")
            rid = r.get("id")
            st = r.get("status")
            rsid = r.get("ruleSetId") or "none"
            created = r.get("createdAt")
            print(f"Round #{rnum} (ID: {rid})")
            print(f"  Status:     {st}")
            print(f"  RuleSet ID: {rsid}")
            print(f"  Created:    {created}")

    print("")
    print("=== Series & Matches ===")
    if args.series:
        try:
            series_data = load_input(args.series)
            s_items = series_data.get("data", {}).get("items", []) if isinstance(series_data, dict) else []
            if not s_items:
                print("No series scheduled or completed yet.")
            else:
                for s in s_items:
                    team_a = s.get("teams", {}).get("a", {}).get("name", "Team A")
                    team_b = s.get("teams", {}).get("b", {}).get("name", "Team B")
                    score_a = s.get("score", {}).get("a")
                    score_b = s.get("score", {}).get("b")
                    score_str = f"{score_a}:{score_b}" if score_a is not None and score_b is not None else "pending"
                    status = s.get("status", "UNKNOWN")
                    sid = s.get("seriesId", "")
                    print(f"Series {sid}: {team_a} vs {team_b} [{status}] Score: {score_str}")
        except Exception as e:
            sys.stderr.write(f"Error reading series: {e}\n")
            return 1
    else:
        print("No series scheduled or completed yet.")

    return 0


def cmd_round_results(args: argparse.Namespace) -> int:
    """Format and print leaderboard and series results."""
    stage = args.stage
    print(f"=== Tournament Leaderboard: {stage} ===")
    if args.leaderboard:
        try:
            lb_data = load_input(args.leaderboard)
            data_obj = lb_data.get("data", {}) if isinstance(lb_data, dict) else {}
            items = data_obj.get("items") or data_obj.get("entries") or []
            if not items:
                print("No rated teams on leaderboard yet.")
            else:
                print(f"{'RANK':<6} {'TEAM':<24} {'RATING':<8} {'SERIES':<8}")
                print("-" * 48)
                for entry in items:
                    rank = entry.get("rank", "-")
                    team = entry.get("team")
                    if isinstance(team, dict):
                        team_name = team.get("name", "Unknown")
                    else:
                        team_name = entry.get("teamName", "Unknown")
                    rating = entry.get("rating", 1500)
                    series_count = entry.get("ratedSeries", 0)
                    print(f"{str(rank):<6} {str(team_name):<24} {str(rating):<8} {str(series_count):<8}")
        except Exception as e:
            sys.stderr.write(f"Error reading leaderboard: {e}\n")
            return 1
    else:
        print("No rated teams on leaderboard yet.")

    print("")
    print("=== Series Results ===")
    if args.series:
        try:
            series_data = load_input(args.series)
            s_items = series_data.get("data", {}).get("items", []) if isinstance(series_data, dict) else []
            if not s_items:
                print("No series matches recorded yet.")
            else:
                for s in s_items:
                    team_a = s.get("teams", {}).get("a", {}).get("name", "Team A")
                    team_b = s.get("teams", {}).get("b", {}).get("name", "Team B")
                    score_a = s.get("score", {}).get("a")
                    score_b = s.get("score", {}).get("b")
                    score_str = f"{score_a}:{score_b}" if score_a is not None and score_b is not None else "pending"
                    status = s.get("status", "UNKNOWN")
                    sid = s.get("seriesId", "")
                    print(f"Series {sid}: {team_a} vs {team_b} [{status}] Score: {score_str}")
        except Exception as e:
            sys.stderr.write(f"Error reading series: {e}\n")
            return 1
    else:
        print("No series matches recorded yet.")

    return 0


def cmd_check_port(args: argparse.Namespace) -> int:
    """Check if TCP port is free on 0.0.0.0."""
    port = int(args.port)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("0.0.0.0", port))
        s.close()
        return 0
    except Exception:
        return 1


def cmd_find_port(args: argparse.Namespace) -> int:
    """Find and print an unused loopback port from the fixed demo range 18181..18380.

    Ephemeral ports (49152+) are not publishable on Docker Desktop/WSL2, so a fixed
    low range is scanned instead.
    """
    avoid = {int(p) for p in args.avoid if p.isdigit()}
    for p in range(18181, 18381):
        if p in avoid:
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", p))
                print(p)
                return 0
        except OSError:
            continue
    print("no free port in 18181..18380", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo script JSON helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # error
    p_err = subparsers.add_parser("error")
    p_err.add_argument("status", type=str, help="HTTP status code")
    p_err.add_argument("file", nargs="?", default=None, help="Input error JSON file (defaults to stdin)")
    p_err.set_defaults(func=cmd_error)

    # field
    p_field = subparsers.add_parser("field")
    p_field.add_argument("path", type=str, help="Dotted or indexed key path")
    p_field.add_argument("file", nargs="?", default=None, help="Input file (defaults to stdin)")
    p_field.set_defaults(func=cmd_field)

    # login-body
    p_login = subparsers.add_parser("login-body")
    p_login.set_defaults(func=cmd_login_body)

    # schedule
    p_sched = subparsers.add_parser("schedule")
    p_sched.set_defaults(func=cmd_schedule)

    # catalog-ruleset
    p_cat = subparsers.add_parser("catalog-ruleset")
    p_cat.add_argument("--stage", default="QUALIFICATION", help="Tournament stage")
    p_cat.add_argument("file", nargs="?", default=None, help="Input catalog file (defaults to stdin)")
    p_cat.set_defaults(func=cmd_catalog_ruleset)

    # round-find
    p_find = subparsers.add_parser("round-find")
    p_find.add_argument("--action", choices=["open", "close", "any"], default="any", help="Search criteria")
    p_find.add_argument("file", nargs="?", default=None, help="Input rounds file (defaults to stdin)")
    p_find.set_defaults(func=cmd_round_find)

    # inflight-check
    p_inflight = subparsers.add_parser("inflight-check")
    p_inflight.add_argument("file", nargs="?", default=None, help="Input rounds file (defaults to stdin)")
    p_inflight.set_defaults(func=cmd_inflight_check)

    # round-status
    p_status = subparsers.add_parser("round-status")
    p_status.add_argument("--stage", default="QUALIFICATION", help="Tournament stage")
    p_status.add_argument("--rounds", default=None, help="Rounds JSON file")
    p_status.add_argument("--series", default=None, help="Series JSON file")
    p_status.set_defaults(func=cmd_round_status)

    # round-results
    p_results = subparsers.add_parser("round-results")
    p_results.add_argument("--stage", default="QUALIFICATION", help="Tournament stage")
    p_results.add_argument("--leaderboard", default=None, help="Leaderboard JSON file")
    p_results.add_argument("--series", default=None, help="Series JSON file")
    p_results.set_defaults(func=cmd_round_results)

    # check-port
    p_cp = subparsers.add_parser("check-port")
    p_cp.add_argument("port", type=str, help="Port to check")
    p_cp.set_defaults(func=cmd_check_port)

    # find-port
    p_fp = subparsers.add_parser("find-port")
    p_fp.add_argument("avoid", nargs="*", default=[], help="Ports to avoid")
    p_fp.set_defaults(func=cmd_find_port)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
