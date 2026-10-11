import sys
from pathlib import Path
from typing import Dict, Any, Optional

_current_dir = Path(__file__).resolve().parent
_repo_root = _current_dir.parent.parent.parent
for _p in [str(_current_dir), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from src.bots.python.sdk import BotSDK
except ModuleNotFoundError:
    from sdk import BotSDK

class FirstLegalBot:
    def __init__(self):
        self.sdk = BotSDK()
        self.sdk.on_state_update = self.on_state_update

    def on_state_update(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        legal_actions = msg.get("legalActions", [])
        if legal_actions and len(legal_actions) > 0:
            return legal_actions[0]
        return None

    def run(self) -> None:
        self.sdk.run()

if __name__ == "__main__":
    bot = FirstLegalBot()
    bot.run()
