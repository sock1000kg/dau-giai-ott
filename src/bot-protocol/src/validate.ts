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

import type { ProtocolMessage } from './messages.ts';

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
