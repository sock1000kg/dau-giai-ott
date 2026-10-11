#!/usr/bin/env node
import readline from 'node:readline';

const args = process.argv.slice(2);
const beforeInit = args.includes('--before-init');
const onStateUpdate = args.includes('--on-state-update');
const codeArg = args.indexOf('--code');
const exitCode = codeArg !== -1 ? parseInt(args[codeArg + 1], 10) : 1;
const signalArg = args.indexOf('--signal');
const exitSignal = signalArg !== -1 ? args[signalArg + 1] : null;

if (beforeInit) {
  if (exitSignal) {
    process.kill(process.pid, exitSignal);
  } else {
    process.exit(exitCode);
  }
}

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

  if (onStateUpdate && msg.type === 'STATE_UPDATE') {
    if (exitSignal) {
      process.kill(process.pid, exitSignal);
    } else {
      process.exit(exitCode);
    }
  }
});
