import type { RoundSummary, RuleSetSummary } from './api.ts';

/** The round whose locked rule set is "current": highest `roundNumber` with a rule set that left DRAFT_RULES. */
export function selectCurrentLockedRound(rounds: readonly RoundSummary[]): RoundSummary | null {
  let best: RoundSummary | null = null;
  for (const round of rounds) {
    if (round.ruleSetId === null || round.status === 'DRAFT_RULES') continue;
    if (best === null || round.roundNumber > best.roundNumber) best = round;
  }
  return best;
}

/** Rounds (ascending) that reference a rule set version. */
export function roundsUsingRuleSet(rounds: readonly RoundSummary[], ruleSetId: string): readonly RoundSummary[] {
  return rounds.filter((round) => round.ruleSetId === ruleSetId).sort((left, right) => left.roundNumber - right.roundNumber);
}

/** Newest version first, independent of API order. */
export function sortRuleSetsNewestFirst(ruleSets: readonly RuleSetSummary[]): readonly RuleSetSummary[] {
  return [...ruleSets].sort((left, right) => right.version - left.version);
}
