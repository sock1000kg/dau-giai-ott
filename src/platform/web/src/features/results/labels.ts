const STATUS_LABELS: Readonly<Record<string, string>> = { FINALIZED: 'Đã chốt', FAILED: 'Lỗi hạ tầng', CANCELLED: 'Đã hủy' };
const REASON_LABELS: Readonly<Record<string, string>> = { REACHED_GOAL: 'Chạm đích', ELIMINATED_ALL_PIECES: 'Loại hết quân', TURN_LIMIT: 'Hết giới hạn lượt', FORFEIT: 'Bỏ cuộc' };
const CANCELLATION_LABELS: Readonly<Record<string, string>> = { MATCH_CANCELLED: 'Trận bị hủy', INFRASTRUCTURE_FAILURE: 'Lỗi hạ tầng' };

const lookup = (labels: Readonly<Record<string, string>>, code: string): string => Object.hasOwn(labels, code) ? labels[code] as string : code;

export const statusLabel = (code: string): string => lookup(STATUS_LABELS, code);
export const reasonLabel = (code: string): string => lookup(REASON_LABELS, code);
export const cancellationLabel = (code: string): string => lookup(CANCELLATION_LABELS, code);

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** `HH:mm dd/MM/yyyy` in Vietnam time; null or unparsable ⇒ "—". */
export function formatVnDate(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const part = Object.fromEntries(VN_DATE.formatToParts(date).map((item) => [item.type, item.value]));
  return `${part.hour}:${part.minute} ${part.day}/${part.month}/${part.year}`;
}
