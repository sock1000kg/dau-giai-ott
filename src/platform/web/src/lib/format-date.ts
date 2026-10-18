const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Full date and time in Vietnam time (vi-VN, e.g. "01:30:00 19/10/2026"); an unparseable value is returned unchanged. */
export function formatVietnamDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { timeZone: VIETNAM_TIME_ZONE });
}
