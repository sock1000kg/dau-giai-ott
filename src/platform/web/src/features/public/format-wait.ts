/** Plain-Vietnamese wait time for the public queue: seconds → "~N phút" / "~N giờ". */
export function formatWaitDuration(seconds: number): string {
  if (seconds >= 3600) return `~${Math.ceil(seconds / 3600)} giờ`;
  return `~${Math.max(1, Math.ceil(seconds / 60))} phút`;
}

export function formatWait(seconds: number | null): string {
  return seconds === null ? 'Chưa có ước tính' : `Dự kiến chờ ${formatWaitDuration(seconds)}`;
}
