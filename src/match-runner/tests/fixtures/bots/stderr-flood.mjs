#!/usr/bin/env node
import readline from 'node:readline';

const args = process.argv.slice(2);
const bytesArg = args.indexOf('--bytes');
const byteCount = bytesArg !== -1 ? parseInt(args[bytesArg + 1], 10) : 200000;

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
    const chunk = Buffer.alloc(byteCount, 'x');
    process.stderr.write(chunk);
  }
});
