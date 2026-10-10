import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createGame, DEFAULT_MAP, type GameConfig, type GameState } from '../src/index.ts';

const CONFIG: GameConfig = {
  gameId: 'g-contract-1',
  engineVersion: '1.0.0',
  map: DEFAULT_MAP,
  maxTurns: 200,
};

function idsOf(state: GameState): string[] {
  return state.pieces.map((piece) => piece.id);
}

describe('P1-L02 contract: createGame initial state', () => {
  it('initializes the locked counters, status and sorted pieces', () => {
    const state = createGame(CONFIG);
    expect(state.schemaVersion).toBe(1);
    expect(state.engineVersion).toBe('1.0.0');
    expect(state.gameId).toBe('g-contract-1');
    expect(state.status).toBe('PLAYING');
    expect(state.turn).toBe('X');
    expect(state.turnNumber).toBe(1);
    expect(state.turnCount).toBe(0);
    expect(state.revision).toBe(0);
    expect(state.maxTurns).toBe(200);
    expect(state.outcome).toBeNull();
    expect(state.pieces).toHaveLength(18);
    expect(idsOf(state)).toEqual([...idsOf(state)].sort());
  });

  it('reduces map to the MapRef projection (no spawns/obstacles/goals)', () => {
    const state = createGame(CONFIG);
    expect(state.map).toEqual({ mapId: 'default', version: 1, checksum: 'a'.repeat(64) });
    expect(Object.keys(state.map).sort()).toEqual(['checksum', 'mapId', 'version']);
  });

  it('leaves both goal squares empty at start', () => {
    const state = createGame(CONFIG);
    expect(state.pieces.some((piece) => piece.position.col === 8 && piece.position.row === 8)).toBe(false);
    expect(state.pieces.some((piece) => piece.position.col === 0 && piece.position.row === 0)).toBe(false);
  });
});

describe('P1-L02 contract: determinism and deep copy', () => {
  it('is deterministic for the same config', () => {
    expect(createGame(CONFIG)).toEqual(createGame(CONFIG));
  });

  it('deep-copies spawns so results never alias the map or each other', () => {
    const first = createGame(CONFIG);
    const second = createGame(CONFIG);
    expect(first.pieces).not.toBe(DEFAULT_MAP.spawns);
    expect(first.pieces[0]).not.toBe(DEFAULT_MAP.spawns[0]);
    expect(first.pieces[0]).not.toBe(second.pieces[0]);
  });

  it('never mutates the config or the default map', () => {
    const mapBefore = JSON.parse(JSON.stringify(DEFAULT_MAP)) as unknown;
    const configBefore = JSON.stringify(CONFIG);
    createGame(CONFIG);
    expect(JSON.parse(JSON.stringify(DEFAULT_MAP))).toEqual(mapBefore);
    expect(JSON.stringify(CONFIG)).toBe(configBefore);
  });
});

describe('P1-L02 contract: module boundaries', () => {
  it('game-core src imports no process, timers, network, fs or framework code', () => {
    const srcDir = new URL('../src/', import.meta.url);
    const forbidden: readonly RegExp[] = [
      /from\s+['"]node:/,
      /from\s+['"](fs|net|http|https|child_process|worker_threads)['"]/,
      /\brequire\s*\(/,
      /\bsetTimeout\b/,
      /\bsetInterval\b/,
      /\bprocess\s*\./,
      /\bDate\.now\b/,
      /\bMath\.random\b/,
    ];
    const files = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(new URL(file, srcDir), 'utf8');
      for (const pattern of forbidden) {
        expect(content, `${file} violates boundary ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });
});
