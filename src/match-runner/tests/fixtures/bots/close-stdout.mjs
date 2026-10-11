#!/usr/bin/env node
import readline from 'node:readline';

// Keep event loop alive
const timer = setInterval(() => {}, 5000);

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
    process.stdout.end();
  }
});
