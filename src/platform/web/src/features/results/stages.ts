export interface StageOption { readonly value: string; readonly label: string }

/** Stages the platform schedules today (api migrations default `QUALIFICATION`; replay publication is FINALS-only). */
export const KNOWN_STAGES: readonly StageOption[] = [
  { value: 'QUALIFICATION', label: 'Vòng loại · QUALIFICATION' },
  { value: 'FINALS', label: 'Chung kết · FINALS' },
];

/** Known stages first, then any other stage seen in results or selected (sorted, raw code) so none is un-selectable. */
export function stageOptions(extra: Iterable<string>): readonly StageOption[] {
  const known = new Set(KNOWN_STAGES.map((stage) => stage.value));
  const others = [...new Set(extra)].filter((value) => value !== '' && !known.has(value)).sort();
  return [...KNOWN_STAGES, ...others.map((value) => ({ value, label: value }))];
}
