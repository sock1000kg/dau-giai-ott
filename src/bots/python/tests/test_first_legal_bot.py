import unittest
import io
import json
from unittest.mock import patch
from src.bots.python.first_legal_bot import FirstLegalBot

class TestFirstLegalBot(unittest.TestCase):
    def test_first_legal_action_selected(self):
        bot = FirstLegalBot()
        
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "test-match",
            "turnId": 1,
            "state": {},
            "legalActions": [
                {"pieceId": "X-ROCK-1", "to": {"col": 1, "row": 2}},
                {"pieceId": "X-ROCK-2", "to": {"col": 3, "row": 4}}
            ]
        }
        
        action = bot.on_state_update(msg)
        self.assertIsNotNone(action)
        self.assertEqual(action["pieceId"], "X-ROCK-1")
        self.assertEqual(action["to"], {"col": 1, "row": 2})

    def test_empty_legal_actions(self):
        bot = FirstLegalBot()
        
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "test-match",
            "turnId": 1,
            "state": {},
            "legalActions": []
        }
        
        action = bot.on_state_update(msg)
        self.assertIsNone(action)

    def test_full_run(self):
        # Test full SDK loop integration
        stdin_content = '{"type":"STATE_UPDATE","protocolVersion":1,"matchId":"match-1","turnId":2,"state":{},"legalActions":[{"pieceId":"X-ROCK-1","to":{"col":1,"row":1}}]}\n{"type":"MATCH_RESULT","matchId":"match-1"}\n'
        stdin = io.StringIO(stdin_content)
        stdout = io.StringIO()
        
        bot = FirstLegalBot()
        
        with patch('sys.stdin', stdin), patch('sys.stdout', stdout):
            bot.run()
            
        output = stdout.getvalue().strip()
        parsed = json.loads(output)
        
        self.assertEqual(parsed["type"], "ACTION")
        self.assertEqual(parsed["action"]["pieceId"], "X-ROCK-1")

if __name__ == '__main__':
    unittest.main()
