package main

import (
	"bufio"
	"encoding/json"
	"os"
)

// OTT demo bot variants used to seed the demo tournament. Strategy comes from BOT_STRATEGY
// (first | middle | last) so the seeded teams play differently. The bot echoes the incoming
// protocolVersion and only answers Bot Protocol v2 STATE_UPDATE messages.
type message struct {
	Type            string            `json:"type"`
	ProtocolVersion int               `json:"protocolVersion"`
	MatchID         string            `json:"matchId"`
	TurnID          int               `json:"turnId"`
	LegalActions    []json.RawMessage `json:"legalActions"`
}

func pick(actions []json.RawMessage, strategy string) json.RawMessage {
	switch strategy {
	case "last":
		return actions[len(actions)-1]
	case "middle":
		return actions[len(actions)/2]
	default:
		return actions[0]
	}
}

func main() {
	strategy := os.Getenv("BOT_STRATEGY")
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	out := bufio.NewWriter(os.Stdout)
	for scanner.Scan() {
		var in message
		if json.Unmarshal(scanner.Bytes(), &in) != nil || in.Type != "STATE_UPDATE" || len(in.LegalActions) == 0 {
			continue
		}
		reply, _ := json.Marshal(map[string]any{
			"type": "ACTION", "protocolVersion": in.ProtocolVersion, "matchId": in.MatchID,
			"turnId": in.TurnID, "action": pick(in.LegalActions, strategy),
		})
		_, _ = out.Write(append(reply, '\n'))
		_ = out.Flush()
	}
}
