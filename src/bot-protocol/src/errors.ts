/**
 * Bot Protocol v1 — error codes (source of truth: `docs/contracts/bot-protocol-v1.md`
 * section 6 and `docs/contracts/bot-protocol-v1.schema.json` `$defs`).
 *
 * No type is copied: `TurnErrorCode` reuses the Engine's `SkipReason` set and
 * `ProcessFaultCode` is reused from `@ott/game-core`.
 */
import type { ProcessFaultCode, SkipReason } from '@ott/game-core';

export type { ProcessFaultCode } from '@ott/game-core';

/** Recoverable per-turn `TURN_RESULT.errorCode` values (schema `turnErrorCode`). */
export type TurnErrorCode = SkipReason;

/** `FaultSummary.lastErrorCode` (schema `faultCode`): turn faults minus NO_LEGAL_ACTION, plus process faults. */
export type FaultCode = Exclude<SkipReason, 'NO_LEGAL_ACTION'> | ProcessFaultCode;

export const TURN_ERROR_CODES: readonly TurnErrorCode[] = [
  'NO_LEGAL_ACTION',
  'BOT_TIMEOUT',
  'MALFORMED_JSON',
  'SCHEMA_VIOLATION',
  'MATCH_ID_MISMATCH',
  'TURN_ID_MISMATCH',
  'MESSAGE_TOO_LARGE',
  'ILLEGAL_ACTION',
];

export const PROCESS_FAULT_CODES: readonly ProcessFaultCode[] = [
  'BOT_SPAWN_FAILED',
  'BOT_CRASHED',
  'BOT_EOF',
  'STDERR_LIMIT_EXCEEDED',
  'RESOURCE_LIMIT_EXCEEDED',
  'SANDBOX_VIOLATION',
];

export const FAULT_CODES: readonly FaultCode[] = [
  'BOT_TIMEOUT',
  'MALFORMED_JSON',
  'SCHEMA_VIOLATION',
  'MATCH_ID_MISMATCH',
  'TURN_ID_MISMATCH',
  'MESSAGE_TOO_LARGE',
  'ILLEGAL_ACTION',
  'BOT_SPAWN_FAILED',
  'BOT_CRASHED',
  'BOT_EOF',
  'STDERR_LIMIT_EXCEEDED',
  'RESOURCE_LIMIT_EXCEEDED',
  'SANDBOX_VIOLATION',
];
