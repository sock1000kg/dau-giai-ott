export interface PairingParticipant {
  readonly teamId: string;
  readonly submissionId: string;
  readonly rating: number;
}

export interface Pairing {
  readonly x: PairingParticipant;
  readonly o: PairingParticipant;
  readonly ratingBand: number;
  readonly rematch: boolean;
}

export interface PairingPlan {
  readonly pairings: readonly Pairing[];
  readonly bye: PairingParticipant | null;
}

export interface PairingOptions {
  readonly previousPairs?: ReadonlySet<string>;
  readonly previousByes?: ReadonlySet<string>;
  readonly initialRatingBand?: number;
  readonly ratingBandStep?: number;
}

export function pairKey(teamA: string, teamB: string): string {
  return [teamA, teamB].sort().join(':');
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createPairingPlan(
  participants: readonly PairingParticipant[],
  options: PairingOptions = {},
): PairingPlan {
  const ordered = [...participants].sort((a, b) => b.rating - a.rating || compareId(a.teamId, b.teamId));
  if (ordered.some((participant) => !Number.isSafeInteger(participant.rating))) throw new Error('RATING_INVALID');
  if (new Set(ordered.map(({ teamId }) => teamId)).size !== ordered.length) throw new Error('TEAM_DUPLICATE');
  if (new Set(ordered.map(({ submissionId }) => submissionId)).size !== ordered.length) throw new Error('SUBMISSION_DUPLICATE');

  const previousPairs = options.previousPairs ?? new Set<string>();
  const previousByes = options.previousByes ?? new Set<string>();
  const initialBand = options.initialRatingBand ?? 200;
  const bandStep = options.ratingBandStep ?? 100;
  if (!Number.isSafeInteger(initialBand) || initialBand < 0 || !Number.isSafeInteger(bandStep) || bandStep <= 0) {
    throw new Error('RATING_BAND_INVALID');
  }

  let bye: PairingParticipant | null = null;
  const pending = [...ordered];
  if (pending.length % 2 === 1) {
    bye = [...pending].sort((a, b) => Number(previousByes.has(a.teamId)) - Number(previousByes.has(b.teamId))
      || a.rating - b.rating || compareId(b.teamId, a.teamId))[0] ?? null;
    if (bye !== null) pending.splice(pending.findIndex(({ teamId }) => teamId === bye!.teamId), 1);
  }

  const pairings: Pairing[] = [];
  while (pending.length > 0) {
    const x = pending.shift()!;
    const candidates = pending.map((o, index) => ({ o, index, difference: Math.abs(x.rating - o.rating) }));
    const withoutRematch = candidates.filter(({ o }) => !previousPairs.has(pairKey(x.teamId, o.teamId)));
    const preferred = withoutRematch.length > 0 ? withoutRematch : candidates;
    const minimumDifference = Math.min(...preferred.map(({ difference }) => difference));
    const band = Math.max(initialBand, initialBand + Math.ceil((minimumDifference - initialBand) / bandStep) * bandStep);
    const eligible = preferred.filter(({ difference }) => difference <= band);
    eligible.sort((a, b) => Number(previousPairs.has(pairKey(x.teamId, a.o.teamId)))
      - Number(previousPairs.has(pairKey(x.teamId, b.o.teamId)))
      || a.difference - b.difference || compareId(a.o.teamId, b.o.teamId));
    const selected = eligible[0];
    if (selected === undefined) throw new Error('PAIRING_INCOMPLETE');
    pending.splice(selected.index, 1);
    pairings.push({ x, o: selected.o, ratingBand: band, rematch: previousPairs.has(pairKey(x.teamId, selected.o.teamId)) });
  }

  return { pairings, bye };
}
