import { describe, expect, it } from 'vitest';
import { formatVietnamDateTime } from './format-date.ts';

describe('formatVietnamDateTime', () => {
  it('renders in Vietnam time regardless of the host time zone', () => {
    expect(formatVietnamDateTime('2026-10-18T17:30:00.000Z')).toBe('00:30:00 19/10/2026');
    expect(formatVietnamDateTime('2026-10-18T00:00:00Z')).toBe('07:00:00 18/10/2026');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatVietnamDateTime('not-a-date')).toBe('not-a-date');
  });
});
