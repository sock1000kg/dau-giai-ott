export interface FinalsProofMetadata {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly keyId: string;
  readonly manifestSha256: string;
  readonly importedAt: string;
  readonly status: 'VERIFIED';
}

export interface FinalsCriterionScore {
  readonly criterionId: string;
  readonly label: string;
  readonly valueA: number | string;
  readonly valueB: number | string;
}

export interface FinalsGameDetail {
  readonly gameNumber: number;
  readonly sideA: 'X' | 'O';
  readonly sideB: 'X' | 'O';
  readonly mapName: string;
  readonly winnerTeamId: string | null;
  readonly scoreBreakdown?: readonly FinalsCriterionScore[] | undefined;
  readonly replayMatchId?: string | null | undefined;
  readonly replayPublished?: boolean | undefined;
}

export interface FinalsTeamSeed {
  readonly teamId: string;
  readonly teamName: string;
  readonly seedOrdinal: number;
}

export interface FinalsSeriesPairing {
  readonly pairingId: 'QF1' | 'QF2' | 'QF3' | 'QF4' | 'SF1' | 'SF2' | 'B1' | 'F1';
  readonly roundName: string;
  readonly teamA: FinalsTeamSeed | null;
  readonly teamB: FinalsTeamSeed | null;
  readonly bestOf: number;
  readonly status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINALIZED';
  readonly winnerTeamId: string | null;
  readonly score: { readonly winsA: number; readonly winsB: number };
  readonly games: readonly FinalsGameDetail[];
}

export interface FinalsRankingStanding {
  readonly rank: number;
  readonly teamId: string;
  readonly teamName: string;
  readonly seedOrdinal: number;
  readonly qualificationRating: number;
  readonly finalOutcome: string;
}

export interface FinalsSnapshotPayload {
  readonly schemaVersion: 1;
  readonly tournamentId: string;
  readonly finalsRuleSetId: string;
  readonly stage: 'FINALS';
  readonly updatedAt: string;
  readonly proof: FinalsProofMetadata;
  readonly bracket: readonly FinalsSeriesPairing[];
  readonly standings: readonly FinalsRankingStanding[];
}

export class FinalsApiError extends Error {
  public readonly status: number;
  public constructor(message: string, status = 500) {
    super(message);
    this.name = 'FinalsApiError';
    this.status = status;
  }
}

const hashPattern = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FinalsApiError('Invalid string in finals payload', 400);
  }
  return value;
}

function readNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FinalsApiError('Invalid number in finals payload', 400);
  }
  return value;
}

export function parseFinalsProof(value: unknown): FinalsProofMetadata {
  if (!isRecord(value)) throw new FinalsApiError('Invalid proof metadata', 400);
  const bundleId = readString(value['bundleId']);
  const bundleVersion = readNumber(value['bundleVersion']);
  const keyId = readString(value['keyId']);
  const manifestSha256 = readString(value['manifestSha256']);
  const importedAt = readString(value['importedAt']);
  const status = value['status'];

  if (!hashPattern.test(manifestSha256) || status !== 'VERIFIED') {
    throw new FinalsApiError('Invalid proof metadata attributes', 400);
  }

  return {
    bundleId,
    bundleVersion,
    keyId,
    manifestSha256,
    importedAt,
    status: 'VERIFIED',
  };
}

export function parseFinalsSnapshot(value: unknown): FinalsSnapshotPayload {
  if (!isRecord(value)) throw new FinalsApiError('Invalid finals snapshot', 400);
  if (value['schemaVersion'] !== 1 || value['stage'] !== 'FINALS') {
    throw new FinalsApiError('Invalid schemaVersion or stage', 400);
  }

  const tournamentId = readString(value['tournamentId']);
  const finalsRuleSetId = readString(value['finalsRuleSetId']);
  const updatedAt = readString(value['updatedAt']);
  const proof = parseFinalsProof(value['proof']);

  const rawBracket = value['bracket'];
  if (!Array.isArray(rawBracket)) throw new FinalsApiError('Invalid bracket list', 400);

  const bracket: FinalsSeriesPairing[] = rawBracket.map((rawPairing: unknown) => {
    if (!isRecord(rawPairing)) throw new FinalsApiError('Invalid pairing item', 400);
    const pairingId = readString(rawPairing['pairingId']) as FinalsSeriesPairing['pairingId'];
    const roundName = readString(rawPairing['roundName']);
    const bestOf = readNumber(rawPairing['bestOf']);
    const status = readString(rawPairing['status']) as FinalsSeriesPairing['status'];
    const winnerTeamId = rawPairing['winnerTeamId'] === null ? null : readString(rawPairing['winnerTeamId']);

    let teamA: FinalsTeamSeed | null = null;
    if (isRecord(rawPairing['teamA'])) {
      teamA = {
        teamId: readString(rawPairing['teamA']['teamId']),
        teamName: readString(rawPairing['teamA']['teamName']),
        seedOrdinal: readNumber(rawPairing['teamA']['seedOrdinal']),
      };
    }

    let teamB: FinalsTeamSeed | null = null;
    if (isRecord(rawPairing['teamB'])) {
      teamB = {
        teamId: readString(rawPairing['teamB']['teamId']),
        teamName: readString(rawPairing['teamB']['teamName']),
        seedOrdinal: readNumber(rawPairing['teamB']['seedOrdinal']),
      };
    }

    const rawScore = isRecord(rawPairing['score']) ? rawPairing['score'] : { winsA: 0, winsB: 0 };
    const score = {
      winsA: readNumber(rawScore['winsA']),
      winsB: readNumber(rawScore['winsB']),
    };

    const rawGames = Array.isArray(rawPairing['games']) ? rawPairing['games'] : [];
    const games: FinalsGameDetail[] = rawGames.map((g: unknown) => {
      if (!isRecord(g)) throw new FinalsApiError('Invalid game item', 400);
      const gameNumber = readNumber(g['gameNumber']);
      const sideA = readString(g['sideA']) as 'X' | 'O';
      const sideB = readString(g['sideB']) as 'X' | 'O';
      const mapName = readString(g['mapName']);
      const gameWinner = g['winnerTeamId'] === null ? null : readString(g['winnerTeamId']);
      const replayMatchId = g['replayMatchId'] ? String(g['replayMatchId']) : null;
      const replayPublished = Boolean(g['replayPublished']);

      let scoreBreakdown: FinalsCriterionScore[] | undefined;
      if (Array.isArray(g['scoreBreakdown'])) {
        scoreBreakdown = g['scoreBreakdown'].map((c: unknown) => {
          if (!isRecord(c)) throw new FinalsApiError('Invalid criterion score', 400);
          return {
            criterionId: readString(c['criterionId']),
            label: readString(c['label']),
            valueA: typeof c['valueA'] === 'number' ? c['valueA'] : String(c['valueA'] ?? ''),
            valueB: typeof c['valueB'] === 'number' ? c['valueB'] : String(c['valueB'] ?? ''),
          };
        });
      }

      return {
        gameNumber,
        sideA,
        sideB,
        mapName,
        winnerTeamId: gameWinner,
        scoreBreakdown,
        replayMatchId,
        replayPublished,
      };
    });

    return {
      pairingId,
      roundName,
      teamA,
      teamB,
      bestOf,
      status,
      winnerTeamId,
      score,
      games,
    };
  });

  const rawStandings = Array.isArray(value['standings']) ? value['standings'] : [];
  const standings: FinalsRankingStanding[] = rawStandings.map((rawRow: unknown) => {
    if (!isRecord(rawRow)) throw new FinalsApiError('Invalid standing row', 400);
    return {
      rank: readNumber(rawRow['rank']),
      teamId: readString(rawRow['teamId']),
      teamName: readString(rawRow['teamName']),
      seedOrdinal: readNumber(rawRow['seedOrdinal']),
      qualificationRating: readNumber(rawRow['qualificationRating']),
      finalOutcome: readString(rawRow['finalOutcome']),
    };
  });

  return {
    schemaVersion: 1,
    tournamentId,
    finalsRuleSetId,
    stage: 'FINALS',
    updatedAt,
    proof,
    bracket,
    standings,
  };
}

export async function fetchFinalsSnapshot(signal?: AbortSignal): Promise<FinalsSnapshotPayload> {
  const options: RequestInit = { cache: 'no-cache', credentials: 'omit', ...(signal ? { signal } : {}) };
  // 1. Try public finals snapshot endpoint or static snapshot
  let res = await fetch('/api/v1/public/finals/snapshot', options);
  if (!res.ok) {
    res = await fetch('/snapshots/finals-latest.json', options);
  }
  if (!res.ok) {
    throw new FinalsApiError('Finals snapshot unavailable', res.status);
  }
  const data = await res.json();
  const payload = isRecord(data) && 'data' in data ? data['data'] : data;
  return parseFinalsSnapshot(payload);
}

export async function fetchResultBundleProof(
  bundleId: string,
  signal?: AbortSignal,
): Promise<FinalsProofMetadata> {
  const options: RequestInit = { cache: 'no-cache', credentials: 'omit', ...(signal ? { signal } : {}) };
  const res = await fetch(`/api/v1/public/result-bundles/${encodeURIComponent(bundleId)}`, options);
  if (!res.ok) {
    throw new FinalsApiError('Result bundle proof unavailable', res.status);
  }
  const json = await res.json();
  const items = isRecord(json) && isRecord(json['data']) && Array.isArray(json['data']['items'])
    ? json['data']['items']
    : [];
  if (items.length === 0) {
    throw new FinalsApiError('No verified proof found for bundle', 404);
  }
  return parseFinalsProof(items[items.length - 1]);
}
