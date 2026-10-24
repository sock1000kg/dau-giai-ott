import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  DEFAULT_LIMITS,
  type InitMessage,
  type InitMessageV2,
  type StateUpdateMessage,
  type StateUpdateMessageV2,
  type TurnResultMessage,
  type TurnResultMessageV2,
  type MatchResultMessage,
  type MatchResultMessageV2,
  type TimeControlV2,
} from '@ott/bot-protocol';
import { DEFAULT_MAP, GOALS, type GameAction } from '@ott/game-core';
import {
  CoreGameAdapter,
  runMatch,
  serializeEventLog,
  type AnyEventLog,
  type EventLogV1,
  type EventLogV2,
  type BotPort,
  type BotReply,
  type BotStartResult,
  FakeClock,
} from '@ott/match-runner';

import { publicEventLog } from '../replays/service.ts';
import {
  buildFinalsBundleArtifacts,
  validateBundleArtifacts,
  type FinalsBundleBuildInput,
  type FinalsBundleGameInput,
} from './artifacts.ts';
import { sha256HexOf } from './canonical.ts';
import { buildSignedResultBundle, type SignedResultBundle } from './exporter.ts';
import { computeKeyFingerprint } from './keys.ts';
import {
  createFinalsBracket,
  planSeriesGames,
  resolveBracket,
  type FinalsRound,
  type SeriesOutcomeInput,
} from '../finals/scheduling.ts';
import { decideFinalsGame, scoreFinalsSeries, type FinalsGameAdapterResult } from '../finals/scoring.ts';
import { seedFinals, type FinalsSeedCandidate } from '../finals/seeding.ts';
import type { ResultBundleManifestV1 } from './importer.ts';

export const DEMO_FINALS_CREATED_AT = '2026-10-24T00:00:00.000Z';
export const DEMO_TOURNAMENT_ID = 'OTT_DEMO_FINALS_2026';
export const DEMO_RULE_SET_ID = 'finals-rules-demo-v1';
export const DEMO_BUNDLE_ID = 'demo-finals-bundle-2026';
export const DEMO_BUNDLE_VERSION = 1;
export const DEMO_KEY_ID = 'demo-finals-key';

const ROUNDS: readonly FinalsRound[] = ['QUARTERFINAL', 'SEMIFINAL', 'FINAL', 'BRONZE'];
const MAPS = ['map-standard-01', 'map-standard-02', 'map-tactical-01', 'map-tactical-02'];
const ADAPTER = { adapterId: 'ott-arena-adapter', adapterVersion: '1.0.0' } as const;

function candidate(seedIndex: number): FinalsSeedCandidate {
  return {
    teamId: `team-seed-${seedIndex}`,
    submissionId: `sub-team-0${seedIndex}`,
    elo: 1800 - seedIndex * 35,
    seriesWins: 14 - seedIndex,
    gamePointDifferential: 80 - seedIndex * 5,
    ratedSeries: 10,
  };
}

const PAIRING_NUMBERS: Record<string, number> = {
  QF1: 1,
  QF2: 2,
  QF3: 3,
  QF4: 4,
  SF1: 5,
  SF2: 6,
  B1: 7,
  F1: 8,
};

function formatDeterministicMatchId(pairingId: string, gameNumber: number): string {
  const pNum = PAIRING_NUMBERS[pairingId] ?? 9;
  const numPart = `${String(pNum).padStart(2, '0')}${String(gameNumber).padStart(2, '0')}`;
  return `00000000-0000-4000-8000-${numPart.padStart(12, '0')}`;
}

export type DemoStrategy = 'first' | 'last' | 'capture' | 'advance';

export const DEMO_STRATEGIES: readonly DemoStrategy[] = ['advance', 'capture', 'first', 'last'];

/**
 * Deterministic X/O strategy pairings, picked per game by index. Mixed on purpose: `first` vs `first`
 * always draws on the default layout (TURN_LIMIT), while `advance` races to the goal and decides games.
 */
const DEMO_PAIRINGS: readonly Readonly<Record<'X' | 'O', DemoStrategy>>[] = [
  { X: 'advance', O: 'advance' },
  { X: 'first', O: 'advance' },
  { X: 'first', O: 'first' },
  { X: 'advance', O: 'first' },
  { X: 'capture', O: 'first' },
  { X: 'advance', O: 'capture' },
  { X: 'last', O: 'first' },
  { X: 'advance', O: 'last' },
];

function chebyshev(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

function chooseDemoAction(
  strategy: DemoStrategy,
  side: 'X' | 'O',
  update: StateUpdateMessage | StateUpdateMessageV2,
): GameAction | undefined {
  const actions = update.legalActions;
  if (actions.length === 0) return undefined;
  const pieces = (update.state as { pieces: readonly { owner: string; position: { col: number; row: number } }[] }).pieces;
  const isCapture = (action: GameAction) =>
    pieces.some((p) => p.owner !== side && p.position.col === action.to.col && p.position.row === action.to.row);
  if (strategy === 'first') return actions[0];
  if (strategy === 'last') return actions[actions.length - 1];
  if (strategy === 'capture') return actions.find(isCapture) ?? actions[0];
  const goal = GOALS[side];
  let best = actions[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const action of actions) {
    const score = chebyshev(action.to, goal) * 2 - (isCapture(action) ? 1 : 0);
    if (score < bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return best;
}

export const DEMO_TIME_CONTROL: TimeControlV2 = {
  startupMs: 5000,
  totalBotBudgetMs: 60000,
  matchWallClockMs: 150000,
  perTurn: { mode: 'FIXED', fixedMs: 3000 },
};

class DemoActionBot implements BotPort {
  #protocolVersion: 1 | 2 = 2;
  #side: 'X' | 'O' = 'X';

  readonly #strategy: DemoStrategy;
  readonly #clock: FakeClock;

  constructor(strategy: DemoStrategy, clock: FakeClock) {
    this.#strategy = strategy;
    this.#clock = clock;
  }

  async start(init: InitMessage | InitMessageV2): Promise<BotStartResult> {
    this.#protocolVersion = init.protocolVersion;
    this.#side = init.side;
    return { ok: true };
  }

  async requestAction(
    update: StateUpdateMessage | StateUpdateMessageV2,
    _timeoutMs: number,
  ): Promise<BotReply> {
    this.#clock.advance(50);
    const chosen = chooseDemoAction(this.#strategy, this.#side, update);
    if (!chosen) {
      return { ok: false, code: 'SCHEMA_VIOLATION' };
    }
    const message: any = {
      type: 'ACTION',
      turnId: update.turnId,
      action: chosen,
      protocolVersion: 2,
      matchId: update.matchId,
    };
    return { ok: true, message };
  }

  async notifyStateUpdate(_update: StateUpdateMessage | StateUpdateMessageV2): Promise<void> {}
  async sendTurnResult(_message: TurnResultMessage | TurnResultMessageV2): Promise<void> {}
  async finish(_message: MatchResultMessage | MatchResultMessageV2): Promise<void> {}
  async stop(): Promise<void> {}
}

interface DemoGameOutcome {
  readonly replay: Record<string, unknown>;
  readonly reason: string;
  readonly turnCount: number;
  readonly finalStateHash: string;
  readonly winnerSide: 'X' | 'O' | null;
  /** Real final-engine-state counts per side. */
  readonly piecesLeft: { readonly X: number; readonly O: number };
  readonly goalDistance: { readonly X: number; readonly O: number };
  readonly faults: {
    readonly X: { readonly recoverableTotal: number; readonly lastErrorCode: string | null };
    readonly O: { readonly recoverableTotal: number; readonly lastErrorCode: string | null };
  };
  readonly eventLogSha256: string;
  /** The un-projected log the hash was computed over; kept so tests can recompute the digest. */
  readonly sourceLog: AnyEventLog;
}

/**
 * Executes a deterministic, valid match with match-runner and projects it with publicEventLog.
 * The engine ships a single map layout (obstacles are not implemented), so every game plays
 * `DEFAULT_MAP`; `plan.mapId` is the scheduled label only.
 */
export async function generateDeterministicReplay(
  matchId: string,
  strategies: Readonly<Record<'X' | 'O', DemoStrategy>>,
): Promise<DemoGameOutcome> {
  const game = new CoreGameAdapter();
  const gameConfig = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 40 };
  const clock = new FakeClock(0);
  const botSeeds = {
    X: createHash('sha256').update(`demo-bot-seed-X-${matchId}`).digest('hex'),
    O: createHash('sha256').update(`demo-bot-seed-O-${matchId}`).digest('hex'),
  };

  const report = await runMatch(
    {
      matchId,
      seed: `demo-seed-${matchId}`,
      game: gameConfig,
      limits: { ...DEFAULT_LIMITS, maxTurns: 40 },
      protocolV2: {
        timeControl: DEMO_TIME_CONTROL,
        botSeeds,
      },
    },
    {
      game,
      bots: {
        X: new DemoActionBot(strategies.X, clock),
        O: new DemoActionBot(strategies.O, clock),
      },
      clock,
    },
  );

  const replay = publicEventLog(
    report.log,
    matchId,
    report.log.footer.result.finalStateHash,
  ) as unknown as Record<string, unknown>;

  const serializedSourceLog = serializeEventLog(report.log);
  const eventLogSha256 = sha256HexOf(Buffer.from(serializedSourceLog, 'utf8'));

  const owned = (side: 'X' | 'O') => report.finalState.pieces.filter((p) => p.owner === side);
  const distance = (side: 'X' | 'O') =>
    Math.min(...owned(side).map((p) => chebyshev(p.position, GOALS[side])), 99);

  return {
    replay,
    reason: report.log.footer.result.reason,
    turnCount: report.log.footer.result.turnCount,
    finalStateHash: report.log.footer.result.finalStateHash,
    winnerSide: report.log.footer.result.winnerSide,
    piecesLeft: { X: owned('X').length, O: owned('O').length },
    goalDistance: { X: distance('X'), O: distance('O') },
    faults: {
      X: { recoverableTotal: report.faults.X.recoverableTotal, lastErrorCode: report.faults.X.lastErrorCode },
      O: { recoverableTotal: report.faults.O.recoverableTotal, lastErrorCode: report.faults.O.lastErrorCode },
    },
    eventLogSha256,
    sourceLog: report.log,
  };
}

export interface DemoTournamentOptions {
  /** When given, receives the source (un-projected) event log of every played game, by matchId. */
  readonly sourceLogs?: Map<string, AnyEventLog>;
}

export async function createSyntheticDemoTournament(
  options: DemoTournamentOptions = {},
): Promise<FinalsBundleBuildInput> {
  const seedingCandidates = [1, 2, 3, 4, 5, 6, 7, 8].map(candidate);
  const seeded = seedFinals(seedingCandidates, { drawSeed: 'demo-finals-draw-seed-2026' });
  const bracket = createFinalsBracket(seeded.locked, { bronzeMatchEnabled: true });

  const teams = seeded.locked.seeds.map(({ ordinal }) => ({
    seed: ordinal,
    teamName: `Team 0${ordinal}`,
    rating: 1800 - ordinal * 35,
  }));

  const outcomes: SeriesOutcomeInput[] = [];
  const series: FinalsBundleBuildInput['series'][number][] = [];

  for (const round of ROUNDS) {
    for (const pairing of bracket.pairings.filter((entry) => entry.round === round)) {
      const row = resolveBracket(bracket, outcomes).find(({ id }) => id === pairing.id);
      if (!row || row.homeSeed === null || row.awaySeed === null) continue;

      const plans = planSeriesGames({ seriesSeed: `demo-series-seed-${pairing.id}`, mapPool: MAPS });
      const winners: ('HOME' | 'AWAY')[] = [];
      const games: FinalsBundleGameInput[] = [];
      let decided = false;

      const pairingNumber = PAIRING_NUMBERS[pairing.id] ?? 9;

      for (const plan of plans) {
        if (decided) {
          games.push({ plan, state: 'CANCELLED' });
          continue;
        }

        const matchId = formatDeterministicMatchId(pairing.id, plan.game);
        const index = pairingNumber + plan.game;
        const strategies = DEMO_PAIRINGS[index % DEMO_PAIRINGS.length]!;
        const replayData = await generateDeterministicReplay(matchId, strategies);
        options.sourceLogs?.set(matchId, replayData.sourceLog);

        const homeIsX = plan.homeSide === 'X';
        const homeOf = <T,>(v: { X: T; O: T }) => (homeIsX ? v.X : v.O);
        const awayOf = <T,>(v: { X: T; O: T }) => (homeIsX ? v.O : v.X);
        const directWinner =
          replayData.winnerSide === null ? null : replayData.winnerSide === plan.homeSide ? 'HOME' : 'AWAY';
        const adapterResult: FinalsGameAdapterResult = {
          directWinner,
          scoreBreakdown: [
            {
              criterionId: 'pieces-left',
              direction: 'HIGHER_WINS' as const,
              home: homeOf(replayData.piecesLeft),
              away: awayOf(replayData.piecesLeft),
            },
            {
              criterionId: 'goal-distance',
              direction: 'LOWER_WINS' as const,
              home: homeOf(replayData.goalDistance),
              away: awayOf(replayData.goalDistance),
            },
          ],
        };

        const decision = decideFinalsGame(adapterResult, {
          ...ADAPTER,
          pinnedAdapterId: ADAPTER.adapterId,
          pinnedAdapterVersion: ADAPTER.adapterVersion,
          homeSeed: row.homeSeed,
          awaySeed: row.awaySeed,
        });

        winners.push(decision.winner);
        decided = scoreFinalsSeries(winners).state === 'FINALIZED';

        games.push({
          plan,
          state: 'FINALIZED',
          finalized: {
            matchId,
            ...ADAPTER,
            adapterResult,
            reason: replayData.reason,
            turnCount: replayData.turnCount,
            finalStateHash: replayData.finalStateHash,
            faults: replayData.faults,
            eventLogSha256: replayData.eventLogSha256,
            replay: replayData.replay,
          },
        });
      }

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
    tournamentId: DEMO_TOURNAMENT_ID,
    finalsRuleSetId: DEMO_RULE_SET_ID,
    seeding: seeded.locked,
    bracket,
    teams,
    series,
  };
}

export interface DemoBundleArtifactPayload {
  readonly path: string;
  readonly payloadBase64: string;
}

export interface DemoBundleJsonEnvelope {
  readonly manifest: ResultBundleManifestV1;
  readonly signature: string;
  readonly artifacts: readonly DemoBundleArtifactPayload[];
}

export async function buildSyntheticDemoBundle(privateKeyPem: string): Promise<DemoBundleJsonEnvelope> {
  const tournamentInput = await createSyntheticDemoTournament();
  const builtArtifacts = buildFinalsBundleArtifacts(tournamentInput);

  // Validate envelope & schemas before signing
  const validation = validateBundleArtifacts(
    builtArtifacts.map((a) => ({ path: a.path, mediaType: a.mediaType, bytes: a.payload })),
  );
  if (!validation.ok) {
    throw new Error(`Demo bundle artifacts validation failed: ${JSON.stringify(validation.errors)}`);
  }

  const buildInput = {
    bundleId: DEMO_BUNDLE_ID,
    bundleVersion: DEMO_BUNDLE_VERSION,
    tournamentId: tournamentInput.tournamentId,
    finalsRuleSetId: tournamentInput.finalsRuleSetId,
    keyId: DEMO_KEY_ID,
    createdAt: DEMO_FINALS_CREATED_AT,
    artifacts: builtArtifacts.map((a) => ({
      path: a.path,
      mediaType: a.mediaType,
      payload: a.payload,
    })),
  };

  const signed = buildSignedResultBundle(buildInput, privateKeyPem);
  return {
    manifest: signed.manifest,
    signature: signed.signature,
    artifacts: signed.artifacts.map((a) => ({
      path: a.path,
      payloadBase64: Buffer.from(a.payload).toString('base64'),
    })),
  };
}

export interface ExportDemoFinalsBundleOptions {
  readonly outFile: string;
  readonly keyDir?: string;
}

export interface ExportDemoFinalsBundleResult {
  readonly bundleId: string;
  readonly keyId: string;
  readonly fingerprint: string;
  readonly artifactCount: number;
  readonly outFile: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

export async function exportDemoFinalsBundle(
  options: ExportDemoFinalsBundleOptions,
): Promise<ExportDemoFinalsBundleResult> {
  const keyDir = path.resolve(options.keyDir ?? '.local/demo/finals');
  fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });

  const privateKeyPath = path.join(keyDir, `${DEMO_KEY_ID}.private.pem`);
  const publicKeyPath = path.join(keyDir, `${DEMO_KEY_ID}.public.pem`);

  let privateKeyPem: string;
  let publicKeyPem: string;

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
    publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8');
  } else {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    fs.writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(publicKeyPath, publicKeyPem, { mode: 0o644 });
  }

  const fingerprint = computeKeyFingerprint(publicKeyPem);
  const bundlePayload = await buildSyntheticDemoBundle(privateKeyPem);

  const resolvedOutFile = path.resolve(options.outFile);
  fs.mkdirSync(path.dirname(resolvedOutFile), { recursive: true });
  fs.writeFileSync(resolvedOutFile, JSON.stringify(bundlePayload, null, 2), 'utf8');

  return {
    bundleId: bundlePayload.manifest.bundleId,
    keyId: DEMO_KEY_ID,
    fingerprint,
    artifactCount: bundlePayload.manifest.artifacts.length,
    outFile: resolvedOutFile,
    publicKeyPem,
    privateKeyPem,
  };
}
