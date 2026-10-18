/** Keys of `RoundRuleSetRulesV1.schedule` (api/src/modules/rounds/types.ts), in display order. */
export const SCHEDULE_LABELS = {
  submissionOpensAt: 'Mở nộp bài',
  submissionDeadlineAt: 'Hạn nộp bài',
  graceEndsAt: 'Hết thời gian ân hạn',
  runStartsAt: 'Bắt đầu chạy trận',
  runMaxHours: 'Thời lượng chạy tối đa (giờ)',
  appealEndsAt: 'Hết hạn khiếu nại',
} as const satisfies Readonly<Record<string, string>>;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const KEY_ORDER: readonly string[] = Object.keys(SCHEDULE_LABELS);
const vnParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** "HH:mm dd/MM/yyyy" in Vietnam time; anything that is not an ISO date-time is returned unchanged. */
export function formatScheduleValue(value: string): string {
  if (!ISO_DATE_TIME.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const part = Object.fromEntries(vnParts.formatToParts(date).map((entry) => [entry.type, entry.value])) as Record<string, string>;
  return `${part.hour}:${part.minute} ${part.day}/${part.month}/${part.year}`;
}

export function scheduleLabel(key: string): string {
  return Object.prototype.hasOwnProperty.call(SCHEDULE_LABELS, key) ? SCHEDULE_LABELS[key as keyof typeof SCHEDULE_LABELS] : key;
}

/** Known keys first in map order, then unknown keys in their original order. */
export function orderSchedule<T extends { readonly title: string }>(items: readonly T[]): readonly T[] {
  const rank = (title: string) => { const index = KEY_ORDER.indexOf(title); return index === -1 ? KEY_ORDER.length : index; };
  return items.map((item, position) => ({ item, position })).sort((a, b) => rank(a.item.title) - rank(b.item.title) || a.position - b.position).map(({ item }) => item);
}
