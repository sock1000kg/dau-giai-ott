import { createHash } from 'node:crypto';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP, ENGINE_VERSION, type MapDefinition } from '@ott/game-core';

import type { RoundRuleSetRulesV1, ValidationError } from './types.ts';

export interface RegisteredMap {
  readonly mapId: string;
  readonly version: number;
  readonly checksum: string;
  readonly definition: MapDefinition;
}

export interface MatchRules {
  readonly engineVersion: string;
  readonly maxTurns: number;
  readonly turnTimeoutMs: number;
  readonly maps: readonly RegisteredMap[];
}

/** Adding an engine/map/fault policy = adding one entry here (see the API README). */
export const ENGINE_VERSIONS: readonly string[] = [ENGINE_VERSION];

/** The default map checksum is a placeholder (`'a' * 64`), not a content hash; no hashing scheme is defined yet. */
export const MAP_REGISTRY: readonly RegisteredMap[] = [
  { mapId: DEFAULT_MAP.mapId, version: DEFAULT_MAP.version, checksum: DEFAULT_MAP.checksum, definition: DEFAULT_MAP },
];

export const FAULT_POLICY_VERSIONS: readonly string[] = ['P2_BASELINE_V1'];

export function findMap(mapId: string, checksum: string): RegisteredMap | undefined {
  return MAP_REGISTRY.find((entry) => entry.mapId === mapId && entry.checksum === checksum);
}

export function isKnownEngine(engineVersion: string): boolean {
  return ENGINE_VERSIONS.includes(engineVersion);
}

export function isKnownFaultPolicy(faultPolicyVersion: string): boolean {
  return FAULT_POLICY_VERSIONS.includes(faultPolicyVersion);
}

/** Interim rule: the v1 job carries one timeout, so it is the largest per-turn limit of the rule set. */
export function maxPerTurnMs(perTurn: RoundRuleSetRulesV1['timeControl']['perTurn']): number {
  return perTurn.mode === 'FIXED' ? perTurn.fixedMs : perTurn.maxMs;
}

/** Second validation step; expects rules that already passed `validateRoundRuleSetRules`. */
export function validateAgainstCatalog(rules: RoundRuleSetRulesV1): readonly ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isKnownEngine(rules.engineVersion)) errors.push({ path: 'engineVersion', code: 'UNKNOWN_ENGINE_VERSION' });
  rules.mapSet.forEach((entry, index) => {
    const byId = MAP_REGISTRY.filter((registered) => registered.mapId === entry.mapId);
    if (byId.length === 0) errors.push({ path: `mapSet[${index}].mapId`, code: 'UNKNOWN_MAP' });
    else if (!byId.some((registered) => registered.checksum === entry.checksum)) {
      errors.push({ path: `mapSet[${index}].checksum`, code: 'UNKNOWN_MAP' });
    }
  });
  if (!isKnownFaultPolicy(rules.faultPolicyVersion)) errors.push({ path: 'faultPolicyVersion', code: 'UNKNOWN_FAULT_POLICY' });
  if (rules.maxTurns > DEFAULT_LIMITS.maxTurns) errors.push({ path: 'maxTurns', code: 'MAX_TURNS_EXCEEDS_RUNNER_LIMIT' });
  const perTurn = rules.timeControl.perTurn;
  if (maxPerTurnMs(perTurn) > DEFAULT_LIMITS.turnTimeoutMs) {
    errors.push({
      path: perTurn.mode === 'FIXED' ? 'timeControl.perTurn.fixedMs' : 'timeControl.perTurn.maxMs',
      code: 'TURN_LIMIT_EXCEEDS_RUNNER_LIMIT',
    });
  }
  return errors;
}

/** Resolve a locked rule set into the match snapshot inputs; null if any registry entry is missing. */
export function resolveMatchRules(rules: RoundRuleSetRulesV1): MatchRules | null {
  if (!isKnownEngine(rules.engineVersion)) return null;
  const maps: RegisteredMap[] = [];
  for (const entry of rules.mapSet) {
    const found = findMap(entry.mapId, entry.checksum);
    if (found === undefined) return null;
    maps.push(found);
  }
  if (maps.length === 0) return null;
  return {
    engineVersion: rules.engineVersion,
    maxTurns: rules.maxTurns,
    turnTimeoutMs: maxPerTurnMs(rules.timeControl.perTurn),
    maps,
  };
}

/** Deterministic per-series map index; both games of a series share it (side-swap fairness). */
export function selectMapIndex(scheduleSeed: string, seriesId: string, mapCount: number): number {
  const digest = createHash('sha256').update(`${scheduleSeed}:${seriesId}:map`).digest('hex');
  return Number.parseInt(digest.slice(0, 8), 16) % mapCount;
}

export interface CatalogView {
  readonly engineVersions: readonly string[];
  readonly maps: readonly { readonly mapId: string; readonly version: number; readonly checksum: string; readonly width: number; readonly height: number }[];
  readonly faultPolicyVersions: readonly string[];
}

export function catalogView(): CatalogView {
  return {
    engineVersions: [...ENGINE_VERSIONS],
    maps: MAP_REGISTRY.map(({ mapId, version, checksum, definition }) => ({
      mapId, version, checksum, width: definition.width, height: definition.height,
    })),
    faultPolicyVersions: [...FAULT_POLICY_VERSIONS],
  };
}
