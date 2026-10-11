#!/usr/bin/env node
import readline from 'node:readline';

// Immediately print a line before any STATE_UPDATE has arrived
process.stdout.write('unsolicited stdout line before any request\n');

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
    const validAction = {
      type: 'ACTION',
      protocolVersion: 1,
      matchId: msg.matchId,
      turnId: msg.turnId,
      action: msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } },
    };
    process.stdout.write(JSON.stringify(validAction) + '\n');
  }
});
