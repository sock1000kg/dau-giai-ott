export interface WorstCaseInput {
  readonly teamCount: number;
  readonly concurrency: number;
  readonly matchWallClockMs: number;
  readonly runMaxHours: number;
}

export interface WorstCaseEstimate {
  readonly series: number;
  readonly games: number;
  readonly waves: number;
  readonly worstMs: number;
  readonly exceedsWindow: boolean;
}

export function estimateWorstCase(input: WorstCaseInput): WorstCaseEstimate {
  const teams = Math.max(0, Math.floor(input.teamCount));
  const concurrency = Math.max(1, Math.floor(input.concurrency));
  const series = Math.floor(teams / 2);
  const games = 2 * series;
  const waves = games === 0 ? 0 : Math.ceil(games / concurrency);
  const worstMs = waves * Math.max(0, input.matchWallClockMs);
  const exceedsWindow = worstMs > Math.max(0, input.runMaxHours) * 3_600_000;
  return { series, games, waves, worstMs, exceedsWindow };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}
