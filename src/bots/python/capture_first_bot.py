from typing import Dict, Any, Optional
from src.bots.python.sdk import BotSDK

class CaptureFirstBot:
    def __init__(self):
        self.sdk = BotSDK()
        self.sdk.on_state_update = self.on_state_update

    def on_state_update(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        legal_actions = msg.get("legalActions", [])
        if not legal_actions:
            return None

        state = msg.get("state", {})
        turn = state.get("turn")  # This is the bot's side
        pieces = state.get("pieces", [])

        # Find all enemy piece positions
        enemy_positions = set()
        for piece in pieces:
            if piece.get("owner") != turn:
                pos = piece.get("position", {})
                if "col" in pos and "row" in pos:
                    enemy_positions.add((pos["col"], pos["row"]))

        # Check for capture actions
        for action in legal_actions:
            to = action.get("to", {})
            if "col" in to and "row" in to:
                if (to["col"], to["row"]) in enemy_positions:
                    return action

        # Fallback to the first legal action (deterministic)
        return legal_actions[0]

    def run(self) -> None:
        self.sdk.run()

if __name__ == "__main__":
    bot = CaptureFirstBot()
    bot.run()
