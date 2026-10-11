import unittest
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

_current_dir = Path(__file__).resolve().parent
_repo_root = _current_dir.parent.parent.parent.parent
for _p in [str(_current_dir.parent), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from src.bots.python.first_legal_bot import FirstLegalBot
from src.bots.python.capture_first_bot import CaptureFirstBot
from src.bots.python.invalid_bot import InvalidBot
from src.bots.python.process_fault_bot import ProcessFaultBot
from src.bots.python.tests.fixtures import (
    load_schema,
    load_valid_ndjson,
    load_invalid_cases,
    validate_action_message
)

class TestBotContract(unittest.TestCase):
    def setUp(self):
        self.schema = load_schema()
        self.valid_messages = load_valid_ndjson()
        self.invalid_cases = load_invalid_cases()
        # Chuẩn bị luồng NDJSON input cho bot từ fixture hợp lệ
        # (Chỉ đưa các message mà server gửi cho bot: INIT, STATE_UPDATE, TURN_RESULT, MATCH_RESULT)
        server_lines = []
        for msg in self.valid_messages:
            if msg.get("type") in ("INIT", "STATE_UPDATE", "TURN_RESULT", "MATCH_RESULT"):
                server_lines.append(json.dumps(msg))
        self.fixture_stdin = "\n".join(server_lines) + "\n"

    def test_schema_loaded_successfully(self):
        self.assertEqual(self.schema.get("title"), "OTT Bot Protocol v1")
        self.assertIn("$defs", self.schema)
        self.assertIn("actionMessage", self.schema["$defs"])

    def test_first_legal_bot_transcript_compliance(self):
        bot = FirstLegalBot()
        stdin = io.StringIO(self.fixture_stdin)
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch("sys.stdin", stdin), patch("sys.stdout", stdout), patch("sys.stderr", stderr):
            bot.run()

        output_lines = [line.strip() for line in stdout.getvalue().splitlines() if line.strip()]
        # Trận đấu có 1 lượt STATE_UPDATE cho X, bot phải xuất đúng 1 ACTION
        self.assertEqual(len(output_lines), 1)

        for line in output_lines:
            msg = json.loads(line)
            # Kiểm chứng tuân thủ nghiêm ngặt theo JSON schema của actionMessage
            validate_action_message(msg)
            self.assertEqual(msg["matchId"], "m-fixture-001")
            self.assertEqual(msg["turnId"], 17)
            # FirstLegalBot phải chọn action đầu tiên trong legalActions
            self.assertEqual(msg["action"]["pieceId"], "X-ROCK-1")
            self.assertEqual(msg["action"]["to"], {"col": 6, "row": 6})

    def test_capture_first_bot_transcript_compliance(self):
        bot = CaptureFirstBot()
        stdin = io.StringIO(self.fixture_stdin)
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch("sys.stdin", stdin), patch("sys.stdout", stdout), patch("sys.stderr", stderr):
            bot.run()

        output_lines = [line.strip() for line in stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(output_lines), 1)

        for line in output_lines:
            msg = json.loads(line)
            validate_action_message(msg)
            self.assertEqual(msg["matchId"], "m-fixture-001")
            self.assertEqual(msg["turnId"], 17)
            # CaptureFirstBot phải phát hiện quân địch tại (8, 8) và chọn capture
            self.assertEqual(msg["action"]["pieceId"], "X-ROCK-1")
            self.assertEqual(msg["action"]["to"], {"col": 8, "row": 8})

    def test_invalid_bot_contract_modes(self):
        state_msg = next(m for m in self.valid_messages if m["type"] == "STATE_UPDATE")

        # 1. Mode malformed: Không thể parse JSON (khớp case 'malformed-json')
        bot_malformed = InvalidBot(mode="malformed")
        out_malformed = io.StringIO()
        with patch("sys.stdout", out_malformed):
            bot_malformed.on_state_update(state_msg)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(out_malformed.getvalue().strip())

        # 2. Mode illegal: Gửi action không nằm trong legalActions
        bot_illegal = InvalidBot(mode="illegal")
        out_illegal = io.StringIO()
        with patch("sys.stdout", out_illegal):
            bot_illegal.on_state_update(state_msg)
        msg_illegal = json.loads(out_illegal.getvalue().strip())
        self.assertEqual(msg_illegal["action"]["pieceId"], "NON_EXISTENT_PIECE")
        legal_piece_ids = [a["pieceId"] for a in state_msg["legalActions"]]
        self.assertNotIn(msg_illegal["action"]["pieceId"], legal_piece_ids)

        # 3. Mode stale: Gửi action với turnId bị lệch (khớp case 'stale-turn-id')
        bot_stale = InvalidBot(mode="stale")
        out_stale = io.StringIO()
        with patch("sys.stdout", out_stale):
            bot_stale.on_state_update(state_msg)
        msg_stale = json.loads(out_stale.getvalue().strip())
        self.assertNotEqual(msg_stale["turnId"], state_msg["turnId"])

    def test_process_fault_bot_contract_modes(self):
        state_msg = next(m for m in self.valid_messages if m["type"] == "STATE_UPDATE")

        # 1. Mode oversized: Output vượt ngưỡng 65536 bytes (khớp case 'oversized-message')
        bot_oversized = ProcessFaultBot(mode="oversized", oversized_bytes=70000)
        out_oversized = io.StringIO()
        with patch("sys.stdout", out_oversized):
            bot_oversized.on_state_update(state_msg)
        raw_output = out_oversized.getvalue().strip()
        self.assertGreater(len(raw_output.encode("utf-8")), 65536)

        # 2. Mode crash: Thoát tiến trình với mã non-zero (1)
        bot_crash = ProcessFaultBot(mode="crash")
        with self.assertRaises(SystemExit) as cm:
            bot_crash.on_state_update(state_msg)
        self.assertEqual(cm.exception.code, 1)

    def test_stdout_isolation_no_debug_pollution(self):
        # Đảm bảo bot chỉ in duy nhất các dòng NDJSON hợp lệ ra stdout, toàn bộ log đi vào stderr
        bot = FirstLegalBot()
        stdin = io.StringIO(self.fixture_stdin)
        stdout = io.StringIO()
        stderr = io.StringIO()

        with patch("sys.stdin", stdin), patch("sys.stdout", stdout), patch("sys.stderr", stderr):
            bot.run()

        stdout_content = stdout.getvalue().strip()
        for line in stdout_content.splitlines():
            # Mọi dòng đều phải parse được thành JSON object
            parsed = json.loads(line)
            self.assertIsInstance(parsed, dict)
            self.assertEqual(parsed.get("type"), "ACTION")

if __name__ == "__main__":
    unittest.main()

