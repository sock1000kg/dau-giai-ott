#!/usr/bin/env node
import readline from 'node:readline';

const mode = process.argv[2] ?? 'non-json';

const validInit = {
  type: 'INIT',
  protocolVersion: 1,
  matchId: 'm-fixture-001',
  engineVersion: '0.0.0',
  side: 'X',
  seed: 'seed-1',
  map: {
    mapId: 'map-1',
    version: 1,
    checksum: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    width: 9,
    height: 9,
    spawns: [
      { id: 'X-ROCK-1', owner: 'X', type: 'ROCK', position: { col: 0, row: 0 } },
      { id: 'X-ROCK-2', owner: 'X', type: 'ROCK', position: { col: 1, row: 0 } },
      { id: 'X-ROCK-3', owner: 'X', type: 'ROCK', position: { col: 2, row: 0 } },
      { id: 'X-PAPER-1', owner: 'X', type: 'PAPER', position: { col: 0, row: 1 } },
      { id: 'X-PAPER-2', owner: 'X', type: 'PAPER', position: { col: 1, row: 1 } },
      { id: 'X-PAPER-3', owner: 'X', type: 'PAPER', position: { col: 2, row: 1 } },
      { id: 'X-SCISSORS-1', owner: 'X', type: 'SCISSORS', position: { col: 0, row: 2 } },
      { id: 'X-SCISSORS-2', owner: 'X', type: 'SCISSORS', position: { col: 1, row: 2 } },
      { id: 'X-SCISSORS-3', owner: 'X', type: 'SCISSORS', position: { col: 2, row: 2 } },
      { id: 'O-ROCK-1', owner: 'O', type: 'ROCK', position: { col: 6, row: 6 } },
      { id: 'O-ROCK-2', owner: 'O', type: 'ROCK', position: { col: 7, row: 6 } },
      { id: 'O-ROCK-3', owner: 'O', type: 'ROCK', position: { col: 8, row: 6 } },
      { id: 'O-PAPER-1', owner: 'O', type: 'PAPER', position: { col: 6, row: 7 } },
      { id: 'O-PAPER-2', owner: 'O', type: 'PAPER', position: { col: 7, row: 7 } },
      { id: 'O-PAPER-3', owner: 'O', type: 'PAPER', position: { col: 8, row: 7 } },
      { id: 'O-SCISSORS-1', owner: 'O', type: 'SCISSORS', position: { col: 6, row: 8 } },
      { id: 'O-SCISSORS-2', owner: 'O', type: 'SCISSORS', position: { col: 7, row: 8 } },
      { id: 'O-SCISSORS-3', owner: 'O', type: 'SCISSORS', position: { col: 8, row: 8 } },
    ],
    goals: { X: { col: 8, row: 8 }, O: { col: 0, row: 0 } },
  },
  limits: {
    startupTimeoutMs: 1000,
    turnTimeoutMs: 1000,
    maxTurns: 100,
    maxMessageBytes: 65536,
    maxStderrBytes: 65536,
    maxConsecutiveFaults: 3,
    maxTotalFaults: 5,
  },
};

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
      // First request: emit the configured garbage error
      switch (mode) {
        case 'non-json':
          process.stdout.write('broken non-json string {{{\n');
          break;
        case 'json-array':
          process.stdout.write('[1, 2, 3]\n');
          break;
        case 'schema-invalid':
          process.stdout.write(JSON.stringify({ type: 'ACTION', unknownField: true }) + '\n');
          break;
        case 'init-typed':
          process.stdout.write(JSON.stringify(validInit) + '\n');
          break;
        case 'oversize':
          process.stdout.write('{"type":"ACTION",'.padEnd(70000, ' ') + '}\n');
          break;
        default:
          process.stdout.write('invalid mode\n');
      }
    } else {
      // Subsequent request: respond with a completely valid ACTION message (no poisoning)
      const validAction = {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: msg.matchId,
        turnId: msg.turnId,
        action: msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } },
      };
      process.stdout.write(JSON.stringify(validAction) + '\n');
    }
  }
});
