#!/usr/bin/env node

process.on('SIGTERM', () => {
  // Traps and ignores SIGTERM
});

// Resume stdin and keep timer running so process stays alive across stdin.end() and SIGTERM
process.stdin.resume();
setInterval(() => {}, 10000);
