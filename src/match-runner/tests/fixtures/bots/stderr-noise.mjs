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
    // Write JSON-looking protocol-like text to stderr
    const fakeStderrJson = JSON.stringify({
      type: 'ACTION',
      protocolVersion: 1,
      matchId: msg.matchId,
      turnId: msg.turnId,
      action: { pieceId: 'FAKE-PIECE', to: { col: 9, row: 9 } },
    }) + '\n';
    process.stderr.write(fakeStderrJson);

    // Then write valid ACTION to stdout
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
