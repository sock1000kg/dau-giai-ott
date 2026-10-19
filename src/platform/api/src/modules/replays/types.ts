export type ReplayPublicationState = 'PRIVATE' | 'STAGED' | 'PUBLISHED';

export interface ReplayPublication {
  readonly matchId: string;
  readonly state: ReplayPublicationState;
  readonly eventLogSha256: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly stagedAt: Date | null;
  readonly publishedAt: Date | null;
}

export interface ReplayCatalogEntry extends Omit<ReplayPublication, 'createdAt' | 'updatedAt'> {
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly seriesId: string;
  readonly stage: string;
  readonly finalizedAt: Date;
  readonly teamX: Readonly<{ id: string; name: string }>;
  readonly teamO: Readonly<{ id: string; name: string }>;
}

export interface ReplayCatalogPage {
  readonly items: readonly ReplayCatalogEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface SpectatorReplayV1 {
  readonly schema: 'ott.spectator-replay';
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly header: Readonly<{
    format: string;
    formatVersion: 1;
    matchId: string;
    protocolVersion: 1;
    engineVersion: string;
    game: Readonly<{ engineVersion: string; maxTurns: number; map: import('@ott/game-core').MapDefinition }>;
  }>;
  readonly entries: readonly import('@ott/match-runner').EventLogEntry[];
  readonly result: import('@ott/game-core').GameResult;
  readonly faults: Readonly<Record<'X' | 'O', import('@ott/bot-protocol').FaultSummary>>;
}

export interface SpectatorReplayV2 {
  readonly schema: 'ott.spectator-replay';
  readonly schemaVersion: 2;
  readonly matchId: string;
  readonly header: Readonly<{
    format: string;
    formatVersion: 2;
    matchId: string;
    protocolVersion: 2;
    engineVersion: string;
    game: Readonly<{ engineVersion: string; maxTurns: number; map: import('@ott/game-core').MapDefinition }>;
    limits: Readonly<{ timeControl: import('@ott/bot-protocol').TimeControlV2 }>;
  }>;
  readonly entries: readonly import('@ott/match-runner').EventLogEntry[];
  readonly timing: readonly import('@ott/match-runner').TimingDecision[];
  readonly result: import('@ott/game-core').GameResult;
  readonly faults: Readonly<Record<'X' | 'O', import('@ott/bot-protocol').FaultSummary>>;
}

export type SpectatorReplay = SpectatorReplayV1 | SpectatorReplayV2;
