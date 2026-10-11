import unittest
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

# Thêm đường dẫn để hỗ trợ chạy trực tiếp file test hoặc qua unittest discover
_current_dir = Path(__file__).resolve().parent
_repo_root = _current_dir.parent.parent.parent.parent
for _p in [str(_current_dir.parent), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from src.bots.python.invalid_bot import InvalidBot, parse_mode
except ModuleNotFoundError:
    from invalid_bot import InvalidBot, parse_mode

class TestInvalidBots(unittest.TestCase):
    def test_malformed_mode(self):
        bot = InvalidBot(mode="malformed")
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "m-1",
            "turnId": 1,
            "state": {},
            "legalActions": []
        }
        stdout = io.StringIO()
        with patch("sys.stdout", stdout):
            bot.on_state_update(msg)

        output = stdout.getvalue().strip()
        self.assertTrue(len(output) > 0)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(output)

    def test_illegal_mode(self):
        bot = InvalidBot(mode="illegal")
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "m-1",
            "turnId": 1,
            "state": {},
            "legalActions": [
                {"pieceId": "X-ROCK-1", "to": {"col": 1, "row": 1}}
            ]
        }
        stdout = io.StringIO()
        with patch("sys.stdout", stdout):
            bot.on_state_update(msg)

        output = stdout.getvalue().strip()
        parsed = json.loads(output)
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["turnId"], 1)
        self.assertEqual(parsed["action"]["pieceId"], "NON_EXISTENT_PIECE")

    def test_stale_mode(self):
        bot = InvalidBot(mode="stale")
        # Trường hợp turnId > 1
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "m-1",
            "turnId": 5,
            "state": {},
            "legalActions": [
                {"pieceId": "X-ROCK-1", "to": {"col": 1, "row": 1}}
            ]
        }
        stdout = io.StringIO()
        with patch("sys.stdout", stdout):
            bot.on_state_update(msg)

        output = stdout.getvalue().strip()
        parsed = json.loads(output)
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["turnId"], 4)  # stale turnId
        self.assertEqual(parsed["action"]["pieceId"], "X-ROCK-1")

        # Trường hợp turnId == 1
        msg["turnId"] = 1
        stdout = io.StringIO()
        with patch("sys.stdout", stdout):
            bot.on_state_update(msg)

        output = stdout.getvalue().strip()
        parsed = json.loads(output)
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["turnId"], 101)  # stale turnId != 1

    def test_parse_mode_argv(self):
        with patch("sys.argv", ["invalid_bot.py", "--mode=illegal"]):
            self.assertEqual(parse_mode(), "illegal")

        with patch("sys.argv", ["invalid_bot.py", "stale"]):
            self.assertEqual(parse_mode(), "stale")

        with patch("sys.argv", ["invalid_bot.py"]):
            self.assertEqual(parse_mode(), "malformed")

if __name__ == "__main__":
    unittest.main()

