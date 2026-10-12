#!/usr/bin/env node

process.on('SIGTERM', () => {
  // Traps and ignores SIGTERM
});

// The lifecycle test waits for this intentionally out-of-window line.  It is
// emitted only after the SIGTERM handler is registered, so the test exercises
// the SIGKILL escalation instead of racing Node process startup.
process.stdout.write('READY_FOR_SIGTERM\n');

// Resume stdin and keep timer running so process stays alive across stdin.end() and SIGTERM
process.stdin.resume();
setInterval(() => {}, 10000);
