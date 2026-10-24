package main

import (
	"bufio"
	"encoding/json"
	"os"
)

// Minimal OTT demo bot: answers every STATE_UPDATE with the first legal action.
// It echoes the protocolVersion of the incoming message so it works on both
// Bot Protocol v1 and v2 matches.
type message struct {
	Type            string            `json:"type"`
	ProtocolVersion int               `json:"protocolVersion"`
	MatchID         string            `json:"matchId"`
	TurnID          int               `json:"turnId"`
	LegalActions    []json.RawMessage `json:"legalActions"`
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	out := bufio.NewWriter(os.Stdout)
	for scanner.Scan() {
		var in message
		if json.Unmarshal(scanner.Bytes(), &in) != nil || in.Type != "STATE_UPDATE" || len(in.LegalActions) == 0 {
			continue
		}
		version := in.ProtocolVersion
		if version == 0 {
			version = 1
		}
		reply, _ := json.Marshal(map[string]any{"type": "ACTION", "protocolVersion": version, "matchId": in.MatchID, "turnId": in.TurnID, "action": in.LegalActions[0]})
		_, _ = out.Write(append(reply, '\n'))
		_ = out.Flush()
	}
}
