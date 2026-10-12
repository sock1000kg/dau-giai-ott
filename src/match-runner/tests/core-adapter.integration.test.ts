import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { applyAction, DEFAULT_MAP, type GameConfig } from '@ott/game-core';

import { CoreGameAdapter, ScriptedBot, runMatch } from '../src/index.ts';

const game: GameConfig = {
  gameId: 'core-adapter-integration',
  engineVersion: '1.0.0',
  map: DEFAULT_MAP,
  maxTurns: 1,
};

describe('P1-D09 CoreGameAdapter', () => {
  it('runs the real core through MatchRunner with a ScriptedBot', async () => {
    const adapter = new CoreGameAdapter();
    const initial = adapter.create(game);
    const action = adapter.listLegalActions(initial, 'X')[0];
    expect(action).toBeDefined();
    if (action === undefined) throw new Error('expected a legal X action on the default map');
    expect(adapter.apply(initial, 'O', action)).toEqual(applyAction(initial, 'O', action));

    const x = new ScriptedBot({ replies: [{ kind: 'action', action }] });
    const o = new ScriptedBot({ replies: [] });
    const report = await runMatch(
      {
        matchId: game.gameId,
        seed: 'core-adapter-seed',
        game,
        limits: { ...DEFAULT_LIMITS, maxTurns: 1 },
      },
      { game: adapter, bots: { X: x, O: o } },
    );

    expect(report.result).toMatchObject({
      winnerSide: null,
      reason: 'TURN_LIMIT',
      turnCount: 1,
      forfeitedSide: null,
    });
    expect(report.result.finalStateHash).toBe(adapter.hash(report.finalState));
    expect(report.log.entries).toHaveLength(1);
    expect(report.log.entries[0]?.input).toEqual({ kind: 'apply', side: 'X', action });
    expect(x.received.map((message) => message.type)).toEqual([
      'INIT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'MATCH_RESULT',
    ]);
    expect(o.received.map((message) => message.type)).toEqual(['INIT', 'TURN_RESULT', 'MATCH_RESULT']);
  });
});
