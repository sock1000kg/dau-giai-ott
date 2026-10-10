import unittest
import io
import json
from unittest.mock import patch
from src.bots.python.capture_first_bot import CaptureFirstBot

class TestCaptureFirstBot(unittest.TestCase):
    def test_capture_action_selected(self):
        bot = CaptureFirstBot()
        
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "test-match",
            "turnId": 1,
            "state": {
                "turn": "X",
                "pieces": [
                    {"id": "X-ROCK-1", "owner": "X", "position": {"col": 1, "row": 1}},
                    {"id": "O-PAPER-1", "owner": "O", "position": {"col": 2, "row": 2}},
                    {"id": "O-ROCK-1", "owner": "O", "position": {"col": 3, "row": 3}}
                ]
            },
            "legalActions": [
                {"pieceId": "X-ROCK-1", "to": {"col": 1, "row": 2}}, # Normal move
                {"pieceId": "X-ROCK-1", "to": {"col": 2, "row": 2}}, # Capture O-PAPER-1
                {"pieceId": "X-ROCK-1", "to": {"col": 2, "row": 1}}  # Normal move
            ]
        }
        
        action = bot.on_state_update(msg)
        self.assertIsNotNone(action)
        self.assertEqual(action["to"], {"col": 2, "row": 2})

    def test_fallback_when_no_capture(self):
        bot = CaptureFirstBot()
        
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "test-match",
            "turnId": 1,
            "state": {
                "turn": "X",
                "pieces": [
                    {"id": "X-ROCK-1", "owner": "X", "position": {"col": 1, "row": 1}},
                    {"id": "O-PAPER-1", "owner": "O", "position": {"col": 4, "row": 4}}
                ]
            },
            "legalActions": [
                {"pieceId": "X-ROCK-1", "to": {"col": 1, "row": 2}}, # Normal move
                {"pieceId": "X-ROCK-1", "to": {"col": 2, "row": 1}}  # Normal move
            ]
        }
        
        action = bot.on_state_update(msg)
        self.assertIsNotNone(action)
        # deterministic fallback to the first action
        self.assertEqual(action["to"], {"col": 1, "row": 2})

    def test_empty_legal_actions(self):
        bot = CaptureFirstBot()
        
        msg = {
            "type": "STATE_UPDATE",
            "matchId": "test-match",
            "turnId": 1,
            "state": {
                "turn": "X",
                "pieces": []
            },
            "legalActions": []
        }
        
        action = bot.on_state_update(msg)
        self.assertIsNone(action)

if __name__ == '__main__':
    unittest.main()
