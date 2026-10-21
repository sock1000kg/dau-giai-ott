import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const bot = resolve(root, 'src/bots/oci-fixtures/v2-action/bot.mjs');
const transcript = readFileSync(resolve(root, 'docs/contracts/fixtures/bot-protocol-v2-valid.ndjson'), 'utf8');
const update = JSON.parse(transcript.split('\n')[1]!) as {
  matchId: string; turnId: number; state: { turn: string; pieces: { owner: string; position: { col: number; row: number } }[] };
  legalActions: { pieceId: string; to: { col: number; row: number } }[];
};

function actionFor(strategy: string, message: typeof update) {
  const run = spawnSync('node', [bot], {
    cwd: root, input: `${JSON.stringify({ ...message, type: 'STATE_UPDATE', protocolVersion: 2 })}\n`,
    encoding: 'utf8', env: { ...process.env, BOT_STRATEGY: strategy },
  });
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout.trim()) as Record<string, unknown>;
}

describe('Protocol v2 demo bot fixtures', () => {
  it('answers a v2 turn with a legal v2 action', () => {
    expect(actionFor('first', update)).toEqual({
      type: 'ACTION', protocolVersion: 2, matchId: update.matchId,
      turnId: update.turnId, action: update.legalActions[0],
    });
  });

  it('prioritizes a capture when configured to do so', () => {
    const enemySquares = new Set(update.state.pieces
      .filter((piece) => piece.owner !== update.state.turn)
      .map((piece) => `${piece.position.col}:${piece.position.row}`));
    const capture = update.legalActions.find((action) => enemySquares.has(`${action.to.col}:${action.to.row}`));
    expect(capture).toBeDefined();
    const nonCapture = update.legalActions.find((action) => action !== capture);
    expect(nonCapture).toBeDefined();
    const message = { ...update, legalActions: [nonCapture!, capture!] };
    expect(actionFor('capture', message).action).toEqual(capture);
  });

  it('answers the existing v1 preflight with a v1 action', () => {
    const message = { ...update, type: 'STATE_UPDATE', protocolVersion: 1 };
    const run = spawnSync('node', [bot], {
      cwd: root, input: `${JSON.stringify(message)}\n`, encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim())).toMatchObject({
      type: 'ACTION', protocolVersion: 1, matchId: update.matchId,
      turnId: update.turnId,
    });
  });
});
