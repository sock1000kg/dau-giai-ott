"""Regression tests for the round selectors used by scripts/demo.sh."""

import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "lib" / "demo_json.py"
SPEC = importlib.util.spec_from_file_location("demo_json", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
demo_json = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(demo_json)


class DemoJsonRoundTests(unittest.TestCase):
    def test_cancel_selector_returns_only_an_unstarted_round(self) -> None:
        payload = {
            "data": {"items": [
                {"id": "running", "status": "RUNNING"},
                {"id": "closed", "status": "SUBMISSION_CLOSED", "ruleSetId": "rules-2"},
            ]},
        }
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as file:
            json.dump(payload, file)
            file.flush()
            with contextlib.redirect_stdout(io.StringIO()) as output:
                result = demo_json.cmd_round_find(argparse.Namespace(file=file.name, action="cancel"))

        self.assertEqual(result, 0)
        self.assertEqual(output.getvalue().strip(), "closed:SUBMISSION_CLOSED:rules-2")

    def test_cancel_selector_returns_failure_when_round_has_started(self) -> None:
        payload = {"data": {"items": [{"id": "running", "status": "RUNNING"}]}}
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as file:
            json.dump(payload, file)
            file.flush()
            with contextlib.redirect_stdout(io.StringIO()):
                result = demo_json.cmd_round_find(argparse.Namespace(file=file.name, action="cancel"))

        self.assertEqual(result, 1)

if __name__ == "__main__":
    unittest.main()
