import { afterEach, describe, expect, it } from 'vitest';

import {
  captureFirstBot,
  firstLegalBot,
  isAlive,
  runPythonMatch,
  type E2eMatch,
} from './helpers.ts';

const matches: E2eMatch[] = [];

afterEach(() => {
  while (matches.length > 0) matches.pop()?.cleanup();
});

describe('P1-D10 E2E happy path', () => {
  it('runs two real Python bots, produces a replayable match and leaves no child process', { timeout: 10_000 }, async () => {
    const match = await runPythonMatch({
      x: { script: firstLegalBot },
      o: { script: captureFirstBot },
      maxTurns: 4,
    });
    matches.push(match);

    expect(match.code).toBe(0);
    expect(match.result).toMatchObject({ reason: 'TURN_LIMIT', turnCount: 4, forfeitedSide: null });
    expect(match.log.entries).toHaveLength(4);
    expect(match.log.footer.faults.X.recoverableTotal).toBe(0);
    expect(match.log.footer.faults.O.recoverableTotal).toBe(0);
    expect(match.pids.every((pid) => !isAlive(pid))).toBe(true);
  });
});
