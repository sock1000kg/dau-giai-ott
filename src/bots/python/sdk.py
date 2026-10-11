import sys
import json
from typing import Callable, Dict, Any, Optional

class BotSDK:
    def __init__(self):
        self.on_init: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_state_update: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]] = None
        self.on_turn_result: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_match_result: Optional[Callable[[Dict[str, Any]], None]] = None

    def send_action(self, match_id: str, turn_id: int, action: Dict[str, Any]) -> None:
        """
        Gửi ACTION message qua stdout theo đúng chuẩn NDJSON.
        """
        action_msg = {
            "type": "ACTION",
            "protocolVersion": 1,
            "matchId": match_id,
            "turnId": turn_id,
            "action": action
        }
        print(json.dumps(action_msg), flush=True)

    def log(self, message: str) -> None:
        """
        Ghi log vào stderr để không làm hỏng luồng stdout (NDJSON).
        """
        print(message, file=sys.stderr, flush=True)

    def run(self) -> None:
        """
        Đọc và xử lý stdin line-by-line theo protocol.
        """
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                self.log(f"Malformed JSON: {line}")
                continue

            if not isinstance(msg, dict):
                self.log(f"Invalid message format, expected object: {line}")
                continue

            msg_type = msg.get("type")
            if msg_type == "INIT":
                if self.on_init:
                    self.on_init(msg)
            elif msg_type == "STATE_UPDATE":
                if self.on_state_update:
                    action = self.on_state_update(msg)
                    if action:
                        self.send_action(
                            match_id=msg.get("matchId", ""),
                            turn_id=msg.get("turnId", 0),
                            action=action
                        )
            elif msg_type == "TURN_RESULT":
                if self.on_turn_result:
                    self.on_turn_result(msg)
            elif msg_type == "MATCH_RESULT":
                if self.on_match_result:
                    self.on_match_result(msg)
                break
            else:
                self.log(f"Unknown message type: {msg_type}")

