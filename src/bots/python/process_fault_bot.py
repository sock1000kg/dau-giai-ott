import sys
import json
import time
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

# 65536 là giới hạn maxMessageBytes chuẩn theo protocol v1
DEFAULT_OVERSIZED_BYTES = 70000
DEFAULT_TIMEOUT_SECONDS = 10.0

class ProcessFaultBot:
    def __init__(self, mode: str, delay: float = DEFAULT_TIMEOUT_SECONDS, oversized_bytes: int = DEFAULT_OVERSIZED_BYTES):
        self.mode = mode
        self.delay = delay
        self.oversized_bytes = oversized_bytes
        self.sdk = BotSDK()
        self.sdk.on_state_update = self.on_state_update

    def on_state_update(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        match_id = msg.get("matchId", "")
        turn_id = msg.get("turnId", 1)

        if self.mode == "crash":
            self.sdk.log("ProcessFaultBot: Cố ý crash với exit code non-zero (1)")
            sys.exit(1)

        elif self.mode == "timeout":
            self.sdk.log(f"ProcessFaultBot: Cố ý sleep {self.delay}s để gây BOT_TIMEOUT")
            time.sleep(self.delay)
            # Sau khi sleep nếu chưa bị kill thì trả về action hợp lệ (action đến muộn)
            legal_actions = msg.get("legalActions", [])
            action = legal_actions[0] if legal_actions else {"pieceId": "P1", "to": {"col": 0, "row": 0}}
            return action

        elif self.mode == "oversized":
            self.sdk.log(f"ProcessFaultBot: Sinh message vượt quá giới hạn ({self.oversized_bytes} bytes)")
            legal_actions = msg.get("legalActions", [])
            action = legal_actions[0] if legal_actions else {"pieceId": "P1", "to": {"col": 0, "row": 0}}
            
            # Tạo payload có độ dài vượt mức maxMessageBytes
            padding_len = max(1, self.oversized_bytes - 100)
            oversized_msg = {
                "type": "ACTION",
                "protocolVersion": 1,
                "matchId": match_id,
                "turnId": turn_id,
                "action": action,
                "padding": "x" * padding_len
            }
            output = json.dumps(oversized_msg)
            print(output, flush=True)
            return None

        else:
            self.sdk.log(f"ProcessFaultBot: Unknown mode: {self.mode}")
            return None

    def run(self) -> None:
        self.sdk.run()

def parse_args() -> Dict[str, Any]:
    mode = "crash"
    delay = DEFAULT_TIMEOUT_SECONDS
    oversized_bytes = DEFAULT_OVERSIZED_BYTES

    for arg in sys.argv[1:]:
        if arg.startswith("--mode="):
            mode = arg.split("=", 1)[1]
        elif arg.startswith("--delay="):
            try:
                delay = float(arg.split("=", 1)[1])
            except ValueError:
                pass
        elif arg.startswith("--size="):
            try:
                oversized_bytes = int(arg.split("=", 1)[1])
            except ValueError:
                pass
        elif not arg.startswith("--"):
            mode = arg

    return {
        "mode": mode,
        "delay": delay,
        "oversized_bytes": oversized_bytes
    }

if __name__ == "__main__":
    args = parse_args()
    bot = ProcessFaultBot(
        mode=args["mode"],
        delay=args["delay"],
        oversized_bytes=args["oversized_bytes"]
    )
    bot.run()

