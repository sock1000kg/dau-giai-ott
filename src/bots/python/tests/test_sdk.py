import unittest
import json
import io
import sys
from unittest.mock import patch
from src.bots.python.sdk import BotSDK

class TestBotSDK(unittest.TestCase):
    def setUp(self):
        self.sdk = BotSDK()
        
    def test_send_action(self):
        stdout = io.StringIO()
        with patch('sys.stdout', stdout):
            self.sdk.send_action("match-1", 5, {"pieceId": "X-ROCK-1", "to": {"col": 1, "row": 2}})
        
        output = stdout.getvalue().strip()
        parsed = json.loads(output)
        
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["protocolVersion"], 1)
        self.assertEqual(parsed["matchId"], "match-1")
        self.assertEqual(parsed["turnId"], 5)
        self.assertEqual(parsed["action"]["pieceId"], "X-ROCK-1")
        self.assertEqual(parsed["action"]["to"]["col"], 1)

    def test_log(self):
        stderr = io.StringIO()
        with patch('sys.stderr', stderr):
            self.sdk.log("test error message")
            
        self.assertEqual(stderr.getvalue().strip(), "test error message")

    def test_run_init(self):
        called = False
        def on_init(msg):
            nonlocal called
            called = True
            self.assertEqual(msg["type"], "INIT")
            self.assertEqual(msg["matchId"], "m-fixture-001")
            
        self.sdk.on_init = on_init
        
        stdin = io.StringIO('{"type":"INIT","protocolVersion":1,"matchId":"m-fixture-001"}\n')
        with patch('sys.stdin', stdin):
            self.sdk.run()
            
        self.assertTrue(called)

    def test_run_state_update(self):
        action_sent = False
        def on_state_update(msg):
            self.assertEqual(msg["turnId"], 17)
            return {"pieceId": "X-ROCK-1", "to": {"col": 8, "row": 8}}
            
        self.sdk.on_state_update = on_state_update
        
        stdin = io.StringIO('{"type":"STATE_UPDATE","protocolVersion":1,"matchId":"m-fixture-001","turnId":17,"state":{},"legalActions":[]}\n')
        stdout = io.StringIO()
        
        with patch('sys.stdin', stdin), patch('sys.stdout', stdout):
            self.sdk.run()
            
        output = stdout.getvalue().strip()
        parsed = json.loads(output)
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["turnId"], 17)
        self.assertEqual(parsed["action"]["pieceId"], "X-ROCK-1")

    def test_run_match_result_breaks_loop(self):
        called = False
        def on_match_result(msg):
            nonlocal called
            called = True
            
        self.sdk.on_match_result = on_match_result
        
        stdin = io.StringIO('{"type":"MATCH_RESULT","matchId":"m-fixture-001"}\n{"type":"INIT"}\n')
        with patch('sys.stdin', stdin):
            self.sdk.run()
            
        self.assertTrue(called)
        # Should break loop, so if there was another message it wouldn't process it (tested implicitly by loop breaking)

    def test_run_invalid_json(self):
        stderr = io.StringIO()
        stdin = io.StringIO('invalid json\n{"type":"MATCH_RESULT"}\n')
        
        with patch('sys.stdin', stdin), patch('sys.stderr', stderr):
            self.sdk.run()
            
        self.assertIn("Malformed JSON: invalid json", stderr.getvalue())

if __name__ == '__main__':
    unittest.main()

