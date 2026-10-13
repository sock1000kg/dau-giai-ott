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
