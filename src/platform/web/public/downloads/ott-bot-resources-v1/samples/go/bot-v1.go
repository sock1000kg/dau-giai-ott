package main

import (
	"bufio"
	"encoding/json"
	"os"
)

type message struct {
	Type            string            `json:"type"`
	ProtocolVersion int               `json:"protocolVersion"`
	MatchID         string            `json:"matchId"`
	TurnID          int               `json:"turnId"`
	LegalMoves      []json.RawMessage `json:"legalActions"`
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var input message
		if json.Unmarshal(scanner.Bytes(), &input) != nil || input.Type != "STATE_UPDATE" || len(input.LegalMoves) == 0 {
			continue
		}
		version := input.ProtocolVersion
		if version == 0 {
			version = 1
		}
		output, _ := json.Marshal(map[string]any{"type": "ACTION", "protocolVersion": version, "matchId": input.MatchID, "turnId": input.TurnID, "action": input.LegalMoves[0]})
		_, _ = os.Stdout.Write(append(output, '\n'))
	}
}
