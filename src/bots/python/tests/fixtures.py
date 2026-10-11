import json
import sys
from pathlib import Path
from typing import Dict, Any, List

_current_dir = Path(__file__).resolve().parent
_repo_root = _current_dir.parent.parent.parent.parent
for _p in [str(_current_dir.parent), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

def get_contracts_dir() -> Path:
    return _repo_root / "docs" / "contracts"

def load_schema() -> Dict[str, Any]:
    schema_path = get_contracts_dir() / "bot-protocol-v1.schema.json"
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)

def load_valid_ndjson() -> List[Dict[str, Any]]:
    fixture_path = get_contracts_dir() / "fixtures" / "bot-protocol-v1-valid.ndjson"
    messages = []
    with open(fixture_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                messages.append(json.loads(line))
    return messages

def load_invalid_cases() -> Dict[str, Any]:
    fixture_path = get_contracts_dir() / "fixtures" / "bot-protocol-v1-invalid-cases.json"
    with open(fixture_path, "r", encoding="utf-8") as f:
        return json.load(f)

def validate_action_message(msg: Any) -> None:
    """
    Validate message dict against schema definition of actionMessage:
    - required: ["type", "protocolVersion", "matchId", "turnId", "action"]
    - additionalProperties: false
    - action: required ["pieceId", "to"], additionalProperties: false
    - to: required ["col", "row"], additionalProperties: false, 0 <= col/row <= 8
    """
    if not isinstance(msg, dict):
        raise ValueError(f"Message must be a dict, got {type(msg)}")

    required_keys = {"type", "protocolVersion", "matchId", "turnId", "action"}
    if set(msg.keys()) != required_keys:
        raise ValueError(f"Keys mismatch for actionMessage. Expected {required_keys}, got {set(msg.keys())}")

    if msg["type"] != "ACTION":
        raise ValueError(f"Expected type 'ACTION', got {msg['type']!r}")

    if msg["protocolVersion"] != 1:
        raise ValueError(f"Expected protocolVersion 1, got {msg['protocolVersion']!r}")

    if not isinstance(msg["matchId"], str) or len(msg["matchId"]) < 1 or len(msg["matchId"]) > 128:
        raise ValueError(f"Invalid matchId: {msg['matchId']!r}")

    if not isinstance(msg["turnId"], int) or msg["turnId"] < 1:
        raise ValueError(f"Invalid turnId: {msg['turnId']!r} (must be int >= 1)")

    action = msg["action"]
    if not isinstance(action, dict):
        raise ValueError(f"action must be a dict, got {type(action)}")

    action_keys = {"pieceId", "to"}
    if set(action.keys()) != action_keys:
        raise ValueError(f"Keys mismatch for action. Expected {action_keys}, got {set(action.keys())}")

    if not isinstance(action["pieceId"], str) or len(action["pieceId"]) < 1:
        raise ValueError(f"Invalid pieceId: {action['pieceId']!r}")

    to = action["to"]
    if not isinstance(to, dict):
        raise ValueError(f"to must be a dict, got {type(to)}")

    to_keys = {"col", "row"}
    if set(to.keys()) != to_keys:
        raise ValueError(f"Keys mismatch for to position. Expected {to_keys}, got {set(to.keys())}")

    for coord in ("col", "row"):
        val = to[coord]
        if not isinstance(val, int) or val < 0 or val > 8:
            raise ValueError(f"Invalid coordinate {coord}: {val} (must be int in 0..8)")

