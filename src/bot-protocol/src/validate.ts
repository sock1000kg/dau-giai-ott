/**
 * Bot Protocol v1 runtime validator (P1-L04).
 *
 * Validates an incoming bot message against the locked JSON Schema
 * (`docs/contracts/bot-protocol-v1.schema.json`) plus the semantic expectations
 * (match id / turn id / legal action) from Bot Protocol v1 sections 6-7.
 *
 * The schema is NOT duplicated here: callers load the canonical schema file and
 * pass it to `compileProtocolValidator`. This module depends only on `@ott/game-core`
 * *types*, never on its implementation.
 */
import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js';

import type { GameAction } from '@ott/game-core';

import { PROTOCOL_VERSION_V2, type ProtocolMessage, type ProtocolMessageV2 } from './messages.ts';

/** Recoverable turn-error codes this validator can emit (Bot Protocol v1 section 6). */
export type ValidationErrorCode =
  | 'MALFORMED_JSON'
  | 'MESSAGE_TOO_LARGE'
  | 'SCHEMA_VIOLATION'
  | 'MATCH_ID_MISMATCH'
  | 'TURN_ID_MISMATCH'
  | 'ILLEGAL_ACTION';

export type ValidationResult =
  | { readonly ok: true; readonly message: ProtocolMessage }
  | { readonly ok: false; readonly code: ValidationErrorCode };

export interface ProtocolValidator {
  /** True when `data` matches one of the five locked protocol messages. */
  isProtocolMessage(data: unknown): boolean;
}

/** What the Runner currently expects for the active turn (semantic checks, ACTION only). */
export interface IncomingExpectation {
  readonly matchId: string;
  readonly turnId: number;
  readonly legalActions: readonly GameAction[];
}

export type BotMessageInput =
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'value'; readonly value: unknown };

export interface ValidateOptions {
  readonly validator: ProtocolValidator;
  readonly maxMessageBytes: number;
  readonly expect: IncomingExpectation;
}

const encoder = new TextEncoder();

/** UTF-8 byte length; Bot Protocol v1 counts message bytes excluding the trailing LF. */
export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** Compile the canonical Bot Protocol JSON Schema (draft 2020-12) into a reusable validator. */
export function compileProtocolValidator(schema: unknown): ProtocolValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema as AnySchema);
  return {
    isProtocolMessage(data: unknown): boolean {
      return validate(data) === true;
    },
  };
}

function sameAction(a: GameAction, b: GameAction): boolean {
  return a.pieceId === b.pieceId && a.to.col === b.to.col && a.to.row === b.to.row;
}

/**
 * Full incoming-message pipeline for the Runner (Bot Protocol v1 section 7):
 * size -> parse -> schema -> matchId -> turnId -> legal action.
 * `kind: 'line'` runs size and JSON parsing; `kind: 'value'` starts at schema validation.
 */
export function validateBotMessage(input: BotMessageInput, options: ValidateOptions): ValidationResult {
  let value: unknown;

  if (input.kind === 'line') {
    if (utf8ByteLength(input.line) > options.maxMessageBytes) {
      return { ok: false, code: 'MESSAGE_TOO_LARGE' };
    }
    try {
      value = JSON.parse(input.line);
    } catch {
      return { ok: false, code: 'MALFORMED_JSON' };
    }
  } else {
    value = input.value;
  }

  if (!options.validator.isProtocolMessage(value)) {
    return { ok: false, code: 'SCHEMA_VIOLATION' };
  }

  const message = value as ProtocolMessage;

  if (message.type === 'ACTION') {
    if (message.matchId !== options.expect.matchId) {
      return { ok: false, code: 'MATCH_ID_MISMATCH' };
    }
    if (message.turnId !== options.expect.turnId) {
      return { ok: false, code: 'TURN_ID_MISMATCH' };
    }
    const isLegal = options.expect.legalActions.some((candidate) => sameAction(candidate, message.action));
    if (!isLegal) {
      return { ok: false, code: 'ILLEGAL_ACTION' };
    }
  }

  return { ok: true, message };
}

/**
 * Bot Protocol v2 (P3-L01). Same pipeline as v1 — size → parse → schema →
 * `MATCH_ID_MISMATCH` → `TURN_ID_MISMATCH` → `ILLEGAL_ACTION` — evaluated against
 * the v2 machine schema, plus the v2 time-budget invariants that JSON Schema
 * cannot express (numeric relations between the pinned values).
 */

/** Semantic codes for `limits.timeControl`; shape/type errors stay `SCHEMA_VIOLATION`. */
export type TimeControlErrorCode =
  | 'INVALID_MODE'
  | 'INVALID_BUDGET'
  | 'BASE_EXCEEDS_MAX'
  | 'MAX_EXCEEDS_TOTAL_BUDGET';

export type ValidationErrorCodeV2 = ValidationErrorCode | TimeControlErrorCode;

export type ValidationResultV2 =
  | { readonly ok: true; readonly message: ProtocolMessageV2 }
  | { readonly ok: false; readonly code: ValidationErrorCodeV2 };

export type TimeControlValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: TimeControlErrorCode };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Numeric invariants of Bot Protocol v2 `limits.timeControl`:
 * `baseMs <= maxMs <= totalBotBudgetMs` (v2 §Approved defaults). `FIXED`/`NONE`
 * have no per-turn formula to bound. Qualification-only bans (`30s`, `1min`,
 * per-turn `NONE`) belong to the rule-set validator (`RoundRuleSet`), not here —
 * this module keeps exactly one source for protocol data.
 */
export function validateTimeControlV2(value: unknown): TimeControlValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, code: 'INVALID_MODE' };
  }
  const timeControl = value as { readonly totalBotBudgetMs?: unknown; readonly perTurn?: unknown };
  const perTurn = timeControl.perTurn;
  if (typeof perTurn !== 'object' || perTurn === null) {
    return { ok: false, code: 'INVALID_MODE' };
  }
  const policy = perTurn as { readonly mode?: unknown; readonly baseMs?: unknown; readonly maxMs?: unknown };
  if (policy.mode === 'FIXED' || policy.mode === 'NONE') {
    return { ok: true };
  }
  if (policy.mode !== 'DYNAMIC') {
    return { ok: false, code: 'INVALID_MODE' };
  }
  if (!isFiniteNumber(policy.baseMs) || !isFiniteNumber(policy.maxMs) || !isFiniteNumber(timeControl.totalBotBudgetMs)) {
    return { ok: false, code: 'INVALID_BUDGET' };
  }
  if (policy.baseMs > policy.maxMs) {
    return { ok: false, code: 'BASE_EXCEEDS_MAX' };
  }
  if (policy.maxMs > timeControl.totalBotBudgetMs) {
    return { ok: false, code: 'MAX_EXCEEDS_TOTAL_BUDGET' };
  }
  return { ok: true };
}

/**
 * Full incoming-message pipeline for a v2 Runner. Pass the validator compiled
 * from `docs/contracts/bot-protocol-v2.schema.json`; handing it the v1 validator
 * fails closed with `SCHEMA_VIOLATION` instead of silently downgrading.
 */
export function validateBotMessageV2(input: BotMessageInput, options: ValidateOptions): ValidationResultV2 {
  const result = validateBotMessage(input, options);
  if (!result.ok) {
    return { ok: false, code: result.code };
  }

  const message = result.message as unknown as ProtocolMessageV2;
  if (message.protocolVersion !== PROTOCOL_VERSION_V2) {
    return { ok: false, code: 'SCHEMA_VIOLATION' };
  }

  if (message.type === 'INIT') {
    const timeControl = validateTimeControlV2(message.limits.timeControl);
    if (!timeControl.ok) {
      return { ok: false, code: timeControl.code };
    }
  }

  return { ok: true, message };
}
