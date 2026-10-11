/**
 * Pure CLI argument parser and configuration validator for `@ott/match-runner` (P1-D08).
 *
 * Implements strict argument validation using `node:util` `parseArgs`:
 * - Unknown flags and positionals are rejected.
 * - String and integer values are strictly validated.
 * - Executable and arguments are collected separately (no shell splitting or expansion).
 * - No I/O or child processes; `@ott/game-core` is imported for types only.
 */

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { DEFAULT_LIMITS, type Limits } from '@ott/bot-protocol';
import type { GameConfig, MapDefinition, PlayerSide } from '@ott/game-core';

/** Canonical Bot Protocol JSON Schema path resolved relative to module location. */
export const DEFAULT_SCHEMA_PATH = fileURLToPath(
  new URL('../../../docs/contracts/bot-protocol-v1.schema.json', import.meta.url),
);

/** 64-hex SHA-256 checksum for the minimal fake map. */
export const DEFAULT_MAP_CHECKSUM = '0'.repeat(64);

/** Minimal 2-spawn map definition used with FakeGame until P1-D09. */
export const DEFAULT_FAKE_MAP: MapDefinition = {
  schemaVersion: 1,
  mapId: 'fake-map',
  version: 1,
  checksum: DEFAULT_MAP_CHECKSUM,
  width: 9,
  height: 9,
  obstacles: [],
  spawns: [
    { id: 'X1', owner: 'X', type: 'ROCK', position: { col: 0, row: 0 } },
    { id: 'O1', owner: 'O', type: 'PAPER', position: { col: 8, row: 8 } },
  ],
  goals: {
    X: { col: 8, row: 8 },
    O: { col: 0, row: 0 },
  },
};

export interface BotCliConfig {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface CliConfig {
  readonly matchId: string;
  readonly seed: string;
  readonly game: GameConfig;
  readonly limits: Limits;
  readonly bots: Readonly<Record<PlayerSide, BotCliConfig>>;
  readonly outPath: string;
  readonly schemaPath: string;
}

export type ParseCliArgsResult =
  | { readonly ok: true; readonly config: CliConfig }
  | { readonly ok: true; readonly help: true }
  | { readonly ok: false; readonly errors: readonly string[] };

const MATCH_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function normalizeArgv(argv: readonly string[]): string[] {
  const normalized: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if ((arg === '--bot-x-arg' || arg === '--bot-o-arg') && i + 1 < argv.length) {
      const next = argv[++i] ?? '';
      normalized.push(`${arg}=${next}`);
    } else {
      normalized.push(arg);
    }
  }
  return normalized;
}

/**
 * Pure argv parser converting command-line arguments to a validated `CliConfig`.
 * Collects all configuration errors rather than aborting on the first one.
 */
export function parseCliArgs(argv: readonly string[]): ParseCliArgsResult {
  const options = {
    'bot-x': { type: 'string' },
    'bot-o': { type: 'string' },
    'bot-x-arg': { type: 'string', multiple: true },
    'bot-o-arg': { type: 'string', multiple: true },
    out: { type: 'string' },
    'match-id': { type: 'string' },
    seed: { type: 'string' },
    'max-turns': { type: 'string' },
    'turn-timeout-ms': { type: 'string' },
    'startup-timeout-ms': { type: 'string' },
    schema: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } as const;

  let parsed: ReturnType<typeof parseArgs<{ options: typeof options; strict: true; allowPositionals: false }>>;
  try {
    parsed = parseArgs({
      args: normalizeArgv(argv),
      options,
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  if (parsed.values.help) {
    return { ok: true, help: true };
  }

  const errors: string[] = [];

  const botX = parsed.values['bot-x'];
  if (!botX || botX.trim() === '') {
    errors.push('Option --bot-x is required and must not be empty');
  }

  const botO = parsed.values['bot-o'];
  if (!botO || botO.trim() === '') {
    errors.push('Option --bot-o is required and must not be empty');
  }

  const out = parsed.values.out;
  if (!out || out.trim() === '') {
    errors.push('Option --out is required and must not be empty');
  }

  const rawMatchId = parsed.values['match-id'];
  let matchId = 'local-match';
  if (rawMatchId !== undefined) {
    if (rawMatchId.length < 1 || rawMatchId.length > 128 || !MATCH_ID_REGEX.test(rawMatchId)) {
      errors.push(
        'Option --match-id must be 1-128 characters matching ^[A-Za-z0-9][A-Za-z0-9._:-]*$',
      );
    } else {
      matchId = rawMatchId;
    }
  }

  const seed = parsed.values.seed ?? '0';

  let maxTurns = DEFAULT_LIMITS.maxTurns;
  const rawMaxTurns = parsed.values['max-turns'];
  if (rawMaxTurns !== undefined) {
    if (!/^\d+$/.test(rawMaxTurns) || Number(rawMaxTurns) < 1) {
      errors.push('Option --max-turns must be an integer >= 1');
    } else {
      maxTurns = Number(rawMaxTurns);
    }
  }

  let turnTimeoutMs = DEFAULT_LIMITS.turnTimeoutMs;
  const rawTurnTimeoutMs = parsed.values['turn-timeout-ms'];
  if (rawTurnTimeoutMs !== undefined) {
    if (!/^\d+$/.test(rawTurnTimeoutMs) || Number(rawTurnTimeoutMs) < 1) {
      errors.push('Option --turn-timeout-ms must be an integer >= 1');
    } else {
      turnTimeoutMs = Number(rawTurnTimeoutMs);
    }
  }

  let startupTimeoutMs = DEFAULT_LIMITS.startupTimeoutMs;
  const rawStartupTimeoutMs = parsed.values['startup-timeout-ms'];
  if (rawStartupTimeoutMs !== undefined) {
    if (!/^\d+$/.test(rawStartupTimeoutMs) || Number(rawStartupTimeoutMs) < 1) {
      errors.push('Option --startup-timeout-ms must be an integer >= 1');
    } else {
      startupTimeoutMs = Number(rawStartupTimeoutMs);
    }
  }

  const rawSchema = parsed.values.schema;
  let schemaPath = DEFAULT_SCHEMA_PATH;
  if (rawSchema !== undefined) {
    if (rawSchema.trim() === '') {
      errors.push('Option --schema must not be empty');
    } else {
      schemaPath = rawSchema;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const config: CliConfig = {
    matchId,
    seed,
    game: {
      gameId: matchId,
      engineVersion: '1.0.0',
      map: DEFAULT_FAKE_MAP,
      maxTurns,
    },
    limits: {
      ...DEFAULT_LIMITS,
      maxTurns,
      turnTimeoutMs,
      startupTimeoutMs,
    },
    bots: {
      X: {
        executable: botX!,
        args: (parsed.values['bot-x-arg'] as string[] | undefined) ?? [],
      },
      O: {
        executable: botO!,
        args: (parsed.values['bot-o-arg'] as string[] | undefined) ?? [],
      },
    },
    outPath: out!,
    schemaPath,
  };

  return { ok: true, config };
}
