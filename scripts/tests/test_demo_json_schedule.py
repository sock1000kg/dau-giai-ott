"""Tests for the schedule and immutable rule-set recovery helpers."""

import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "lib" / "demo_json.py"
SPEC = importlib.util.spec_from_file_location("demo_json", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
demo_json = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(demo_json)


class DemoJsonScheduleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)

    def test_relative_schedule_has_a_future_submission_deadline(self) -> None:
        schedule = demo_json.compute_relative_schedule(self.now)
        opens = datetime.fromisoformat(schedule["submissionOpensAt"].replace("Z", "+00:00"))
        deadline = datetime.fromisoformat(schedule["submissionDeadlineAt"].replace("Z", "+00:00"))
        grace = datetime.fromisoformat(schedule["graceEndsAt"].replace("Z", "+00:00"))

        self.assertLess(opens, self.now)
        self.assertLess(self.now, deadline)
        self.assertLess(deadline, grace)
        self.assertEqual(schedule["runStartsAt"], schedule["graceEndsAt"])
        self.assertEqual(
            demo_json.ruleset_window_state({"schedule": schedule}, self.now), "open"
        )

    def test_ruleset_refresh_changes_only_schedule_and_preserves_policy(self) -> None:
        original_rules = {
            "schemaVersion": "ott.round-rules.v1",
            "engineVersion": "2.1.0",
            "mapSet": [{"mapId": "m1", "checksum": "abc"}],
            "testRun": {"quotaPerTeamPerDay": 5, "opponents": ["OWN_SUBMISSION", "BTC_REFERENCE"]},
            "schedule": {"submissionDeadlineAt": "2020-01-01T00:00:00Z"},
        }
        payload = demo_json.build_ruleset_refresh_payload(
            {"data": {"id": "old", "rules": original_rules}}, "QUALIFICATION", self.now
        )

        self.assertEqual(payload["rules"]["engineVersion"], "2.1.0")
        self.assertEqual(payload["rules"]["mapSet"], original_rules["mapSet"])
        self.assertEqual(payload["rules"]["testRun"], original_rules["testRun"])
        self.assertEqual(payload["rules"]["schedule"], demo_json.compute_relative_schedule(self.now))
        self.assertIsNot(payload["rules"], original_rules)
        self.assertEqual(demo_json.ruleset_window_state(payload["rules"], self.now), "open")

    def test_ruleset_refresh_fails_closed_without_rules_object(self) -> None:
        with self.assertRaises(ValueError):
            demo_json.build_ruleset_refresh_payload({"data": {"rules": []}}, "QUALIFICATION")

    def test_window_state_fails_closed_on_timezone_free_schedule(self) -> None:
        rules = {
            "schedule": {
                "submissionOpensAt": "2026-10-25T11:00:00",
                "submissionDeadlineAt": "2026-10-25T13:00:00Z",
                "graceEndsAt": "2026-10-25T14:00:00Z",
            }
        }
        with self.assertRaises(ValueError):
            demo_json.ruleset_window_state(rules, self.now)


if __name__ == "__main__":
    unittest.main()
