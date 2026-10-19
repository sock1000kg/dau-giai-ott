import type { Piece, PlayerSide, Position } from '@ott/game-core';
import type { ReplayInput, SpectatorReplay } from './replay-schema.ts';
import { supportsHistoricalReplay } from './replay-schema.ts';

export interface ReplayFrame {
  readonly pieces: readonly Piece[];
  readonly revision: number;
  readonly activeSide: PlayerSide;
  readonly turnId: number;
  readonly finished: boolean;
}

export interface ReplayTimelineEvent {
  readonly event: SpectatorReplay['entries'][number]['events'][number];
  readonly entryIndex: number;
}

export interface ReplayTimeline {
  /** Frame zero is the board from the map before the first recorded event. */
  readonly frames: readonly ReplayFrame[];
  readonly events: readonly ReplayTimelineEvent[];
}

export interface ReplayMove {
  readonly entryIndex: number;
  readonly eventIndex: number;
  readonly turnId: number;
  readonly input: ReplayInput;
}

/** A move seeks to its entry's last frame, including a terminal event emitted by the same move. */
export function createReplayMoves(replay: SpectatorReplay): readonly ReplayMove[] {
  let eventIndex = 0;
  return replay.entries.map((entry) => {
    eventIndex += entry.events.length;
    return { entryIndex: entry.index, eventIndex, turnId: entry.events[0]!.turnId, input: entry.input };
  });
}

export class ReplayTimelineError extends Error {
  public constructor() {
    super('Replay actions cannot be reproduced from the recorded events');
    this.name = 'ReplayTimelineError';
  }
}

function sameAction(left: ReplayInput, event: SpectatorReplay['entries'][number]['events'][number]): boolean {
  if (left.kind === 'apply') return event.type === 'ACTION_APPLIED' && event.side === left.side
    && JSON.stringify(event.action) === JSON.stringify(left.action) && event.reason === null;
  if (left.kind === 'skip') return event.type === 'TURN_SKIPPED' && event.side === left.side && event.reason === left.reason;
  return event.type === 'MATCH_FINISHED' && event.side === left.side && event.reason === 'FORFEIT';
}

/** Build read-only board snapshots from the verified event stream; never runs a live game. */
export function createReplayTimeline(replay: SpectatorReplay): ReplayTimeline {
  if (!supportsHistoricalReplay(replay.header.engineVersion, replay.header.protocolVersion, replay.header.formatVersion)
    || replay.header.game.engineVersion !== replay.header.engineVersion) throw new ReplayTimelineError();
  const pieces: Piece[] = replay.header.game.map.spawns.map((spawn) => ({
    id: spawn.id,
    owner: spawn.owner,
    type: spawn.type,
    position: { ...spawn.position },
  }));
  const initial: ReplayFrame = { pieces, revision: 0, activeSide: 'X', turnId: 1, finished: false };
  const frames: ReplayFrame[] = [initial];
  const events: ReplayTimelineEvent[] = [];
  let frame = initial;

  for (const entry of replay.entries) {
    if (entry.events.length === 0 || !sameAction(entry.input, entry.events[0]!)) throw new ReplayTimelineError();
    for (const event of entry.events) {
      let nextPieces = frame.pieces;
      if (event.type === 'ACTION_APPLIED' && event.action) {
        const moving = frame.pieces.find((piece) => piece.id === event.action!.pieceId && piece.owner === event.side);
        if (!moving || event.action.to.col > 8 || event.action.to.row > 8) throw new ReplayTimelineError();
        const destination: Position = event.action.to;
        nextPieces = frame.pieces
          .filter((piece) => piece.id !== moving.id && !(piece.owner !== event.side
            && piece.position.col === destination.col && piece.position.row === destination.row))
          .concat({ ...moving, position: { ...destination } })
          .sort((left, right) => left.id.localeCompare(right.id));
      }
      frame = {
        pieces: nextPieces,
        revision: event.revision,
        activeSide: event.type === 'MATCH_FINISHED' ? event.side : event.side === 'X' ? 'O' : 'X',
        turnId: event.turnId,
        finished: event.type === 'MATCH_FINISHED',
      };
      events.push({ event, entryIndex: entry.index });
      frames.push(frame);
    }
  }

  const last = events.at(-1)?.event;
  const expectedFinishSide = replay.result.forfeitedSide ?? replay.result.winnerSide;
  if (!last || last.type !== 'MATCH_FINISHED' || last.reason !== replay.result.reason
    || (expectedFinishSide !== null && last.side !== expectedFinishSide)) {
    throw new ReplayTimelineError();
  }
  return { frames, events };
}

export type ReplaySpeed = 0.5 | 1 | 2;
export interface PlaybackState {
  readonly eventIndex: number;
  readonly isPlaying: boolean;
  readonly speed: ReplaySpeed;
}
export type PlaybackAction =
  | { readonly type: 'PLAY'; readonly eventCount: number }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'ADVANCE'; readonly eventCount: number }
  | { readonly type: 'SEEK'; readonly eventIndex: number; readonly eventCount: number }
  | { readonly type: 'SET_SPEED'; readonly speed: ReplaySpeed }
  | { readonly type: 'RESTART' };

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'PLAY': return state.eventIndex >= action.eventCount ? { ...state, isPlaying: false } : { ...state, isPlaying: true };
    case 'PAUSE': return { ...state, isPlaying: false };
    case 'ADVANCE': {
      const eventIndex = Math.min(action.eventCount, state.eventIndex + 1);
      return { ...state, eventIndex, isPlaying: eventIndex < action.eventCount && state.isPlaying };
    }
    case 'SEEK': {
      const eventIndex = Math.max(0, Math.min(action.eventCount, action.eventIndex));
      return { ...state, eventIndex, isPlaying: false };
    }
    case 'SET_SPEED': return { ...state, speed: action.speed };
    case 'RESTART': return { ...state, eventIndex: 0, isPlaying: false };
  }
}

export function initialPlaybackState(): PlaybackState {
  return { eventIndex: 0, isPlaying: false, speed: 1 };
}
