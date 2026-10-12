import { afterEach, describe, expect, it } from 'vitest';

import {
  firstLegalBot,
  invalidBot,
  isAlive,
  processFaultBot,
  runPythonMatch,
  type E2eMatch,
} from './helpers.ts';

const matches: E2eMatch[] = [];

afterEach(() => {
  while (matches.length > 0) matches.pop()?.cleanup();
});

describe('P1-D10 E2E fault matrix', () => {
  it.each([
    ['malformed', invalidBot, ['--mode=malformed'], 'MALFORMED_JSON'],
    ['illegal', invalidBot, ['--mode=illegal'], 'ILLEGAL_ACTION'],
    ['stale', invalidBot, ['--mode=stale'], 'TURN_ID_MISMATCH'],
    ['timeout', processFaultBot, ['--mode=timeout', '--delay=1'], 'BOT_TIMEOUT'],
    ['oversized', processFaultBot, ['--mode=oversized', '--size=70000'], 'MESSAGE_TOO_LARGE'],
  ])('records recoverable %s fault from a real Python bot', { timeout: 10_000 }, async (_name, script, args, expected) => {
    const match = await runPythonMatch({
      x: { script, args },
      o: { script: firstLegalBot },
      maxTurns: 1,
      turnTimeoutMs: 100,
    });
    matches.push(match);

    expect(match.result).toMatchObject({ reason: 'TURN_LIMIT', turnCount: 1, forfeitedSide: null });
    expect(match.log.entries[0]?.input).toEqual({ kind: 'skip', side: 'X', reason: expected });
    expect(match.log.footer.faults.X.lastErrorCode).toBe(expected);
    expect(match.log.footer.faults.X.recoverableTotal).toBe(1);
    expect(match.pids.every((pid) => !isAlive(pid))).toBe(true);
  });

  it('forfeits a crashing Python bot immediately and leaves both processes stopped', { timeout: 10_000 }, async () => {
    const match = await runPythonMatch({
      x: { script: processFaultBot, args: ['--mode=crash'] },
      o: { script: firstLegalBot },
      maxTurns: 4,
    });
    matches.push(match);

    expect(match.result).toMatchObject({ winnerSide: 'O', reason: 'FORFEIT', forfeitedSide: 'X', turnCount: 0 });
    expect(match.log.entries[0]?.input).toEqual({ kind: 'forfeit', side: 'X', fault: 'BOT_CRASHED' });
    expect(match.log.footer.faults.X.lastErrorCode).toBe('BOT_CRASHED');
    expect(match.pids.every((pid) => !isAlive(pid))).toBe(true);
  });
});
