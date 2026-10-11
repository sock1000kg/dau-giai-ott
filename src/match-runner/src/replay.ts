/**
 * P1-D07 — Pure in-memory replay verifier over GamePort.
 *
 * Sources of truth: `docs/team-assignment-phase-1-2.md` §8.5, `docs/contracts/engine-api-v1.md` §4/§8,
 * and `docs/contracts/bot-protocol-v1.md` §11.
 *
 * Pure, no I/O, no runtime imports from @ott/game-core, no filesystem imports.
 */
import type {
  GameAction,
  GameEvent,
  GameResult,
  GameState,
  TransitionResult,
} from '@ott/game-core';

import type { EventLogV1 } from './event-log.ts';
import type { GamePort } from './ports.ts';

export type ReplayIssueCode =
  | 'SEQUENCE_GAP'        // entry.index not 1..n, or footer.entryCount !== entries.length
  | 'ENGINE_REJECTED'     // GamePort refused a logged input (ok:false)
  | 'EVENT_MISMATCH'      // replayed events !== logged events (covers edited/reordered events)
  | 'REVISION_MISMATCH'
  | 'STATE_HASH_MISMATCH'
  | 'EXTRA_ENTRIES'       // entries remain after the replayed state is FINISHED
  | 'MISSING_ENTRIES'     // log ends while the replayed state is still PLAYING
  | 'RESULT_MISMATCH'     // footer.result (winner/reason/turnCount/forfeitedSide) !== game.result(final)
  | 'FINAL_HASH_MISMATCH';// footer.result.finalStateHash !== game.hash(final)

export type ReplayVerdict =
  | { readonly ok: true; readonly finalState: GameState; readonly result: GameResult }
  | { readonly ok: false; readonly code: ReplayIssueCode; readonly index: number | null; readonly detail: string };

function sameAction(a: GameAction | null, b: GameAction | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.pieceId === b.pieceId && a.to.col === b.to.col && a.to.row === b.to.row;
}

function sameEvent(a: GameEvent, b: GameEvent): boolean {
  return (
    a.sequence === b.sequence &&
    a.revision === b.revision &&
    a.turnId === b.turnId &&
    a.type === b.type &&
    a.side === b.side &&
    sameAction(a.action, b.action) &&
    a.reason === b.reason
  );
}

function sameEvents(a: readonly GameEvent[], b: readonly GameEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameEvent(a[i]!, b[i]!)) return false;
  }
  return true;
}

/**
 * Verify a match event log by replaying all inputs through GamePort.
 * Deterministic and pure: never mutates the input log or state.
 */
export function verifyReplay(log: EventLogV1, game: GamePort): ReplayVerdict {
  // 1. Check indices contiguity (1..n)
  for (let i = 0; i < log.entries.length; i++) {
    const entry = log.entries[i]!;
    if (entry.index !== i + 1) {
      return {
        ok: false,
        code: 'SEQUENCE_GAP',
        index: entry.index,
        detail: `entry index ${entry.index} at position ${i} does not match expected index ${i + 1}`,
      };
    }
  }

  // Check footer entryCount
  if (log.footer.entryCount !== log.entries.length) {
    return {
      ok: false,
      code: 'SEQUENCE_GAP',
      index: null,
      detail: `footer entryCount (${log.footer.entryCount}) does not match entries count (${log.entries.length})`,
    };
  }

  // 2. Initialize state
  let state = game.create(log.header.game);

  // 3. For each entry
  for (const entry of log.entries) {
    if (state.status === 'FINISHED') {
      return {
        ok: false,
        code: 'EXTRA_ENTRIES',
        index: entry.index,
        detail: `game is already FINISHED before processing entry ${entry.index}`,
      };
    }

    let transition: TransitionResult;
    switch (entry.input.kind) {
      case 'apply':
        transition = game.apply(state, entry.input.side, entry.input.action);
        break;
      case 'skip':
        transition = game.skip(state, entry.input.side, entry.input.reason);
        break;
      case 'forfeit':
        transition = game.forfeit(state, entry.input.side, entry.input.fault);
        break;
    }

    if (!transition.ok) {
      return {
        ok: false,
        code: 'ENGINE_REJECTED',
        index: entry.index,
        detail: `game engine rejected input for entry ${entry.index} with code ${transition.code}`,
      };
    }

    // Compare events
    if (!sameEvents(transition.events, entry.events)) {
      return {
        ok: false,
        code: 'EVENT_MISMATCH',
        index: entry.index,
        detail: `transition events do not match logged events for entry ${entry.index}`,
      };
    }

    // Advance state
    state = transition.state;

    // Compare revision
    if (state.revision !== entry.revision) {
      return {
        ok: false,
        code: 'REVISION_MISMATCH',
        index: entry.index,
        detail: `replayed state revision ${state.revision} does not match logged revision ${entry.revision} for entry ${entry.index}`,
      };
    }

    // Compare stateHash
    const computedHash = game.hash(state);
    if (computedHash !== entry.stateHash) {
      return {
        ok: false,
        code: 'STATE_HASH_MISMATCH',
        index: entry.index,
        detail: `replayed state hash ${computedHash} does not match logged stateHash ${entry.stateHash} for entry ${entry.index}`,
      };
    }
  }

  // 4. After loop: check status
  if (state.status === 'PLAYING') {
    return {
      ok: false,
      code: 'MISSING_ENTRIES',
      index: null,
      detail: `game state is still PLAYING after replaying all entries`,
    };
  }

  // Compare result fields
  const finalResult = game.result(state);
  if (finalResult === null) {
    return {
      ok: false,
      code: 'RESULT_MISMATCH',
      index: null,
      detail: `game engine returned null result for finished state`,
    };
  }

  const loggedResult = log.footer.result;
  if (
    loggedResult.winnerSide !== finalResult.winnerSide ||
    loggedResult.reason !== finalResult.reason ||
    loggedResult.turnCount !== finalResult.turnCount ||
    loggedResult.forfeitedSide !== finalResult.forfeitedSide
  ) {
    return {
      ok: false,
      code: 'RESULT_MISMATCH',
      index: null,
      detail: `replayed result does not match logged footer result`,
    };
  }

  // Check finalStateHash
  const finalHash = game.hash(state);
  if (loggedResult.finalStateHash !== finalHash) {
    return {
      ok: false,
      code: 'FINAL_HASH_MISMATCH',
      index: null,
      detail: `replayed final state hash ${finalHash} does not match logged finalStateHash ${loggedResult.finalStateHash}`,
    };
  }

  return {
    ok: true,
    finalState: state,
    result: finalResult,
  };
}
