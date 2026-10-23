import { describe, expect, it } from 'vitest';
import { cronMatches } from '../src/demo/reset-password-scheduler.ts';

describe('P2-T59 local demo reset schedule', () => {
  it('defaults to the configured 03:00 Vietnam time slot', () => {
    expect(cronMatches('0 3 * * *', new Date('2026-10-23T20:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe(true);
    expect(cronMatches('0 3 * * *', new Date('2026-10-23T19:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe(false);
  });

  it('supports cron list/range/step fields and timezone overrides', () => {
    expect(cronMatches('*/15 1-4 1,15 * 1-5', new Date('2026-10-15T02:30:00.000Z'), 'UTC')).toBe(true);
    expect(cronMatches('*/15 1-4 1,15 * 1-5', new Date('2026-10-15T02:31:00.000Z'), 'UTC')).toBe(false);
  });

  it('rejects malformed cron and timezone values', () => {
    expect(() => cronMatches('0 3 * *', new Date(), 'UTC')).toThrow(/five fields/);
    expect(() => cronMatches('99 3 * * *', new Date(), 'UTC')).toThrow(/out of range/);
    expect(() => cronMatches('0 3 * * *', new Date(), 'No/Such_Zone')).toThrow(/TIMEZONE/);
  });
});
