import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import {
  ALLOWED_TRANSITIONS,
  computeRulesSha256,
  validateRoundRuleSetRules,
  type RoundAction,
  type RoundRuleSetRulesV1,
  type RoundStatus,
} from './types.ts';
import { scheduleRound, type ScheduleRoundInput } from '../scheduling/service.ts';
import { applyRoundRatings } from '../ratings/service.ts';

export interface CreateRuleSetInput {
  readonly tournamentStage: string;
  readonly rules: unknown;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface RuleSetSummary {
  readonly id: string;
  readonly version: number;
  readonly rulesSha256: string;
  readonly reason: string;
  readonly createdAt: Date;
}

export interface RuleSetDetail extends RuleSetSummary {
  readonly tournamentStage: string;
  readonly rules: RoundRuleSetRulesV1;
}

export class RuleSetInvalidError extends Error {
  public readonly details: readonly { readonly path: string; readonly code: string }[];

  public constructor(details: readonly { readonly path: string; readonly code: string }[]) {
    super('RULE_SET_INVALID');
    this.name = 'RuleSetInvalidError';
    this.details = details;
  }
}

export interface CreateRoundInput {
  readonly tournamentStage: string;
  readonly reason: string;
  readonly actorAccountId: string;
}

export type RoundActionType = RoundAction['type'];

export interface RoundSummary {
  readonly id: string;
  readonly tournamentStage: string;
  readonly roundNumber: number;
  readonly status: RoundStatus;
  readonly ruleSetId: string | null;
  readonly scheduleRoundId: string | null;
  readonly pausedAt: Date | null;
  readonly createdAt: Date;
  readonly allowedActions: readonly RoundActionType[];
  readonly replayed?: boolean;
}

export interface TransitionInput {
  readonly roundId: string;
  readonly action: RoundAction;
  readonly reason: string;
  readonly actorAccountId: string;
  readonly idempotencyKey?: string | undefined;
}

export interface RoundServiceOptions {
  readonly now?: () => Date;
  readonly scheduleRound?: (database: Database, input: ScheduleRoundInput) => Promise<{ readonly roundId: string }>;
  readonly applyRoundRatings?: (database: Database, roundId: string) => Promise<unknown>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error('INVALID_REASON');
  }
  return trimmed;
}

function validateOptionalReason(reason: string): string {
  return reason.trim();
}

function validateTournamentStage(stage: string): void {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(stage)) {
    throw new Error('TOURNAMENT_STAGE_INVALID');
  }
}

export async function createRuleSet(
  database: Database,
  input: CreateRuleSetInput,
  options?: RoundServiceOptions,
): Promise<RuleSetSummary> {
  const reason = validateReason(input.reason);
  validateTournamentStage(input.tournamentStage);
  const validation = validateRoundRuleSetRules(input.rules);
  if (validation.errors.length > 0) {
    throw new RuleSetInvalidError(validation.errors.map(({ path, code }) => ({ path, code })));
  }
  const rules = input.rules as RoundRuleSetRulesV1;
  const sha = computeRulesSha256(rules);
  const now = options?.now?.() ?? new Date();

  return database.transaction(async (tx) => {
    const existing = await tx.query<{ readonly max_version: number | null }>(
      'SELECT MAX(version) AS max_version FROM round_rule_sets WHERE tournament_stage = $1',
      [input.tournamentStage],
    );
    const version = (existing.rows[0]?.max_version ?? 0) + 1;
    const id = randomUUID();
    await tx.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, input.tournamentStage, version, JSON.stringify(rules), sha, input.actorAccountId, reason, now],
    );
    await tx.query(
      'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, correlation_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), input.actorAccountId, 'ROUND_RULE_SET_CREATED', 'ROUND_RULE_SET', id, reason, null, JSON.stringify({ version, tournamentStage: input.tournamentStage }), now],
    );
    return { id, version, rulesSha256: sha, reason, createdAt: now };
  });
}

export async function listRuleSets(
  database: Database,
  tournamentStage: string,
): Promise<readonly RuleSetSummary[]> {
  validateTournamentStage(tournamentStage);
  const result = await database.query<{
    readonly id: string;
    readonly version: number;
    readonly rules_sha256: string;
    readonly reason: string;
    readonly created_at: Date;
  }>(
    'SELECT id, version, rules_sha256, reason, created_at FROM round_rule_sets WHERE tournament_stage = $1 ORDER BY version DESC',
    [tournamentStage],
  );
  return result.rows.map(({ id, version, rules_sha256, reason, created_at }) => ({
    id, version, rulesSha256: rules_sha256, reason, createdAt: created_at,
  }));
}

export async function getRuleSet(
  database: Database,
  ruleSetId: string,
): Promise<RuleSetDetail | null> {
  const result = await database.query<{
    readonly id: string;
    readonly tournament_stage: string;
    readonly version: number;
    readonly rules: RoundRuleSetRulesV1;
    readonly rules_sha256: string;
    readonly reason: string;
    readonly created_at: Date;
  }>(
    'SELECT id, tournament_stage, version, rules, rules_sha256, reason, created_at FROM round_rule_sets WHERE id = $1',
    [ruleSetId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id, tournamentStage: row.tournament_stage, version: row.version, rules: row.rules,
    rulesSha256: row.rules_sha256, reason: row.reason, createdAt: row.created_at,
  };
}

export async function createRound(
  database: Database,
  input: CreateRoundInput,
  options?: RoundServiceOptions,
): Promise<RoundSummary> {
  const reason = validateOptionalReason(input.reason);
  validateTournamentStage(input.tournamentStage);
  const now = options?.now?.() ?? new Date();

  return database.transaction(async (tx) => {
    const existingActive = await tx.query<{ readonly id: string }>(
      "SELECT id FROM qualification_rounds WHERE tournament_stage = $1 AND status <> 'PUBLISHED' LIMIT 1",
      [input.tournamentStage],
    );
    if (existingActive.rows.length > 0) {
      throw new Error('ROUND_ALREADY_EXISTS_IN_STAGE');
    }

    const maxRound = await tx.query<{ readonly max_round: number | null }>(
      'SELECT MAX(round_number) AS max_round FROM qualification_rounds WHERE tournament_stage = $1',
      [input.tournamentStage],
    );
    const roundNumber = (maxRound.rows[0]?.max_round ?? 0) + 1;
    const id = randomUUID();

    await tx.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status, created_at) VALUES ($1,$2,$3,'DRAFT_RULES',$4)",
      [id, input.tournamentStage, roundNumber, now],
    );
    await tx.query(
      'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, correlation_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), input.actorAccountId, 'ROUND_CREATED', 'ROUND', id, reason, null, JSON.stringify({ roundNumber, tournamentStage: input.tournamentStage }), now],
    );
    return {
      id, tournamentStage: input.tournamentStage, roundNumber, status: 'DRAFT_RULES',
      ruleSetId: null, scheduleRoundId: null, pausedAt: null, createdAt: now,
      allowedActions: getAllowedActions('DRAFT_RULES', null),
    };
  });
}

export async function listRounds(
  database: Database,
  tournamentStage: string,
): Promise<readonly RoundSummary[]> {
  validateTournamentStage(tournamentStage);
  const result = await database.query<{
    readonly id: string;
    readonly tournament_stage: string;
    readonly round_number: number;
    readonly status: RoundStatus;
    readonly rule_set_id: string | null;
    readonly schedule_round_id: string | null;
    readonly paused_at: Date | null;
    readonly created_at: Date;
  }>(
    'SELECT id, tournament_stage, round_number, status, rule_set_id, schedule_round_id, paused_at, created_at FROM qualification_rounds WHERE tournament_stage = $1 ORDER BY round_number DESC',
    [tournamentStage],
  );
  return result.rows.map(({ id, tournament_stage, round_number, status, rule_set_id, schedule_round_id, paused_at, created_at }) => ({
    id, tournamentStage: tournament_stage, roundNumber: round_number, status,
    ruleSetId: rule_set_id, scheduleRoundId: schedule_round_id, pausedAt: paused_at, createdAt: created_at,
    allowedActions: getAllowedActions(status, paused_at),
  }));
}

export async function getRound(
  database: Database,
  roundId: string,
): Promise<RoundSummary | null> {
  const result = await database.query<{
    readonly id: string;
    readonly tournament_stage: string;
    readonly round_number: number;
    readonly status: RoundStatus;
    readonly rule_set_id: string | null;
    readonly schedule_round_id: string | null;
    readonly paused_at: Date | null;
    readonly created_at: Date;
  }>(
    'SELECT id, tournament_stage, round_number, status, rule_set_id, schedule_round_id, paused_at, created_at FROM qualification_rounds WHERE id = $1',
    [roundId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id, tournamentStage: row.tournament_stage, roundNumber: row.round_number, status: row.status,
    ruleSetId: row.rule_set_id, scheduleRoundId: row.schedule_round_id, pausedAt: row.paused_at, createdAt: row.created_at,
    allowedActions: getAllowedActions(row.status, row.paused_at),
  };
}

interface RoundRow {
  readonly id: string;
  readonly status: RoundStatus;
  readonly rule_set_id: string | null;
  readonly schedule_round_id: string | null;
  readonly start_idempotency_key: string | null;
  readonly start_request_hash: string | null;
  readonly paused_at: Date | null;
  readonly tournament_stage: string;
}

async function getRoundForUpdate(tx: Database, roundId: string): Promise<RoundRow | null> {
  const result = await tx.query<RoundRow>(
    'SELECT id, status, rule_set_id, schedule_round_id, start_idempotency_key, start_request_hash, paused_at, tournament_stage FROM qualification_rounds WHERE id = $1 FOR UPDATE',
    [roundId],
  );
  return result.rows[0] ?? null;
}

function writeAudit(
  tx: Database,
  actorAccountId: string,
  action: string,
  targetId: string,
  reason: string,
  details: Record<string, unknown>,
  now: Date,
): Promise<unknown> {
  return tx.query(
    'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, correlation_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [randomUUID(), actorAccountId, action, 'ROUND', targetId, reason, null, JSON.stringify(details), now],
  );
}

function startRequestHash(roundId: string, ruleSetId: string): string {
  return sha256(JSON.stringify({ roundId, ruleSetId }));
}

function getGraceEndsFromRuleSet(ruleSetRules: unknown): string | null {
  if (typeof ruleSetRules !== 'object' || ruleSetRules === null) return null;
  const rules = ruleSetRules as Record<string, unknown>;
  const schedule = rules.schedule;
  if (typeof schedule !== 'object' || schedule === null) return null;
  const graceEndsAt = (schedule as Record<string, unknown>).graceEndsAt;
  if (typeof graceEndsAt !== 'string') return null;
  return graceEndsAt;
}

async function executeStart(
  database: Database,
  input: TransitionInput,
  reason: string,
  now: Date,
  options?: RoundServiceOptions,
): Promise<RoundSummary> {
  if (input.action.type !== 'start') throw new Error('ROUND_TRANSITION_INVALID');
  const action = input.action;
  const idempotencyKey = input.idempotencyKey ?? action.idempotencyKey;
  if (!idempotencyKey || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
    throw new Error('IDEMPOTENCY_KEY_INVALID');
  }
  if (!action.ruleSetId) throw new Error('ROUND_TRANSITION_INVALID');
  const requestHash = startRequestHash(input.roundId, action.ruleSetId);
  const scheduleRoundImpl = options?.scheduleRound ?? scheduleRound;

  const prepared = await database.transaction(async (tx) => {
    const round = await getRoundForUpdate(tx, input.roundId);
    if (!round) throw new Error('ROUND_NOT_FOUND');

    if (round.start_idempotency_key !== null) {
      if (round.start_idempotency_key !== idempotencyKey || round.start_request_hash !== requestHash) {
        throw new Error('IDEMPOTENCY_KEY_REUSED');
      }
      return { tournamentStage: round.tournament_stage };
    }

    if (round.status !== 'SUBMISSION_CLOSED') throw new Error('ROUND_TRANSITION_INVALID');
    if (action.ruleSetId !== round.rule_set_id) throw new Error('ROUND_TRANSITION_INVALID');

    await tx.query(
      "UPDATE qualification_rounds SET start_idempotency_key = $2, start_request_hash = $3 WHERE id = $1",
      [input.roundId, idempotencyKey, requestHash],
    );
    await writeAudit(tx, input.actorAccountId, 'ROUND_START_INITIATED', input.roundId, reason, { idempotencyKey }, now);
    return { tournamentStage: round.tournament_stage };
  });

  const scheduleInput: ScheduleRoundInput = {
    tournamentStage: prepared.tournamentStage,
    idempotencyKey: `round-start:${input.roundId}`,
  };
  const scheduled = await scheduleRoundImpl(database, scheduleInput);

  return database.transaction(async (tx) => {
    const round = await getRoundForUpdate(tx, input.roundId);
    if (!round) throw new Error('ROUND_NOT_FOUND');

    if (round.status !== 'SUBMISSION_CLOSED') {
      const existing = await getRoundFromTx(tx, input.roundId) as RoundSummary;
      return { ...existing, scheduleRoundId: round.schedule_round_id, replayed: true };
    }

    await tx.query(
      "UPDATE qualification_rounds SET status = 'RUNNING', schedule_round_id = $2, started_at = $3 WHERE id = $1",
      [input.roundId, scheduled.roundId, now],
    );
    await writeAudit(tx, input.actorAccountId, 'ROUND_STARTED', input.roundId, reason, { scheduleRoundId: scheduled.roundId }, now);
    return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
  });
}

async function executeReconcile(
  database: Database,
  input: TransitionInput,
  reason: string,
  now: Date,
  options?: RoundServiceOptions,
): Promise<RoundSummary> {
  const applyRatingsImpl = options?.applyRoundRatings ?? applyRoundRatings;

  const phase = await database.transaction(async (tx) => {
    const round = await getRoundForUpdate(tx, input.roundId);
    if (!round) throw new Error('ROUND_NOT_FOUND');

    if (round.status === 'RUNNING') {
      if (round.paused_at !== null) throw new Error('ROUND_TRANSITION_INVALID');
      if (!round.schedule_round_id) throw new Error('ROUND_TRANSITION_INVALID');
      const seriesRows = await tx.query<{ readonly status: string }>(
        "SELECT s.status FROM series s WHERE s.round_id = $1",
        [round.schedule_round_id],
      );
      const allTerminal = seriesRows.rows.length > 0 && seriesRows.rows.every(
        ({ status }) => status === 'FINALIZED' || status === 'CANCELLED',
      );
      if (!allTerminal) return { kind: 'current' as const };
      await tx.query(
        "UPDATE qualification_rounds SET status = 'SETTLING', settled_at = $2 WHERE id = $1",
        [input.roundId, now],
      );
      await writeAudit(tx, input.actorAccountId, 'ROUND_SETTLING', input.roundId, reason, { scheduleRoundId: round.schedule_round_id }, now);
      return { kind: 'current' as const };
    }

    if (round.status === 'SETTLING') {
      if (!round.schedule_round_id) throw new Error('ROUND_TRANSITION_INVALID');
      return { kind: 'rate' as const, scheduleRoundId: round.schedule_round_id };
    }

    if (round.status === 'RATED') {
      return { kind: 'current' as const };
    }

    throw new Error('ROUND_TRANSITION_INVALID');
  });

  if (phase.kind === 'current') {
    return getRound(database, input.roundId) as Promise<RoundSummary>;
  }

  const ratingsResult = await applyRatingsImpl(database, phase.scheduleRoundId);

  return database.transaction(async (tx) => {
    const round = await getRoundForUpdate(tx, input.roundId);
    if (!round) throw new Error('ROUND_NOT_FOUND');
    if (round.status !== 'SETTLING') {
      const existing = await getRoundFromTx(tx, input.roundId) as RoundSummary;
      return { ...existing, replayed: true };
    }
    await tx.query(
      "UPDATE qualification_rounds SET status = 'RATED', rated_at = $2 WHERE id = $1",
      [input.roundId, now],
    );
    await writeAudit(tx, input.actorAccountId, 'ROUND_RATED', input.roundId, reason, { scheduleRoundId: round.schedule_round_id, ratingsResult }, now);
    return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
  });
}

export async function executeTransition(
  database: Database,
  input: TransitionInput,
  options?: RoundServiceOptions,
): Promise<RoundSummary> {
  const now = options?.now?.() ?? new Date();
  const needsReason = !['reconcile'].includes(input.action.type);
  const reason = needsReason ? validateReason(input.reason) : validateOptionalReason(input.reason);

  if (input.action.type === 'start') {
    return executeStart(database, input, reason, now, options);
  }

  if (input.action.type === 'reconcile') {
    return executeReconcile(database, input, reason, now, options);
  }

  return database.transaction(async (tx) => {
    const round = await getRoundForUpdate(tx, input.roundId);
    if (!round) throw new Error('ROUND_NOT_FOUND');

    const allowedEdges = ALLOWED_TRANSITIONS[round.status] ?? [];
    if (!allowedEdges.includes(input.action.type)) throw new Error('ROUND_TRANSITION_INVALID');

    switch (input.action.type) {
      case 'open': {
        if (!input.action.ruleSetId) throw new Error('ROUND_TRANSITION_INVALID');
        const ruleSet = await tx.query<{ readonly id: string; readonly tournament_stage: string }>(
          'SELECT id, tournament_stage FROM round_rule_sets WHERE id = $1',
          [input.action.ruleSetId],
        );
        if (!ruleSet.rows[0]) throw new Error('RULE_SET_NOT_FOUND');
        if (ruleSet.rows[0].tournament_stage !== round.tournament_stage) throw new Error('RULE_SET_STAGE_MISMATCH');
        if (round.status !== 'DRAFT_RULES') throw new Error('ROUND_TRANSITION_INVALID');
        await tx.query(
          "UPDATE qualification_rounds SET status = 'SUBMISSION_OPEN', rule_set_id = $2, opened_at = $3 WHERE id = $1",
          [input.roundId, input.action.ruleSetId, now],
        );
        await writeAudit(tx, input.actorAccountId, 'ROUND_OPENED', input.roundId, reason, { ruleSetId: input.action.ruleSetId }, now);
        return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
      }

      case 'close': {
        if (round.status !== 'SUBMISSION_OPEN') throw new Error('ROUND_TRANSITION_INVALID');
        if (!round.rule_set_id) throw new Error('ROUND_TRANSITION_INVALID');
        const ruleSetData = await tx.query<{ readonly rules: unknown }>(
          'SELECT rules FROM round_rule_sets WHERE id = $1',
          [round.rule_set_id],
        );
        const graceEndsAt = getGraceEndsFromRuleSet(ruleSetData.rows[0]?.rules);
        if (!graceEndsAt) throw new Error('ROUND_TRANSITION_INVALID');
        if (now < new Date(graceEndsAt)) throw new Error('ROUND_TRANSITION_INVALID');
        await tx.query(
          "UPDATE qualification_rounds SET status = 'SUBMISSION_CLOSED', closed_at = $2 WHERE id = $1",
          [input.roundId, now],
        );
        await writeAudit(tx, input.actorAccountId, 'ROUND_CLOSED', input.roundId, reason, {}, now);
        return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
      }

      case 'pause': {
        if (round.status !== 'RUNNING') throw new Error('ROUND_TRANSITION_INVALID');
        if (round.paused_at !== null) throw new Error('ROUND_TRANSITION_INVALID');
        await tx.query(
          "UPDATE qualification_rounds SET paused_at = $2 WHERE id = $1",
          [input.roundId, now],
        );
        await writeAudit(tx, input.actorAccountId, 'ROUND_PAUSED', input.roundId, reason, {}, now);
        return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
      }

      case 'resume': {
        if (round.status !== 'RUNNING') throw new Error('ROUND_TRANSITION_INVALID');
        if (round.paused_at === null) throw new Error('ROUND_TRANSITION_INVALID');
        await tx.query(
          "UPDATE qualification_rounds SET paused_at = NULL WHERE id = $1",
          [input.roundId],
        );
        await writeAudit(tx, input.actorAccountId, 'ROUND_RESUMED', input.roundId, reason, {}, now);
        return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
      }

      case 'publish': {
        if (round.status !== 'RATED') throw new Error('ROUND_TRANSITION_INVALID');
        await tx.query(
          "UPDATE qualification_rounds SET status = 'PUBLISHED', published_at = $2 WHERE id = $1",
          [input.roundId, now],
        );
        await writeAudit(tx, input.actorAccountId, 'ROUND_PUBLISHED', input.roundId, reason, {}, now);
        return getRoundFromTx(tx, input.roundId) as Promise<RoundSummary>;
      }

      default:
        throw new Error('ROUND_TRANSITION_INVALID');
    }
  });
}

async function getRoundFromTx(tx: Database, roundId: string): Promise<RoundSummary | null> {
  const result = await tx.query<{
    readonly id: string;
    readonly tournament_stage: string;
    readonly round_number: number;
    readonly status: RoundStatus;
    readonly rule_set_id: string | null;
    readonly schedule_round_id: string | null;
    readonly paused_at: Date | null;
    readonly created_at: Date;
  }>(
    'SELECT id, tournament_stage, round_number, status, rule_set_id, schedule_round_id, paused_at, created_at FROM qualification_rounds WHERE id = $1',
    [roundId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id, tournamentStage: row.tournament_stage, roundNumber: row.round_number, status: row.status,
    ruleSetId: row.rule_set_id, scheduleRoundId: row.schedule_round_id, pausedAt: row.paused_at, createdAt: row.created_at,
    allowedActions: getAllowedActions(row.status, row.paused_at),
  };
}

export function getAllowedTransitions(status: RoundStatus): readonly string[] {
  return ALLOWED_TRANSITIONS[status] ?? [];
}

export function getAllowedActions(status: RoundStatus, pausedAt: Date | null): readonly RoundActionType[] {
  if (status === 'RUNNING') {
    return pausedAt === null ? ['pause', 'reconcile'] : ['resume', 'reconcile'];
  }
  return [...(ALLOWED_TRANSITIONS[status] ?? [])];
}