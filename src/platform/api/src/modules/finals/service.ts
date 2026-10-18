import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import { DEFAULT_MINIMUM_FINALS_SERIES } from '../scheduling/eligibility.ts';
import { seedFinals, type FinalsSeedCandidate, type HeadToHeadResult } from './seeding.ts';

/**
 * P3-D08 finals control plane: persistence/API for the Finals Format v1 rule set, the locked 8-team
 * seeding, the LAN submission window and cutoff pinning. The deterministic bracket/scoring domain
 * lives in `seeding.ts` / `scheduling.ts` / `scoring.ts` (P3-L06) and is consumed here.
 */

export interface FinalsPerTurnPolicyV1 {
  readonly mode: 'FIXED' | 'DYNAMIC' | 'NONE';
  readonly fixedMs?: number;
  readonly baseMs?: number;
  readonly stepMs?: number;
  readonly everyTurns?: number;
  readonly maxMs?: number;
}

export interface FinalsRuleSetRulesV1 {
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly maxTurns: number;
  readonly perTurn: FinalsPerTurnPolicyV1;
  /** Finite wall-clock cap for one BO3 pairing (requirement 12.1 PoC default: 30 minutes). */
  readonly pairingWallClockMs: number;
  readonly mapPool: readonly string[];
  readonly sidePolicy: 'SWAP_GAMES_1_2_SEEDED_GAME_3';
  readonly gameAdapter: { readonly adapterId: string; readonly adapterVersion: string };
  readonly bronzeMatchEnabled: boolean;
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
}

export class FinalsRuleSetInvalidError extends Error {
  public readonly details: readonly ValidationIssue[];

  public constructor(details: readonly ValidationIssue[]) {
    super('FINALS_RULE_SET_INVALID');
    this.name = 'FinalsRuleSetInvalidError';
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * Validates the pinned finals rule set. It mirrors `RoundRuleSetRulesV1` where the two overlap (engine
 * version, maxTurns, per-turn policy) and adds the finals-only map pool, side policy and adapter id.
 */
export function validateFinalsRuleSetRules(
  value: unknown,
): { readonly rules: FinalsRuleSetRulesV1 } | { readonly errors: readonly ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const push = (path: string, code: string) => errors.push({ path, code });

  if (!isRecord(value)) return { errors: [{ path: '', code: 'MUST_BE_OBJECT' }] };
  const raw = value;
  const allowedKeys = new Set([
    'schemaVersion',
    'engineVersion',
    'maxTurns',
    'perTurn',
    'pairingWallClockMs',
    'mapPool',
    'sidePolicy',
    'gameAdapter',
    'bronzeMatchEnabled',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) push(key, 'UNKNOWN_FIELD');
  }

  if (raw['schemaVersion'] !== 1) push('schemaVersion', 'MUST_BE_1');
  if (typeof raw['engineVersion'] !== 'string' || (raw['engineVersion'] as string).length === 0) {
    push('engineVersion', 'MUST_BE_NON_EMPTY_STRING');
  }
  if (!positiveInt(raw['maxTurns']) || (raw['maxTurns'] as number) > 10000) push('maxTurns', 'OUT_OF_RANGE');
  if (!positiveInt(raw['pairingWallClockMs']) || (raw['pairingWallClockMs'] as number) > 7_200_000) {
    push('pairingWallClockMs', 'OUT_OF_RANGE');
  }

  const perTurn = raw['perTurn'];
  if (!isRecord(perTurn)) {
    push('perTurn', 'MUST_BE_OBJECT');
  } else {
    const mode = perTurn['mode'];
    if (mode === 'FIXED') {
      if (!positiveInt(perTurn['fixedMs']) || (perTurn['fixedMs'] as number) > 3_600_000) {
        push('perTurn.fixedMs', 'OUT_OF_RANGE');
      }
    } else if (mode === 'DYNAMIC') {
      if (!positiveInt(perTurn['baseMs']) || (perTurn['baseMs'] as number) > 3_600_000) push('perTurn.baseMs', 'OUT_OF_RANGE');
      if (!positiveInt(perTurn['stepMs']) || (perTurn['stepMs'] as number) > 3_600_000) push('perTurn.stepMs', 'OUT_OF_RANGE');
      if (!positiveInt(perTurn['everyTurns']) || (perTurn['everyTurns'] as number) > 10_000) push('perTurn.everyTurns', 'OUT_OF_RANGE');
      if (!positiveInt(perTurn['maxMs']) || (perTurn['maxMs'] as number) > 3_600_000) push('perTurn.maxMs', 'OUT_OF_RANGE');
      const base = perTurn['baseMs'];
      const max = perTurn['maxMs'];
      if (positiveInt(base) && positiveInt(max) && base > max) push('perTurn.baseMs', 'BASE_EXCEEDS_MAX');
    } else if (mode !== 'NONE') {
      push('perTurn.mode', 'INVALID_MODE');
    }
  }

  const mapPool = raw['mapPool'];
  if (!Array.isArray(mapPool) || mapPool.length === 0) {
    push('mapPool', 'MUST_BE_NON_EMPTY_ARRAY');
  } else {
    const unique = new Set<string>();
    for (const [index, entry] of mapPool.entries()) {
      if (typeof entry !== 'string' || entry.length === 0) push(`mapPool[${index}]`, 'MUST_BE_NON_EMPTY_STRING');
      else if (unique.has(entry)) push(`mapPool[${index}]`, 'DUPLICATE');
      else unique.add(entry);
    }
  }

  if (raw['sidePolicy'] !== 'SWAP_GAMES_1_2_SEEDED_GAME_3') push('sidePolicy', 'INVALID_POLICY');

  const adapter = raw['gameAdapter'];
  if (!isRecord(adapter)) {
    push('gameAdapter', 'MUST_BE_OBJECT');
  } else {
    if (typeof adapter['adapterId'] !== 'string' || (adapter['adapterId'] as string).length === 0) {
      push('gameAdapter.adapterId', 'MUST_BE_NON_EMPTY_STRING');
    }
    if (typeof adapter['adapterVersion'] !== 'string' || (adapter['adapterVersion'] as string).length === 0) {
      push('gameAdapter.adapterVersion', 'MUST_BE_NON_EMPTY_STRING');
    }
  }
  if (typeof raw['bronzeMatchEnabled'] !== 'boolean') push('bronzeMatchEnabled', 'MUST_BE_BOOLEAN');

  if (errors.length > 0) return { errors };
  return { rules: value as unknown as FinalsRuleSetRulesV1 };
}

export function computeFinalsRulesSha256(rules: FinalsRuleSetRulesV1): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex');
}

function validateReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) throw new Error('INVALID_REASON');
  return trimmed;
}

function validateStage(stage: string): void {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(stage)) throw new Error('TOURNAMENT_STAGE_INVALID');
}

async function insertAudit(
  transaction: Database,
  input: {
    readonly actorAccountId: string;
    readonly action: string;
    readonly targetId: string;
    readonly reason: string;
    readonly details: unknown;
  },
): Promise<void> {
  await transaction.query(
    'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [
      randomUUID(),
      input.actorAccountId,
      input.action,
      'finals_competition',
      input.targetId,
      input.reason,
      JSON.stringify(input.details),
    ],
  );
}

export interface CreateFinalsRuleSetInput {
  readonly tournamentStage: string;
  readonly rules: unknown;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface FinalsRuleSetSummary {
  readonly id: string;
  readonly tournamentStage: string;
  readonly version: number;
  readonly rulesSha256: string;
  readonly reason: string;
  readonly createdAt: Date;
}

/** Append-only, versioned rule set: a finals rule set is never edited, only superseded. */
export async function createFinalsRuleSet(
  database: Database,
  input: CreateFinalsRuleSetInput,
): Promise<FinalsRuleSetSummary> {
  const reason = validateReason(input.reason);
  validateStage(input.tournamentStage);
  const validation = validateFinalsRuleSetRules(input.rules);
  if ('errors' in validation) throw new FinalsRuleSetInvalidError(validation.errors);
  const rules = validation.rules;
  const rulesSha256 = computeFinalsRulesSha256(rules);
  const id = randomUUID();

  return database.transaction(async (transaction) => {
    const existing = await transaction.query<{ readonly max_version: number | null }>(
      'SELECT MAX(version) AS max_version FROM finals_rule_sets WHERE tournament_stage = $1',
      [input.tournamentStage],
    );
    const version = (existing.rows[0]?.max_version ?? 0) + 1;
    const inserted = await transaction.query<{ readonly created_at: Date }>(
      'INSERT INTO finals_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING created_at',
      [id, input.tournamentStage, version, JSON.stringify(rules), rulesSha256, input.actorAccountId, reason],
    );
    await insertAudit(transaction, {
      actorAccountId: input.actorAccountId,
      action: 'FINALS_RULE_SET_CREATED',
      targetId: id,
      reason,
      details: { tournamentStage: input.tournamentStage, version, rulesSha256 },
    });
    return {
      id,
      tournamentStage: input.tournamentStage,
      version,
      rulesSha256,
      reason,
      createdAt: inserted.rows[0]!.created_at,
    };
  });
}

export interface CreateFinalsCompetitionInput {
  readonly tournamentStage: string;
  readonly ruleSetId: string;
  readonly bronzeMatchEnabled?: boolean;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface FinalsCompetitionSummary {
  readonly id: string;
  readonly tournamentStage: string;
  readonly status: string;
  readonly ruleSetId: string | null;
  readonly bronzeMatchEnabled: boolean;
  readonly drawSeed: string | null;
  readonly seedingHash: string | null;
  readonly cutoffClosedAt: Date | null;
  readonly pinnedAt: Date | null;
}

interface CompetitionRow {
  readonly id: string;
  readonly tournament_stage: string;
  readonly status: string;
  readonly rule_set_id: string | null;
  readonly bronze_match_enabled: boolean;
  readonly draw_seed: string | null;
  readonly seeding_hash: string | null;
  readonly cutoff_closed_at: Date | null;
  readonly pinned_at: Date | null;
}

function toSummary(row: CompetitionRow): FinalsCompetitionSummary {
  return {
    id: row.id,
    tournamentStage: row.tournament_stage,
    status: row.status,
    ruleSetId: row.rule_set_id,
    bronzeMatchEnabled: row.bronze_match_enabled,
    drawSeed: row.draw_seed,
    seedingHash: row.seeding_hash,
    cutoffClosedAt: row.cutoff_closed_at,
    pinnedAt: row.pinned_at,
  };
}

export async function createFinalsCompetition(
  database: Database,
  input: CreateFinalsCompetitionInput,
): Promise<FinalsCompetitionSummary> {
  const reason = validateReason(input.reason);
  validateStage(input.tournamentStage);
  const id = randomUUID();

  return database.transaction(async (transaction) => {
    const ruleSet = await transaction.query<{ readonly tournament_stage: string; readonly bronze: boolean }>(
      "SELECT tournament_stage, (rules->>'bronzeMatchEnabled')::boolean AS bronze FROM finals_rule_sets WHERE id = $1",
      [input.ruleSetId],
    );
    const found = ruleSet.rows[0];
    if (found === undefined) throw new Error('FINALS_RULE_SET_NOT_FOUND');
    if (found.tournament_stage !== input.tournamentStage) throw new Error('FINALS_RULE_SET_STAGE_MISMATCH');

    const bronzeMatchEnabled = input.bronzeMatchEnabled ?? found.bronze;
    const inserted = await transaction.query<CompetitionRow>(
      `INSERT INTO finals_competitions (id, tournament_stage, status, rule_set_id, bronze_match_enabled)
       VALUES ($1,$2,'DRAFT_RULES',$3,$4)
       RETURNING id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash, cutoff_closed_at, pinned_at`,
      [id, input.tournamentStage, input.ruleSetId, bronzeMatchEnabled],
    );
    await insertAudit(transaction, {
      actorAccountId: input.actorAccountId,
      action: 'FINALS_COMPETITION_CREATED',
      targetId: id,
      reason,
      details: { tournamentStage: input.tournamentStage, ruleSetId: input.ruleSetId, bronzeMatchEnabled },
    });
    return toSummary(inserted.rows[0]!);
  });
}

interface RankedTeamRow {
  readonly team_id: string;
  readonly submission_id: string;
  readonly elo: number;
  readonly series_wins: number;
  readonly game_point_differential: number;
  readonly rated_series: number;
}

/**
 * Locked qualification ranking for one stage: finalized series only (cancelled/infra-failed series
 * never count), latest ledger rating per team, and the ACTIVE submission of the stage. The D-22
 * minimum-series rule is then applied by the P3-L06 `seedFinals` domain, not by this query.
 */
const rankedTeamsSql = `
WITH stage_series AS (
  SELECT id, team_a_id, team_b_id, team_a_score, team_b_score, created_at
  FROM series WHERE tournament_stage = $1 AND status = 'FINALIZED'
),
team_series AS (
  SELECT id, team_a_id AS team_id, COALESCE(team_a_score, 0) AS points, COALESCE(team_b_score, 0) AS opponent_points, created_at FROM stage_series
  UNION ALL
  SELECT id, team_b_id, COALESCE(team_b_score, 0), COALESCE(team_a_score, 0), created_at FROM stage_series
),
team_rows AS (
  SELECT team_id,
    COUNT(*)::int AS rated_series,
    COUNT(*) FILTER (WHERE points > opponent_points)::int AS series_wins,
    COALESCE(SUM(points - opponent_points), 0)::int AS game_point_differential
  FROM team_series GROUP BY team_id
),
latest_rating AS (
  SELECT DISTINCT ON (ledger.team_id) ledger.team_id, ledger.rating_after
  FROM rating_ledger ledger
  JOIN series rated ON rated.id = ledger.series_id
  ORDER BY ledger.team_id, rated.created_at DESC, ledger.created_at DESC, ledger.id DESC
),
active_submission AS (
  SELECT team_id, id FROM submissions WHERE tournament_stage = $1 AND status = 'ACTIVE'
)
SELECT rows.team_id, active.id AS submission_id,
  COALESCE(latest.rating_after, 1000)::int AS elo,
  rows.series_wins, rows.game_point_differential, rows.rated_series
FROM team_rows rows
JOIN active_submission active ON active.team_id = rows.team_id
LEFT JOIN latest_rating latest ON latest.team_id = rows.team_id`;

export interface SeedFinalsCompetitionInput {
  readonly competitionId: string;
  /** Committed and published before the draw; never derived from results. */
  readonly drawSeed: string;
  readonly reason: string;
  readonly actorAccountId: string;
  /** BTC may lower the D-22 threshold for short stages; defaults to five rated series. */
  readonly minimumSeries?: number;
  readonly headToHead?: readonly HeadToHeadResult[];
}

export interface SeedFinalsCompetitionResult {
  readonly seedingHash: string;
  readonly seeds: readonly {
    readonly ordinal: number;
    readonly teamId: string;
    readonly submissionId: string;
    readonly elo: number;
  }[];
  readonly excluded: readonly { readonly teamId: string; readonly ratedSeries: number; readonly shortfall: number }[];
}

/** Locks the ranking into eight immutable seed rows; a second call is refused by the seed trigger. */
export async function seedFinalsCompetition(
  database: Database,
  input: SeedFinalsCompetitionInput,
): Promise<SeedFinalsCompetitionResult> {
  const reason = validateReason(input.reason);
  const minimumSeries = input.minimumSeries ?? DEFAULT_MINIMUM_FINALS_SERIES;

  return database.transaction(async (transaction) => {
    const selected = await transaction.query<CompetitionRow & { readonly seeded_at: Date | null }>(
      `SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash,
              cutoff_closed_at, pinned_at, seeded_at
       FROM finals_competitions WHERE id = $1 FOR UPDATE`,
      [input.competitionId],
    );
    const competition = selected.rows[0];
    if (competition === undefined) throw new Error('FINALS_COMPETITION_NOT_FOUND');
    if (competition.status !== 'DRAFT_RULES') throw new Error('FINALS_STATUS_INVALID');
    if (competition.seeded_at !== null) throw new Error('FINALS_ALREADY_SEEDED');

    const ranked = await transaction.query<RankedTeamRow>(rankedTeamsSql, [competition.tournament_stage]);
    const candidates: FinalsSeedCandidate[] = ranked.rows.map((row) => ({
      teamId: row.team_id,
      submissionId: row.submission_id,
      elo: row.elo,
      seriesWins: row.series_wins,
      gamePointDifferential: row.game_point_differential,
      ratedSeries: row.rated_series,
    }));

    const seeding = seedFinals(candidates, {
      drawSeed: input.drawSeed,
      minimumSeries,
      headToHead: input.headToHead ?? [],
    });
    const byTeam = new Map(candidates.map((candidate) => [candidate.teamId, candidate]));

    for (const seed of seeding.locked.seeds) {
      const candidate = byTeam.get(seed.teamId)!;
      await transaction.query(
        `INSERT INTO finals_seeds (competition_id, ordinal, team_id, submission_id, elo, series_wins, game_point_differential, rated_series)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.competitionId,
          seed.ordinal,
          seed.teamId,
          seed.submissionId,
          candidate.elo,
          candidate.seriesWins,
          candidate.gamePointDifferential,
          candidate.ratedSeries,
        ],
      );
    }
    await transaction.query(
      'UPDATE finals_competitions SET draw_seed = $2, seeding_hash = $3, seeded_at = now(), seeded_by = $4 WHERE id = $1',
      [input.competitionId, seeding.locked.drawSeed, seeding.locked.seedingHash, input.actorAccountId],
    );
    await insertAudit(transaction, {
      actorAccountId: input.actorAccountId,
      action: 'FINALS_SEEDED',
      targetId: input.competitionId,
      reason,
      details: {
        seedingHash: seeding.locked.seedingHash,
        minimumSeries,
        seeds: seeding.locked.seeds.map(({ ordinal, teamId }) => ({ ordinal, teamId })),
        excluded: seeding.excluded,
      },
    });
    return {
      seedingHash: seeding.locked.seedingHash,
      seeds: seeding.locked.seeds.map(({ ordinal, teamId, submissionId }) => ({
        ordinal,
        teamId,
        submissionId,
        elo: byTeam.get(teamId)!.elo,
      })),
      excluded: seeding.excluded,
    };
  });
}

export interface OpenLanSubmissionInput {
  readonly competitionId: string;
  readonly submissionOpensAt: Date;
  readonly lanCutoffAt: Date;
  readonly reason: string;
  readonly actorAccountId: string;
}

/** Opens the LAN submission window: DRAFT_RULES -> SUBMISSION_OPEN with the published cutoff time. */
export async function openLanSubmission(
  database: Database,
  input: OpenLanSubmissionInput,
): Promise<FinalsCompetitionSummary> {
  const reason = validateReason(input.reason);
  if (!(input.submissionOpensAt instanceof Date) || !(input.lanCutoffAt instanceof Date)) {
    throw new Error('FINALS_WINDOW_INVALID');
  }
  if (input.lanCutoffAt.getTime() <= input.submissionOpensAt.getTime()) throw new Error('FINALS_WINDOW_INVALID');

  return database.transaction(async (transaction) => {
    const selected = await transaction.query<CompetitionRow>(
      `SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash,
              cutoff_closed_at, pinned_at
       FROM finals_competitions WHERE id = $1 FOR UPDATE`,
      [input.competitionId],
    );
    const competition = selected.rows[0];
    if (competition === undefined) throw new Error('FINALS_COMPETITION_NOT_FOUND');
    if (competition.status !== 'DRAFT_RULES') throw new Error('FINALS_STATUS_INVALID');

    const updated = await transaction.query<CompetitionRow>(
      `UPDATE finals_competitions
       SET status = 'SUBMISSION_OPEN', submission_opens_at = $2, lan_cutoff_at = $3
       WHERE id = $1
       RETURNING id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash,
                 cutoff_closed_at, pinned_at`,
      [input.competitionId, input.submissionOpensAt, input.lanCutoffAt],
    );
    await insertAudit(transaction, {
      actorAccountId: input.actorAccountId,
      action: 'FINALS_LAN_WINDOW_OPENED',
      targetId: input.competitionId,
      reason,
      details: {
        submissionOpensAt: input.submissionOpensAt.toISOString(),
        lanCutoffAt: input.lanCutoffAt.toISOString(),
      },
    });
    return toSummary(updated.rows[0]!);
  });
}

export interface CloseLanCutoffInput {
  readonly competitionId: string;
  readonly idempotencyKey: string;
  /** SHA-256 of the canonical request body, so a retry with different content is refused. */
  readonly requestHash: string;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface CloseLanCutoffResult {
  readonly cutoffClosedAt: Date;
  readonly pinnedRuleSetId: string;
  readonly pinnedMapPool: readonly string[];
  readonly replayed: boolean;
}

/**
 * Closes the LAN cutoff and pins the rule set plus map pool the event will actually run. Idempotent:
 * the same key with the same request hash replays the stored result; the same key with a different
 * hash is refused, so a retry cannot silently change what was pinned.
 */
export async function closeLanCutoff(
  database: Database,
  input: CloseLanCutoffInput,
): Promise<CloseLanCutoffResult> {
  const reason = validateReason(input.reason);
  if (input.idempotencyKey.trim().length < 1 || input.idempotencyKey.length > 200) {
    throw new Error('IDEMPOTENCY_KEY_INVALID');
  }
  if (!/^[0-9a-f]{64}$/.test(input.requestHash)) throw new Error('REQUEST_HASH_INVALID');

  return database.transaction(async (transaction) => {
    const selected = await transaction.query<
      CompetitionRow & {
        readonly cutoff_idempotency_key: string | null;
        readonly cutoff_request_hash: string | null;
        readonly pinned_rule_set_id: string | null;
        readonly pinned_map_pool: unknown;
      }
    >(
      `SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash,
              cutoff_closed_at, pinned_at, cutoff_idempotency_key, cutoff_request_hash, pinned_rule_set_id, pinned_map_pool
       FROM finals_competitions WHERE id = $1 FOR UPDATE`,
      [input.competitionId],
    );
    const competition = selected.rows[0];
    if (competition === undefined) throw new Error('FINALS_COMPETITION_NOT_FOUND');

    if (competition.cutoff_idempotency_key !== null) {
      if (competition.cutoff_idempotency_key !== input.idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REUSED');
      if (competition.cutoff_request_hash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
      return {
        cutoffClosedAt: competition.cutoff_closed_at!,
        pinnedRuleSetId: competition.pinned_rule_set_id!,
        pinnedMapPool: (competition.pinned_map_pool ?? []) as readonly string[],
        replayed: true,
      };
    }

    if (competition.status !== 'SUBMISSION_OPEN') throw new Error('FINALS_STATUS_INVALID');
    if (competition.rule_set_id === null) throw new Error('FINALS_RULE_SET_NOT_FOUND');

    const rules = await transaction.query<{ readonly rules: { readonly mapPool?: readonly string[] } }>(
      'SELECT rules FROM finals_rule_sets WHERE id = $1',
      [competition.rule_set_id],
    );
    const mapPool = rules.rows[0]?.rules.mapPool;
    if (mapPool === undefined || mapPool.length === 0) throw new Error('FINALS_RULE_SET_NOT_FOUND');

    const updated = await transaction.query<{ readonly cutoff_closed_at: Date }>(
      `UPDATE finals_competitions
       SET status = 'SUBMISSION_CLOSED', cutoff_closed_at = now(), cutoff_idempotency_key = $2,
           cutoff_request_hash = $3, pinned_rule_set_id = rule_set_id, pinned_map_pool = $4::jsonb, pinned_at = now()
       WHERE id = $1
       RETURNING cutoff_closed_at`,
      [input.competitionId, input.idempotencyKey, input.requestHash, JSON.stringify(mapPool)],
    );
    await insertAudit(transaction, {
      actorAccountId: input.actorAccountId,
      action: 'FINALS_CUTOFF_CLOSED',
      targetId: input.competitionId,
      reason,
      details: {
        pinnedRuleSetId: competition.rule_set_id,
        pinnedMapPool: mapPool,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      cutoffClosedAt: updated.rows[0]!.cutoff_closed_at,
      pinnedRuleSetId: competition.rule_set_id,
      pinnedMapPool: mapPool,
      replayed: false,
    };
  });
}

export interface PinFinalsSubmissionInput {
  readonly competitionId: string;
  readonly teamId: string;
  readonly submissionId: string;
  readonly source: 'LAN' | 'QUALIFICATION_ACTIVE';
  /** SHA-256 (hex) of the pinned OCI artifact, as validated by preflight. */
  readonly artifactSha256: string;
  readonly compatible: boolean;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface PinFinalsSubmissionResult {
  readonly source: string;
  readonly pinnedAt: Date;
}

/**
 * Records which submission a team runs in finals: the last LAN upload before the cutoff wins, and the
 * qualification ACTIVE fallback is only accepted when no LAN pin exists and the artifact is compatible
 * with the pinned finals rule set (requirement 12.2 / D-24).
 */
export async function pinFinalsSubmission(
  database: Database,
  input: PinFinalsSubmissionInput,
): Promise<PinFinalsSubmissionResult> {
  const reason = validateReason(input.reason);
  if (!/^[0-9a-f]{64}$/.test(input.artifactSha256)) throw new Error('ARTIFACT_HASH_INVALID');

  return database.transaction(async (transaction) => {
    const selected = await transaction.query<{ readonly cutoff_closed_at: Date | null }>(
      'SELECT cutoff_closed_at FROM finals_competitions WHERE id = $1 FOR UPDATE',
      [input.competitionId],
    );
    const competition = selected.rows[0];
    if (competition === undefined) throw new Error('FINALS_COMPETITION_NOT_FOUND');
    if (competition.cutoff_closed_at !== null) throw new Error('FINALS_CUTOFF_CLOSED');

    const existing = await transaction.query<{ readonly source: string }>(
      'SELECT source FROM finals_submission_pins WHERE competition_id = $1 AND team_id = $2',
      [input.competitionId, input.teamId],
    );
    const previous = existing.rows[0];
    if (previous?.source === 'LAN' && input.source === 'QUALIFICATION_ACTIVE') {
      throw new Error('FINALS_PIN_CONFLICT');
    }

    const pinned = await transaction.query<{ readonly pinned_at: Date }>(
      `INSERT INTO finals_submission_pins
         (competition_id, team_id, submission_id, source, artifact_sha256, compatible, pinned_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (competition_id, team_id) DO UPDATE
         SET submission_id = EXCLUDED.submission_id, source = EXCLUDED.source,
             artifact_sha256 = EXCLUDED.artifact_sha256, compatible = EXCLUDED.compatible, pinned_at = now()
       RETURNING pinned_at`,
      [input.competitionId, input.teamId, input.submissionId, input.source, input.artifactSha256, input.compatible],
    );
    await insertAudit(transaction, {
      actorAccountId: input.actorAccountId,
      action: 'FINALS_SUBMISSION_PINNED',
      targetId: input.competitionId,
      reason,
      details: {
        teamId: input.teamId,
        submissionId: input.submissionId,
        source: input.source,
        artifactSha256: input.artifactSha256,
      },
    });
    return { source: input.source, pinnedAt: pinned.rows[0]!.pinned_at };
  });
}

export interface FinalsCompetitionDetail extends FinalsCompetitionSummary {
  readonly seeds: readonly {
    readonly ordinal: number;
    readonly teamId: string;
    readonly submissionId: string;
    readonly elo: number;
  }[];
  readonly series: readonly {
    readonly pairingId: string;
    readonly round: string;
    readonly slot: number;
    readonly status: string;
    readonly homeSeed: number | null;
    readonly awaySeed: number | null;
    readonly winnerSeed: number | null;
  }[];
}

export async function getFinalsCompetition(
  database: Database,
  competitionId: string,
): Promise<FinalsCompetitionDetail | null> {
  const selected = await database.query<CompetitionRow>(
    `SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash,
            cutoff_closed_at, pinned_at
     FROM finals_competitions WHERE id = $1`,
    [competitionId],
  );
  const competition = selected.rows[0];
  if (competition === undefined) return null;

  const seeds = await database.query<{
    readonly ordinal: number;
    readonly team_id: string;
    readonly submission_id: string;
    readonly elo: number;
  }>('SELECT ordinal, team_id, submission_id, elo FROM finals_seeds WHERE competition_id = $1 ORDER BY ordinal', [competitionId]);

  const series = await database.query<{
    readonly pairing_id: string;
    readonly round: string;
    readonly slot: number;
    readonly status: string;
    readonly home_seed: number | null;
    readonly away_seed: number | null;
    readonly winner_seed: number | null;
  }>(
    `SELECT pairing_id, round, slot, status, home_seed, away_seed, winner_seed
     FROM finals_series WHERE competition_id = $1 ORDER BY round, slot`,
    [competitionId],
  );

  return {
    ...toSummary(competition),
    seeds: seeds.rows.map((row) => ({
      ordinal: row.ordinal,
      teamId: row.team_id,
      submissionId: row.submission_id,
      elo: row.elo,
    })),
    series: series.rows.map((row) => ({
      pairingId: row.pairing_id,
      round: row.round,
      slot: row.slot,
      status: row.status,
      homeSeed: row.home_seed,
      awaySeed: row.away_seed,
      winnerSeed: row.winner_seed,
    })),
  };
}
