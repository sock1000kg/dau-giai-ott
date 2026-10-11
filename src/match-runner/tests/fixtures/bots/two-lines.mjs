#!/usr/bin/env node
import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.type === 'STATE_UPDATE') {
    if (msg.turnId === 1) {
      const action1 = {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: msg.matchId,
        turnId: 1,
        action: msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } },
      };
      const extraLine = {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: msg.matchId,
        turnId: 99,
        action: { pieceId: 'X-ROCK-1', to: { col: 1, row: 1 } },
      };
      // Send both lines in a single chunk write
      process.stdout.write(JSON.stringify(action1) + '\n' + JSON.stringify(extraLine) + '\n');
    } else {
      const normalAction = {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: msg.matchId,
        turnId: msg.turnId,
        action: msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } },
      };
      process.stdout.write(JSON.stringify(normalAction) + '\n');
    }
  }
});
