import { describe, expect, it } from 'vitest';
import { formatWait } from './format-wait.ts';

describe('formatWait', () => {
  it.each([
    [0, 'Dự kiến chờ ~1 phút'], [1, 'Dự kiến chờ ~1 phút'], [59, 'Dự kiến chờ ~1 phút'], [60, 'Dự kiến chờ ~1 phút'],
    [61, 'Dự kiến chờ ~2 phút'], [3599, 'Dự kiến chờ ~60 phút'], [3600, 'Dự kiến chờ ~1 giờ'], [7200, 'Dự kiến chờ ~2 giờ'],
    [null, 'Chưa có ước tính'],
  ])('%s => %s', (seconds, expected) => { expect(formatWait(seconds)).toBe(expected); });
});
