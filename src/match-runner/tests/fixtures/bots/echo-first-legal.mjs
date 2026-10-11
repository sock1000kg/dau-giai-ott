#!/usr/bin/env node
import readline from 'node:readline';

const args = process.argv.slice(2);
if (args.includes('--echo-argv')) {
  process.stderr.write(`ARGV:${JSON.stringify(args)}\n`);
}

const passWrongMatchId = args.includes('--pass-through-wrong-match-id');
const passWrongTurnId = args.includes('--pass-through-wrong-turn-id');
const passIllegalAction = args.includes('--pass-through-illegal-action');

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

  process.stderr.write(`RECEIVED:${msg.type}\n`);

  if (msg.type === 'STATE_UPDATE') {
    let action = msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } };
    if (passIllegalAction) {
      action = { pieceId: 'X-ROCK-1', to: { col: 5, row: 5 } };
    }

    const reply = {
      type: 'ACTION',
      protocolVersion: 1,
      matchId: passWrongMatchId ? 'wrong-match-id' : msg.matchId,
      turnId: passWrongTurnId ? 9999 : msg.turnId,
      action,
    };
    process.stdout.write(JSON.stringify(reply) + '\n');
  } else if (msg.type === 'MATCH_RESULT') {
    process.exit(0);
  }
});
