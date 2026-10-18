import { readFileSync } from 'node:fs';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  FINALS_ARTIFACT_MEDIA_TYPE,
  MAX_FINALS_ARTIFACT_BYTES,
  buildFinalsBundleArtifacts,
  findForbiddenKey,
  validateBundleArtifacts,
  type BuiltFinalsArtifact,
  type FinalsArtifactErrorCode,
  type FinalsBundleBuildInput,
  type FinalsBundleGameInput,
} from '../src/modules/result-bundles/artifacts.ts';
import { canonicalizeJson, sha256HexOf } from '../src/modules/result-bundles/canonical.ts';
import {
  createFinalsBracket,
  planSeriesGames,
  resolveBracket,
  type FinalsRound,
  type SeriesOutcomeInput,
} from '../src/modules/finals/scheduling.ts';
import {
  decideFinalsGame,
  scoreFinalsSeries,
  type FinalsGameAdapterResult,
} from '../src/modules/finals/scoring.ts';
import { seedFinals, type FinalsSeedCandidate } from '../src/modules/finals/seeding.ts';

/**
 * P3-D28 finals ResultBundle artifact tests. Pure: the data is generated with the L06 domain
 * functions, so it is coherent by construction, and every negative case tampers one thing.
 */

const ROUNDS: readonly FinalsRound[] = ['QUARTERFINAL', 'SEMIFINAL', 'FINAL', 'BRONZE'];
const MAPS = ['map-a', 'map-b', 'map-c', 'map-d'];
const ADAPTER = { adapterId: 'ott-adapter', adapterVersion: '1.0.0' };

function candidate(index: number): FinalsSeedCandidate {
  return {
    teamId: `team-${index}`,
    submissionId: `sub-${index}`,
    elo: 1600 - index * 20,
    seriesWins: 10 - index,
    gamePointDifferential: 50 - index,
    ratedSeries: 6,
  };
}

const seedingResult = seedFinals(Array.from({ length: 8 }, (_, i) => candidate(i)), { drawSeed: 'private-draw-seed' });
const TEAMS = seedingResult.locked.seeds.map(({ ordinal }) => ({
  seed: ordinal,
  teamName: `Team ${ordinal}`,
  rating: 1600 - ordinal * 20,
}));

type GameCode = 'DH' | 'DA' | 'CH' | 'CA' | 'S';
type Pick = (pairingId: string, game: number, homeSeed: number, awaySeed: number) => GameCode | null;

function adapterResultFor(code: GameCode): FinalsGameAdapterResult {
  const territory = (home: number, away: number) => ({
    criterionId: 'territory',
    direction: 'HIGHER_WINS' as const,
    home,
    away,
  });
  const turns = { criterionId: 'turns', direction: 'LOWER_WINS' as const, home: 40, away: 40 };
  switch (code) {
    case 'DH': return { directWinner: 'HOME', scoreBreakdown: [territory(9, 2), turns] };
    case 'DA': return { directWinner: 'AWAY', scoreBreakdown: [territory(2, 9), turns] };
    case 'CH': return { directWinner: null, scoreBreakdown: [territory(7, 3), turns] };
    case 'CA': return { directWinner: null, scoreBreakdown: [territory(3, 7), turns] };
    case 'S': return { directWinner: null, scoreBreakdown: [territory(4, 4), turns] };
  }
}

function replayPayload(matchId: string): Record<string, unknown> {
  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 1,
    matchId,
    header: {
      format: 'ott.match-event-log',
      formatVersion: 1,
      matchId,
      protocolVersion: 1,
      engineVersion: '1.0.0',
      game: { engineVersion: '1.0.0', maxTurns: 200, map: { id: 'map-a' } },
    },
    entries: [],
    result: { winner: 'X' },
    faults: {
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 1, recoverableConsecutive: 0, lastErrorCode: 'BOT_TIMEOUT' },
    },
  };
}

/** Plays the bracket forward asking `pick` for each game; `null` stops the series (left pending). */
function play(pick: Pick, bronzeMatchEnabled = true, withReplays = true): FinalsBundleBuildInput {
  const bracket = createFinalsBracket(seedingResult.locked, { bronzeMatchEnabled });
  const outcomes: SeriesOutcomeInput[] = [];
  const series: FinalsBundleBuildInput['series'][number][] = [];

  for (const round of ROUNDS) {
    for (const pairing of bracket.pairings.filter((entry) => entry.round === round)) {
      const row = resolveBracket(bracket, outcomes).find(({ id }) => id === pairing.id)!;
      if (row.homeSeed === null || row.awaySeed === null) continue;
      const plans = planSeriesGames({ seriesSeed: `series-seed-${pairing.id}`, mapPool: MAPS });
      const winners: ('HOME' | 'AWAY')[] = [];
      const games: FinalsBundleGameInput[] = [];
      let decided = false;
      let stopped = false;
      for (const plan of plans) {
        const code = decided || stopped ? null : pick(pairing.id, plan.game, row.homeSeed, row.awaySeed);
        if (code === null) {
          if (!decided) stopped = true;
          games.push({ plan, state: decided ? 'CANCELLED' : 'SCHEDULED' });
          continue;
        }
        const adapterResult = adapterResultFor(code);
        const decision = decideFinalsGame(adapterResult, {
          ...ADAPTER,
          pinnedAdapterId: ADAPTER.adapterId,
          pinnedAdapterVersion: ADAPTER.adapterVersion,
          homeSeed: row.homeSeed,
          awaySeed: row.awaySeed,
        });
        winners.push(decision.winner);
        decided = scoreFinalsSeries(winners).state === 'FINALIZED';
        const matchId = `m-${pairing.id}-${plan.game}`;
        games.push({
          plan,
          state: 'FINALIZED',
          finalized: {
            matchId,
            ...ADAPTER,
            adapterResult,
            reason: 'MAX_TURNS',
            turnCount: 100 + plan.game,
            finalStateHash: sha256HexOf(`state:${matchId}`),
            faults: {
              X: { recoverableTotal: 0, lastErrorCode: null },
              O: { recoverableTotal: 2, lastErrorCode: 'BOT_TIMEOUT' },
            },
            eventLogSha256: sha256HexOf(`log:${matchId}`),
            ...(withReplays && plan.game === 1 ? { replay: replayPayload(matchId) } : {}),
          },
        });
      }
      if (games[0]!.state === 'SCHEDULED') continue;
      const score = scoreFinalsSeries(winners);
      outcomes.push({
        pairingId: pairing.id,
        state: score.state === 'FINALIZED' ? 'FINALIZED' : 'SCHEDULED',
        winnerSeed: score.winner === null ? null : score.winner === 'HOME' ? row.homeSeed : row.awaySeed,
      });
      series.push({ pairingId: pairing.id, games });
    }
  }
  return {
    tournamentId: 'tournament-1',
    finalsRuleSetId: 'finals-rules-1',
    seeding: seedingResult.locked,
    bracket,
    teams: TEAMS,
    series,
  };
}

const FULL_SCRIPT: Record<string, GameCode[]> = {
  QF1: ['S', 'S'], // 1 v 8: decided by QUALIFICATION_SEED, 2-0
  QF2: ['DH', 'DA', 'CH'], // 4 v 5: 2-1, clincher by CRITERION
  QF3: ['DA', 'DA'], // 2 v 7: upset 2-0
  QF4: ['CH', 'CH'], // 3 v 6
  SF1: ['DH', 'DA', 'DH'],
  SF2: ['DA', 'DA'],
  F1: ['DH', 'DH'],
  B1: ['CA', 'DH', 'DH'],
};
const scripted =
  (script: Record<string, GameCode[]>): Pick =>
  (pairingId, game) =>
    script[pairingId]?.[game - 1] ?? null;

function fullFinals(bronze = true): FinalsBundleBuildInput {
  return play(scripted(FULL_SCRIPT), bronze);
}

function toBytes(artifacts: readonly BuiltFinalsArtifact[]) {
  return artifacts.map(({ path, mediaType, payload }) => ({ path, mediaType, bytes: payload }));
}

type Bytes = ReturnType<typeof toBytes>;

function codes(result: ReturnType<typeof validateBundleArtifacts>): FinalsArtifactErrorCode[] {
  return result.ok ? [] : result.errors.map(({ code }) => code);
}

function mutate(artifacts: Bytes, path: string, change: (json: any) => void): Bytes {
  return artifacts.map((artifact) => {
    if (artifact.path !== path) return artifact;
    const json = JSON.parse(Buffer.from(artifact.bytes).toString('utf8'));
    change(json);
    return { ...artifact, bytes: Buffer.from(canonicalizeJson(json), 'utf8') };
  });
}

function without(artifacts: Bytes, path: string): Bytes {
  return artifacts.filter((artifact) => artifact.path !== path);
}

function digestOf(artifacts: readonly BuiltFinalsArtifact[]): string {
  return sha256HexOf(artifacts.map(({ path, payload }) => `${path}:${sha256HexOf(payload)}`).join('\n'));
}

const GOLDEN_DIGEST = '5778b8a70bfc04742f277ff5352b17abc7f030b5ed48a4c824c606c895797b90';

describe('finals bundle artifacts: coherent finals', () => {
  const built = buildFinalsBundleArtifacts(fullFinals());
  const bytes = toBytes(built);

  it('validates and exposes the recomputed read model', () => {
    const result = validateBundleArtifacts(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.value;
    expect(view.pairings.map(({ id }) => id)).toEqual(['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'F1', 'B1']);
    const byId = new Map(view.pairings.map((pairing) => [pairing.id, pairing]));
    expect(byId.get('QF1')).toMatchObject({ homeSeed: 1, awaySeed: 8, winnerSeed: 1, loserSeed: 8, state: 'FINALIZED' });
    expect(byId.get('QF1')!.series!.outcome).toEqual({
      winnerSeed: 1, loserSeed: 8, homeGameWins: 2, awayGameWins: 0, decisionBasis: 'QUALIFICATION_SEED',
    });
    expect(byId.get('QF2')!.series!.outcome).toMatchObject({ homeGameWins: 2, awayGameWins: 1, decisionBasis: 'CRITERION' });
    expect(byId.get('QF3')).toMatchObject({ winnerSeed: 7, loserSeed: 2 });
    expect(byId.get('QF3')!.series!.outcome.decisionBasis).toBe('DIRECT');
    expect(byId.get('F1')).toMatchObject({ homeSeed: 1, awaySeed: 3, winnerSeed: 1, loserSeed: 3 });
    expect(byId.get('B1')).toMatchObject({ homeSeed: 4, awaySeed: 7, winnerSeed: 4 });
    expect(byId.get('QF1')!.series!.games.map(({ state }) => state)).toEqual(['FINALIZED', 'FINALIZED', 'CANCELLED']);
    expect(view.seeds).toHaveLength(8);
    expect(view.drawSeedCommitment).toBe(sha256HexOf('private-draw-seed'));
    expect(view.matches).toHaveLength(19);
    expect(view.replayMatchIds).toContain('m-F1-1');
    expect(view.bronzeMatchEnabled).toBe(true);
  });

  it('never publishes the draw seed or team identifiers', () => {
    const all = built.map(({ payload }) => payload.toString('utf8')).join('\n');
    expect(all).not.toContain('private-draw-seed');
    expect(all).not.toContain('team-1');
    expect(all).not.toContain('sub-1');
  });

  it('is deterministic: same bytes twice and a stable golden digest', () => {
    const again = buildFinalsBundleArtifacts(fullFinals());
    expect(again.map(({ path }) => path)).toEqual(built.map(({ path }) => path));
    expect(again.every((artifact, index) => artifact.payload.equals(built[index]!.payload))).toBe(true);
    expect(built[0]!.path).toBe('bracket.json');
    expect(digestOf(built)).toBe(GOLDEN_DIGEST);
  });

  it('validates a bracket without a bronze match', () => {
    const result = validateBundleArtifacts(toBytes(buildFinalsBundleArtifacts(fullFinals(false))));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pairings.some(({ round }) => round === 'BRONZE')).toBe(false);
      expect(result.value.bronzeMatchEnabled).toBe(false);
    }
  });

  it('accepts a partly played finals with pending pairings', () => {
    const partial = play(scripted({ QF1: ['DH', 'DA'], QF2: ['DH', 'DH'] }));
    const result = validateBundleArtifacts(toBytes(buildFinalsBundleArtifacts(partial)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byId = new Map(result.value.pairings.map((pairing) => [pairing.id, pairing]));
      expect(byId.get('QF1')).toMatchObject({ state: 'PENDING', winnerSeed: null });
      expect(byId.get('QF1')!.series!.state).toBe('PENDING');
      expect(byId.get('QF2')).toMatchObject({ state: 'FINALIZED', winnerSeed: 4 });
      expect(byId.get('SF1')).toMatchObject({ homeSeed: null, awaySeed: 4, state: 'PENDING', series: null });
    }
  });

  it('matches the machine schema for every artifact', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../../../docs/contracts/finals-result-bundle-artifacts-v1.schema.json', import.meta.url), 'utf8'),
    );
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(schema);
    const pick = (path: string) =>
      path === 'bracket.json' ? 'bracket'
        : path.startsWith('series/') ? 'series'
          : path.startsWith('matches/') ? 'match'
            : 'replayEnvelope';
    for (const artifact of built) {
      const validate = ajv.getSchema(`${schema.$id}#/$defs/${pick(artifact.path)}`)!;
      expect(validate(JSON.parse(artifact.payload.toString('utf8'))), `${artifact.path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });
});

describe('finals bundle artifacts: tampering', () => {
  const base = toBytes(buildFinalsBundleArtifacts(fullFinals()));

  it('rejects a tampered series winner (OUTCOME_MISMATCH)', () => {
    const tampered = mutate(base, 'series/QF1.json', (json) => {
      json.outcome.winnerSeed = 8;
      json.outcome.loserSeed = 1;
    });
    expect(codes(validateBundleArtifacts(tampered))).toContain('OUTCOME_MISMATCH');
  });

  it('rejects a tampered resolved winner (OUTCOME_MISMATCH)', () => {
    const tampered = mutate(base, 'bracket.json', (json) => {
      json.resolved[0].winnerSeed = 8;
      json.resolved[0].loserSeed = 1;
    });
    expect(codes(validateBundleArtifacts(tampered))).toContain('OUTCOME_MISMATCH');
  });

  it('rejects a tampered game winner side and a tampered decision basis', () => {
    const side = mutate(base, 'matches/m-QF1-1.json', (json) => {
      json.result.winnerSide = json.result.winnerSide === 'X' ? 'O' : 'X';
    });
    expect(codes(validateBundleArtifacts(side))).toContain('OUTCOME_MISMATCH');
    const basis = mutate(base, 'series/QF1.json', (json) => {
      json.outcome.decisionBasis = 'DIRECT';
    });
    expect(codes(validateBundleArtifacts(basis))).toContain('OUTCOME_MISMATCH');
  });

  it('rejects a missing bracket.json', () => {
    expect(codes(validateBundleArtifacts(without(base, 'bracket.json')))).toContain('BRACKET_MISSING');
  });

  it('rejects duplicate and unsupported paths', () => {
    const bracket = base.find(({ path }) => path === 'bracket.json')!;
    expect(codes(validateBundleArtifacts([...base, bracket]))).toContain('ARTIFACT_PATH_DUPLICATE');
    for (const path of ['secret.env', '../x.json', 'series/a/b.json', 'series/QF 1.json', 'replays/x.txt']) {
      const result = validateBundleArtifacts([...base, { path, mediaType: FINALS_ARTIFACT_MEDIA_TYPE, bytes: Buffer.from('{}') }]);
      expect(codes(result), path).toContain('ARTIFACT_PATH_UNSUPPORTED');
    }
  });

  it('rejects an orphan series and a missing series for a finalized pairing', () => {
    const series = base.find(({ path }) => path === 'series/QF1.json')!;
    const orphan = [...base, { ...series, path: 'series/ZZ.json' }];
    const renamed = mutate(orphan, 'series/ZZ.json', (json) => {
      json.pairingId = 'ZZ';
    });
    expect(codes(validateBundleArtifacts(renamed))).toContain('SERIES_ORPHAN');
    expect(codes(validateBundleArtifacts(without(base, 'series/QF1.json')))).toContain('SERIES_MISSING');
  });

  it('rejects a match that belongs to no series game and a game without its match', () => {
    const unknown = mutate(base, 'matches/m-QF1-1.json', (json) => {
      json.pairingId = 'SF2';
    });
    expect(codes(validateBundleArtifacts(unknown))).toContain('MATCH_ORPHAN');
    expect(codes(validateBundleArtifacts(without(base, 'matches/m-QF1-1.json')))).toContain('MATCH_MISSING');
  });

  it('rejects invalid game lists', () => {
    const sides = mutate(base, 'series/QF1.json', (json) => {
      json.games[1].homeSide = 'X';
      json.games[1].awaySide = 'O';
    });
    expect(codes(validateBundleArtifacts(sides))).toContain('GAMES_INVALID');
    const maps = mutate(base, 'series/QF1.json', (json) => {
      json.games[1].mapId = json.games[0].mapId;
    });
    expect(codes(validateBundleArtifacts(maps))).toContain('GAMES_INVALID');
  });

  it('rejects a game played after the series was decided', () => {
    const extra = mutate(base, 'series/QF1.json', (json) => {
      json.games[2].state = 'FINALIZED';
      json.games[2].matchId = 'm-QF1-1';
    });
    expect(validateBundleArtifacts(extra).ok).toBe(false);
  });

  it('rejects replay references with the wrong digest, a wrong matchId or no reference', () => {
    const digest = mutate(base, 'matches/m-F1-1.json', (json) => {
      json.replay.sha256 = '0'.repeat(64);
    });
    expect(codes(validateBundleArtifacts(digest))).toContain('REPLAY_REF_INVALID');
    const other = mutate(base, 'replays/m-F1-1.json', (json) => {
      json.matchId = 'm-QF1-1';
    });
    expect(codes(validateBundleArtifacts(other))).toContain('REPLAY_REF_INVALID');
    const unreferenced = mutate(base, 'matches/m-F1-1.json', (json) => {
      json.replay = { path: null, sha256: null };
    });
    expect(codes(validateBundleArtifacts(unreferenced))).toContain('REPLAY_ORPHAN');
  });

  it('rejects forbidden keys but accepts the public seed ordinals', () => {
    expect(validateBundleArtifacts(base).ok).toBe(true);
    const cases: [string, (json: any) => void][] = [
      ['bracket.json', (json) => { json.password = 'x'; }],
      ['matches/m-QF1-1.json', (json) => { json.stderr = 'trace'; }],
      ['matches/m-QF1-1.json', (json) => { json.objectKey = 'k'; }],
      ['bracket.json', (json) => { json.seed = 'abc'; }],
      ['bracket.json', (json) => { json.seeds[0].drawSeed = 'abc'; }],
      ['replays/m-F1-1.json', (json) => { json.header.seed = 'abc'; }],
    ];
    for (const [path, change] of cases) {
      expect(codes(validateBundleArtifacts(mutate(base, path, change))), path).toContain('FORBIDDEN_FIELD');
    }
  });

  it('rejects oversized artifacts, unknown properties and wrong versions', () => {
    const bracket = base.find(({ path }) => path === 'bracket.json')!;
    const big = Buffer.concat([Buffer.from(bracket.bytes), Buffer.alloc(MAX_FINALS_ARTIFACT_BYTES, 0x20)]);
    expect(codes(validateBundleArtifacts(base.map((a) => (a === bracket ? { ...a, bytes: big } : a))))).toContain('ARTIFACT_TOO_LARGE');
    expect(codes(validateBundleArtifacts(mutate(base, 'series/QF1.json', (json) => { json.note = 'x'; })))).toContain('ARTIFACT_SCHEMA_INVALID');
    expect(codes(validateBundleArtifacts(mutate(base, 'series/QF1.json', (json) => { json.schemaVersion = 2; })))).toContain('ARTIFACT_VERSION_UNSUPPORTED');
    expect(codes(validateBundleArtifacts(mutate(base, 'series/QF1.json', (json) => { delete json.outcome; })))).toContain('ARTIFACT_SCHEMA_INVALID');
  });

  it('rejects a media type mismatch, invalid JSON and an id that differs from the path', () => {
    expect(codes(validateBundleArtifacts(base.map((a) => (a.path === 'bracket.json' ? { ...a, mediaType: 'text/plain' } : a)))))
      .toContain('ARTIFACT_MEDIATYPE_INVALID');
    expect(codes(validateBundleArtifacts(base.map((a) => (a.path === 'bracket.json' ? { ...a, bytes: Buffer.from('{') } : a)))))
      .toContain('ARTIFACT_JSON_INVALID');
    expect(codes(validateBundleArtifacts(mutate(base, 'series/QF1.json', (json) => { json.pairingId = 'QF2'; }))))
      .toContain('ARTIFACT_ID_MISMATCH');
  });

  it('rejects a bracket with 7 seeds, a different pairing list or inconsistent resolved rows', () => {
    const seven = mutate(base, 'bracket.json', (json) => { json.seeds.pop(); });
    expect(codes(validateBundleArtifacts(seven))).toContain('BRACKET_STRUCTURE_MISMATCH');
    const pairings = mutate(base, 'bracket.json', (json) => {
      [json.pairings[0].home, json.pairings[0].away] = [json.pairings[0].away, json.pairings[0].home];
    });
    expect(codes(validateBundleArtifacts(pairings))).toContain('BRACKET_STRUCTURE_MISMATCH');
    const bronze = mutate(base, 'bracket.json', (json) => { json.bronzeMatchEnabled = false; });
    expect(codes(validateBundleArtifacts(bronze))).toContain('BRACKET_STRUCTURE_MISMATCH');
    const rank = mutate(base, 'bracket.json', (json) => { json.seeds[0].qualificationRank = 2; });
    expect(codes(validateBundleArtifacts(rank))).toContain('BRACKET_STRUCTURE_MISMATCH');
  });

  it('rejects an adapter that drifts inside one bundle', () => {
    const drift = mutate(base, 'matches/m-QF2-1.json', (json) => { json.adapter.adapterVersion = '9.9.9'; });
    expect(codes(validateBundleArtifacts(drift))).toContain('ADAPTER_INCONSISTENT');
  });
});

describe('forbidden key scan', () => {
  it('allows public ordinals only where the schema defines them', () => {
    expect(findForbiddenKey({ seeds: [{ seed: 1 }] })).toBeNull();
    expect(findForbiddenKey({ pairings: [{ home: { kind: 'SEED', seed: 1 } }] })).toBeNull();
    expect(findForbiddenKey({ winnerSeed: 1, loserSeed: 2, homeSeed: 3, awaySeed: 4, qualificationRank: 1, seedingHash: 'x' })).toBeNull();
    expect(findForbiddenKey({ seed: 1 })).toBe('seed');
    expect(findForbiddenKey({ seeds: [{ seed: 1, token: 't' }] })).toBe('seeds.[].token');
    expect(findForbiddenKey({ a: [{ b: { drawSeed: 'x' } }] })).toBe('a.[].b.drawSeed');
    expect(findForbiddenKey({ credentials: 1 })).toBe('credentials');
  });
});

describe('finals bundle artifacts: random coherent finals', () => {
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('builds and validates 50 random result patterns', () => {
    const codesList: GameCode[] = ['DH', 'DA', 'CH', 'CA', 'S'];
    for (let run = 0; run < 50; run += 1) {
      const random = rng(run + 1);
      const pick: Pick = () => (random() < 0.1 ? null : codesList[Math.floor(random() * codesList.length)]!);
      const input = play(pick, random() < 0.7);
      const built = buildFinalsBundleArtifacts(input);
      const result = validateBundleArtifacts(toBytes(built));
      expect(codes(result), `run ${run}`).toEqual([]);
      expect(result.ok, `run ${run}`).toBe(true);
      expect(digestOf(buildFinalsBundleArtifacts(input))).toBe(digestOf(built));
    }
  });
});
