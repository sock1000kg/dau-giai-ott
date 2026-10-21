#!/usr/bin/env python3
"""Load a real two-team qualification demo through the application API."""

import argparse
import csv
import hashlib
import http.client
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


def request(base, path, method="GET", payload=None, cookie=None, headers=None):
    target = urlsplit(base)
    if target.scheme != "http" or target.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("Seeder only accepts a loopback HTTP gateway")
    connection = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=90)
    fields = dict(headers or {})
    if cookie:
        fields["Cookie"] = cookie
    body = payload
    if isinstance(payload, dict):
        body = json.dumps(payload).encode()
        fields["Content-Type"] = "application/json"
    try:
        connection.request(method, path, body=body, headers=fields)
        response = connection.getresponse()
        raw = response.read()
        if response.status >= 400:
            # API errors are useful, but never include submitted credentials or archive bytes.
            raise RuntimeError(f"{method} {path}: HTTP {response.status}: {raw[:300].decode(errors='replace')}")
        data = json.loads(raw) if raw else {}
        return data, response.getheader("Set-Cookie")
    finally:
        connection.close()


def login(base, account):
    _, set_cookie = request(base, "/api/v1/auth/login", "POST", {
        "username": account["username"], "password": account["password"]
    })
    cookie = (set_cookie or "").split(";", 1)[0]
    if not cookie.startswith("ott_session="):
        raise RuntimeError(f"No session cookie for {account['username']}")
    return cookie


def data(response):
    result = response.get("data")
    if result is None:
        raise RuntimeError("API response has no data")
    return result


def wait_for_submission(base, cookie, submission_id):
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        rows = data(request(base, "/api/v1/submissions", cookie=cookie)[0])
        row = next((item for item in rows if item.get("id") == submission_id), None)
        status = row.get("status") if row else None
        if status == "ACTIVE":
            return
        if status in ("INVALID", "SUPERSEDED", "REVOKED"):
            raise RuntimeError(f"Submission {submission_id} stopped at {status}")
        time.sleep(3)
    raise RuntimeError(f"Submission {submission_id} did not become ACTIVE")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--accounts", type=Path, default=ROOT / ".local/demo/accounts.csv")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".local/demo/demo.env")
    parser.add_argument("--sample", type=Path, default=ROOT / "samples/qualification-demo.json")
    args = parser.parse_args()

    env = dict(line.split("=", 1) for line in args.env_file.read_text().splitlines() if "=" in line)
    if env.get("OTT_DEMO_MODE") != "true" or env.get("OTT_DEPLOYMENT_MODE") != "dev":
        raise RuntimeError("Seeder requires an existing dev demo stack")
    with args.accounts.open(newline="") as stream:
        accounts = {row["username"]: row for row in csv.DictReader(stream)}
    sample = json.loads(args.sample.read_text())
    teams = sample["teams"]
    if len(teams) != 2 or sample["stage"] != "QUALIFICATION":
        raise RuntimeError("Sample must contain exactly two qualification teams")
    for team in teams:
        if team["username"] not in accounts or not (ROOT / team["botArchive"]).is_file():
            raise RuntimeError(f"Missing account or bot archive for {team['username']}")
    if "btc" not in accounts:
        raise RuntimeError("Missing BTC account")
    ready, _ = request(args.base_url, "/api/v1/health/ready")
    if ready.get("status") != "ready":
        raise RuntimeError("Demo stack is not ready")
    btc = login(args.base_url, accounts["btc"])
    existing = data(request(args.base_url, "/api/v1/admin/rounds?tournamentStage=QUALIFICATION", cookie=btc)[0])
    if existing.get("items"):
        raise RuntimeError("Qualification rounds already exist; sample loader refuses to duplicate or replace them")

    catalog = data(request(args.base_url, "/api/v1/admin/rounds/catalog", cookie=btc)[0])
    map_entry = catalog["maps"][0]
    now = time.time()
    deadline = now + int(sample["submissionWindowSeconds"])
    grace = deadline + int(sample["graceSeconds"])
    iso = lambda stamp: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp))
    rules = {
        "schemaVersion": "ott.round-rules.v1",
        "engineVersion": catalog["engineVersions"][0],
        "mapSet": [{"mapId": map_entry["mapId"], "checksum": map_entry["checksum"]}],
        "maxTurns": 200,
        "faultPolicyVersion": catalog["faultPolicyVersions"][0],
        "timeControl": {"startupMs": 5000, "totalBotBudgetMs": 60000,
                        "matchWallClockMs": 120000, "perTurn": {"mode": "FIXED", "fixedMs": 200}},
        "resources": {"memoryMiB": 256, "milliCpu": 1000, "pids": 32, "tmpfsMiB": 64,
                      "archiveMiB": 32, "unpackedMiB": 128, "maxLayers": 16},
        "schedule": {"submissionOpensAt": iso(now - 3600), "submissionDeadlineAt": iso(deadline),
                     "graceEndsAt": iso(grace), "runStartsAt": iso(grace),
                     "runMaxHours": 24, "appealEndsAt": iso(now + 86400)},
        "testRun": {"quotaPerTeamPerDay": 5, "opponents": ["BTC_REFERENCE"]}
    }
    rule_id = data(request(args.base_url, "/api/v1/admin/round-rule-sets", "POST", {
        "tournamentStage": "QUALIFICATION", "reason": "Sample qualification data", "rules": rules
    }, btc)[0])["id"]
    round_id = data(request(args.base_url, "/api/v1/admin/rounds", "POST", {
        "tournamentStage": "QUALIFICATION", "reason": "Sample qualification data"
    }, btc)[0])["id"]
    request(args.base_url, f"/api/v1/admin/rounds/{round_id}/open", "POST",
            {"ruleSetId": rule_id, "reason": "Open sample submissions"}, btc)
    print(f"Opened sample round {round_id}", flush=True)

    for team in teams:
        username = team["username"]
        cookie = login(args.base_url, accounts[username])
        archive = (ROOT / team["botArchive"]).read_bytes()
        digest = "sha256:" + hashlib.sha256(archive).hexdigest()
        reservation = data(request(args.base_url, "/api/v1/submission-reservations", "POST",
                                   {"archiveSha256": digest}, cookie)[0])["id"]
        submission = data(request(args.base_url, "/api/v1/submissions", "POST", archive, cookie,
                                  {"Content-Type": "application/octet-stream", "x-reservation-id": reservation})[0])["id"]
        wait_for_submission(args.base_url, cookie, submission)
        print(f"{username}: ACTIVE submission {submission}", flush=True)

    remaining = grace - time.time()
    if remaining > 0:
        time.sleep(remaining + 1)
    request(args.base_url, f"/api/v1/admin/rounds/{round_id}/close", "POST",
            {"reason": "Close sample submissions"}, btc)
    request(args.base_url, f"/api/v1/admin/rounds/{round_id}/start", "POST",
            {"ruleSetId": rule_id, "reason": "Run sample matches"}, btc,
            {"Idempotency-Key": f"sample-start-{round_id}"})
    print("Started sample matches", flush=True)
    end = time.monotonic() + 300
    while time.monotonic() < end:
        series = data(request(args.base_url, "/api/v1/results/series?stage=QUALIFICATION", cookie=btc)[0])
        leaderboard = data(request(args.base_url, "/api/v1/leaderboard?stage=QUALIFICATION")[0])
        items = series.get("items", [])
        count = len(leaderboard.get("items", []))
        if items and all(item["status"] == "FINALIZED" for item in items) and count >= 2:
            print(f"Done: {len(items)} finalized series, {count} leaderboard teams", flush=True)
            return
        time.sleep(3)
    raise RuntimeError("Timed out waiting for final results; inspect demo.sh round status")


if __name__ == "__main__":
    try:
        main()
    except (OSError, KeyError, ValueError, RuntimeError) as exc:
        print(f"Sample load failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
