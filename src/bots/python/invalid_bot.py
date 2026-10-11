import sys
import json
from pathlib import Path
from typing import Dict, Any, Optional

# Thêm đường dẫn để hỗ trợ chạy trực tiếp script hoặc qua runner
_current_dir = Path(__file__).resolve().parent
_repo_root = _current_dir.parent.parent.parent
for _p in [str(_current_dir), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from src.bots.python.sdk import BotSDK
except ModuleNotFoundError:
    from sdk import BotSDK

class InvalidBot:
    def __init__(self, mode: str):
        self.mode = mode
        self.sdk = BotSDK()
        self.sdk.on_state_update = self.on_state_update

    def on_state_update(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        match_id = msg.get("matchId", "")
        turn_id = msg.get("turnId", 1)

        if self.mode == "malformed":
            # Gửi JSON hỏng để kích hoạt lỗi MALFORMED_JSON
            print('{"type": "ACTION", "protocolVersion": 1, unclosed_json', flush=True)
            return None

        elif self.mode == "illegal":
            # Gửi action có pieceId/tọa độ không hợp lệ để kích hoạt ILLEGAL_ACTION
            # Vẫn tuân thủ schema để tránh SCHEMA_VIOLATION
            action_msg = {
                "type": "ACTION",
                "protocolVersion": 1,
                "matchId": match_id,
                "turnId": turn_id,
                "action": {
                    "pieceId": "NON_EXISTENT_PIECE",
                    "to": {"col": 0, "row": 0}
                }
            }
            print(json.dumps(action_msg), flush=True)
            return None

        elif self.mode == "stale":
            # Gửi action với turnId bị lệch (nhưng >= 1 để đúng schema) kích hoạt TURN_ID_MISMATCH
            stale_turn_id = turn_id - 1 if turn_id > 1 else turn_id + 100
            legal_actions = msg.get("legalActions", [])
            action = legal_actions[0] if legal_actions else {"pieceId": "P1", "to": {"col": 0, "row": 0}}
            
            action_msg = {
                "type": "ACTION",
                "protocolVersion": 1,
                "matchId": match_id,
                "turnId": stale_turn_id,
                "action": action
            }
            print(json.dumps(action_msg), flush=True)
            return None

        else:
            self.sdk.log(f"Unknown mode: {self.mode}")
            return None

    def run(self) -> None:
        self.sdk.run()

def parse_mode() -> str:
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg.startswith("--mode="):
            return arg.split("=", 1)[1]
        return arg
    return "malformed"

if __name__ == "__main__":
    mode = parse_mode()
    bot = InvalidBot(mode=mode)
    bot.run()

