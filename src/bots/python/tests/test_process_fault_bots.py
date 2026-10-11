import unittest
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# Thêm đường dẫn để hỗ trợ chạy trực tiếp file test hoặc qua unittest discover
_current_dir = Path(__file__).resolve().parent
_repo_root = _current_dir.parent.parent.parent.parent
for _p in [str(_current_dir.parent), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from src.bots.python.process_fault_bot import ProcessFaultBot, parse_args
except ModuleNotFoundError:
    from process_fault_bot import ProcessFaultBot, parse_args

class TestProcessFaultBots(unittest.TestCase):
    def setUp(self):
        self.sample_msg = {
            "type": "STATE_UPDATE",
            "protocolVersion": 1,
            "matchId": "m-fault-001",
            "turnId": 3,
            "state": {},
            "legalActions": [
                {"pieceId": "X-ROCK-1", "to": {"col": 2, "row": 3}}
            ]
        }

    def test_crash_mode(self):
        bot = ProcessFaultBot(mode="crash")
        with self.assertRaises(SystemExit) as cm:
            bot.on_state_update(self.sample_msg)
        self.assertEqual(cm.exception.code, 1)

    @patch("time.sleep")
    def test_timeout_mode(self, mock_sleep):
        bot = ProcessFaultBot(mode="timeout", delay=8.0)
        action = bot.on_state_update(self.sample_msg)
        mock_sleep.assert_called_once_with(8.0)
        self.assertIsNotNone(action)
        self.assertEqual(action["pieceId"], "X-ROCK-1")

    def test_oversized_mode(self):
        bot = ProcessFaultBot(mode="oversized", oversized_bytes=70000)
        stdout = io.StringIO()
        with patch("sys.stdout", stdout):
            result = bot.on_state_update(self.sample_msg)

        self.assertIsNone(result)
        output = stdout.getvalue().strip()
        # Đảm bảo độ dài byte/ký tự vượt giới hạn 65536 byte
        self.assertGreaterEqual(len(output.encode("utf-8")), 65536)
        parsed = json.loads(output)
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["matchId"], "m-fault-001")
        self.assertIn("padding", parsed)

    def test_unknown_mode(self):
        bot = ProcessFaultBot(mode="unknown")
        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            res = bot.on_state_update(self.sample_msg)
        self.assertIsNone(res)
        self.assertIn("Unknown mode", stderr.getvalue())

    def test_parse_args(self):
        with patch("sys.argv", ["process_fault_bot.py", "--mode=timeout", "--delay=15.5"]):
            args = parse_args()
            self.assertEqual(args["mode"], "timeout")
            self.assertEqual(args["delay"], 15.5)

        with patch("sys.argv", ["process_fault_bot.py", "crash"]):
            args = parse_args()
            self.assertEqual(args["mode"], "crash")

        with patch("sys.argv", ["process_fault_bot.py", "--mode=oversized", "--size=80000"]):
            args = parse_args()
            self.assertEqual(args["mode"], "oversized")
            self.assertEqual(args["oversized_bytes"], 80000)

if __name__ == "__main__":
    unittest.main()

