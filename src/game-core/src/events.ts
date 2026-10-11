/**
 * Deterministic transition events for Engine API v1 (P1-L07).
 *
 * Events are the replay log the runner persists. They contain no clock reading,
 * randomness or process metadata, so replaying the same inputs yields the same
 * event sequence and `finalStateHash`.
 */
import type { GameAction, GameEvent, GameEventType, GameResultReason, PlayerSide, SkipReason } from './types.ts';

export interface EventInput {
  readonly sequence: number;
  readonly revision: number;
  readonly turnId: number;
  readonly type: GameEventType;
  readonly side: PlayerSide;
  readonly action: GameAction | null;
  readonly reason: SkipReason | GameResultReason | null;
}

/** Build a `GameEvent` from an explicit, fully deterministic input. */
export function createEvent(input: EventInput): GameEvent {
  return {
    sequence: input.sequence,
    revision: input.revision,
    turnId: input.turnId,
    type: input.type,
    side: input.side,
    action: input.action,
    reason: input.reason,
  };
}

/**
 * Deterministic event sequence number. Each transition reserves two slots (the
 * primary event, then the optional MATCH_FINISHED event) so the counter is strictly
 * increasing across a match without storing extra state.
 */
export function eventSequence(revision: number, index: number): number {
  return revision * 2 + index;
}

/** True when an event carries only replay-safe fields (no clock or process data). */
export function isReplaySafeEvent(event: GameEvent): boolean {
  const keys = Object.keys(event).sort();
  const allowed = ['action', 'reason', 'revision', 'sequence', 'side', 'turnId', 'type'];
  return keys.length === allowed.length && keys.every((key, index) => key === allowed[index]);
}
