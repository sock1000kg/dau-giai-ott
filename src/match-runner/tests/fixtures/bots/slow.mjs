#!/usr/bin/env node
import readline from 'node:readline';

const args = process.argv.slice(2);
const delayMsArg = args.indexOf('--delay-ms');
const defaultDelayMs = delayMsArg !== -1 ? parseInt(args[delayMsArg + 1], 10) : 300;
const delayFirstArg = args.indexOf('--delay-first');
const delayFirstMs = delayFirstArg !== -1 ? parseInt(args[delayFirstArg + 1], 10) : null;
const delaysArg = args.indexOf('--delays');
const turnDelays = delaysArg !== -1 ? JSON.parse(args[delaysArg + 1]) : null;

let stateUpdateCount = 0;

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
    stateUpdateCount++;
    const action = msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } };
    const reply = {
      type: 'ACTION',
      protocolVersion: 1,
      matchId: msg.matchId,
      turnId: msg.turnId,
      action,
    };

    let delay = defaultDelayMs;
    if (turnDelays && turnDelays[String(msg.turnId)] !== undefined) {
      delay = turnDelays[String(msg.turnId)];
    } else if (delayFirstMs !== null) {
      delay = stateUpdateCount === 1 ? delayFirstMs : 0;
    }

    if (delay > 0) {
      setTimeout(() => {
        process.stdout.write(JSON.stringify(reply) + '\n');
      }, delay);
    } else {
      process.stdout.write(JSON.stringify(reply) + '\n');
    }
  } else if (msg.type === 'MATCH_RESULT') {
    process.exit(0);
  }
});
