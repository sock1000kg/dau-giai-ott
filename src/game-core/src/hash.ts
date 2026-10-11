/**
 * Canonical state hashing for Engine API v1 section 8.
 *
 * `hashGameState` returns lowercase SHA-256 hex over the RFC 8785 (JCS)
 * canonicalization of the rule-state projection. `gameId`, timestamps and process
 * metadata are excluded, so the same rule-state under two match ids hashes equal.
 *
 * The serializer below is RFC 8785-compliant for the value types the projection
 * actually contains (integers, strings, booleans, null, arrays, objects). SHA-256
 * comes from `node:crypto`; it is deterministic and I/O-free, so it does not weaken
 * the core purity rules (no clock, environment, filesystem or network access).
 */
import { createHash } from 'node:crypto';

import type { Piece, Position, GameState } from './types.ts';

function byId(a: Piece, b: Piece): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function canonicalPosition(position: Position): Position {
  return { col: position.col, row: position.row };
}

/** Rule-state projection from Engine API v1 section 8 (no gameId, no metadata). */
function projection(state: GameState): Record<string, unknown> {
  return {
    schemaVersion: state.schemaVersion,
    engineVersion: state.engineVersion,
    map: { mapId: state.map.mapId, version: state.map.version, checksum: state.map.checksum },
    status: state.status,
    turn: state.turn,
    turnNumber: state.turnNumber,
    turnCount: state.turnCount,
    revision: state.revision,
    maxTurns: state.maxTurns,
    pieces: [...state.pieces].sort(byId).map((piece) => ({
      id: piece.id,
      owner: piece.owner,
      type: piece.type,
      position: canonicalPosition(piece.position),
    })),
    outcome: state.outcome,
  };
}

/** RFC 8785 canonical JSON: sorted keys, no insignificant whitespace. */
export function canonicalSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalSerialize(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const body = entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalSerialize(entry)}`).join(',');
    return `{${body}}`;
  }
  throw new Error('canonicalSerialize: unsupported value type');
}

/** Lowercase SHA-256 hex of the canonical rule-state projection. */
export function hashGameState(state: GameState): string {
  return createHash('sha256').update(canonicalSerialize(projection(state)), 'utf8').digest('hex');
}
