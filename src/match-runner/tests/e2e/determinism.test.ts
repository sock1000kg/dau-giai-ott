import { afterEach, describe, expect, it } from 'vitest';

import {
  captureFirstBot,
  firstLegalBot,
  runPythonMatch,
  type E2eMatch,
} from './helpers.ts';

const matches: E2eMatch[] = [];

afterEach(() => {
  while (matches.length > 0) matches.pop()?.cleanup();
});

describe('P1-D10 E2E determinism', () => {
  it('produces byte-identical event logs and final hashes for identical Python-bot inputs', { timeout: 10_000 }, async () => {
    const options = {
      x: { script: firstLegalBot },
      o: { script: captureFirstBot },
      maxTurns: 4,
      matchId: 'deterministic-e2e',
      seed: 'fixed-seed',
    };
    const first = await runPythonMatch(options);
    const second = await runPythonMatch(options);
    matches.push(first, second);

    expect(first.result.finalStateHash).toBe(second.result.finalStateHash);
    const { eventLog: firstEventLog, ...firstStdout } = JSON.parse(first.stdout) as Record<string, unknown>;
    const { eventLog: secondEventLog, ...secondStdout } = JSON.parse(second.stdout) as Record<string, unknown>;
    expect(firstEventLog).not.toBe(secondEventLog);
    expect(firstStdout).toEqual(secondStdout);
    expect(first.logText).toBe(second.logText);
  });
});
