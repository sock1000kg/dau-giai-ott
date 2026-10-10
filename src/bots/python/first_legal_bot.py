from typing import Dict, Any, Optional
from src.bots.python.sdk import BotSDK

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
