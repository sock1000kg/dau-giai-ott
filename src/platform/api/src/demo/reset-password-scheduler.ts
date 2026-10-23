import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { createDatabase } from '../db/client.ts';
import { createPasswordHasher } from '../modules/auth/passwords.ts';
import { createRedisAuthStore } from '../modules/auth/sessions.ts';
import { resetDemoTeamPasswords, resetTargets } from './reset-team-passwords.ts';

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    const [base, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error('Invalid cron step');
    let start = min;
    let end = max;
    if (base === '*') { /* complete range */ }
    else if (base?.includes('-')) {
      const bounds = base.split('-').map(Number);
      if (bounds.length !== 2 || bounds.some((n) => !Number.isInteger(n))) throw new Error('Invalid cron range');
      [start, end] = bounds as [number, number];
    } else {
      start = Number(base);
      end = stepText === undefined ? start : max;
    }
    if (start < min || end > max || start > end) throw new Error('Cron field is out of range');
    return value >= start && value <= end && (value - start) % step === 0;
  });
}

export function cronMatches(expression: string, date: Date, timeZone: string): boolean {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) throw new Error('OTT_DEMO_PASSWORD_RESET_CRON must have five fields');
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en-US', { timeZone, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(date); }
  catch { throw new Error('OTT_DEMO_PASSWORD_RESET_TIMEZONE is invalid'); }
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values['weekday'] ?? '');
  const minute = Number(values['minute']);
  const hour = Number(values['hour']);
  const day = Number(values['day']);
  const month = Number(values['month']);
  return fieldMatches(fields[0]!, minute, 0, 59) && fieldMatches(fields[1]!, hour, 0, 23) && fieldMatches(fields[2]!, day, 1, 31) && fieldMatches(fields[3]!, month, 1, 12) && fieldMatches(fields[4]!, weekday, 0, 7);
}

async function acquireLock(redis: { set(key: string, value: string, options: { readonly NX: true; readonly EX: number }): Promise<unknown> }, token: string): Promise<boolean> {
  return (await redis.set('ott:demo:password-reset:lock', token, { NX: true, EX: 600 })) === 'OK';
}

export async function runScheduler(env: NodeJS.ProcessEnv = process.env): Promise<never> {
  resetTargets(env);
  if (!env.DATABASE_URL || !env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required');
  const cron = env.OTT_DEMO_PASSWORD_RESET_CRON ?? '0 3 * * *';
  const timeZone = env.OTT_DEMO_PASSWORD_RESET_TIMEZONE ?? 'Asia/Ho_Chi_Minh';
  cronMatches(cron, new Date(0), timeZone);
  const database = createDatabase({ connectionString: env.DATABASE_URL });
  const redis = createClient({ url: env.REDIS_URL });
  await redis.connect();
  const sessions = createRedisAuthStore(redis);
  let lastSlot = '';
  try {
    for (;;) {
      const now = new Date();
      const slot = `${timeZone}:${new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)}`;
      if (slot !== lastSlot && cronMatches(cron, now, timeZone)) {
        lastSlot = slot;
        const token = randomUUID();
        if (await acquireLock(redis, token)) {
          try {
            const count = await resetDemoTeamPasswords({ database, passwordHasher: createPasswordHasher(), revokeAccount: (id) => sessions.revokeAccount(id), environment: env });
            process.stdout.write(`Scheduled demo reset completed for ${count} allowlisted account(s).\n`);
          } catch (error) {
            process.stderr.write(`Scheduled demo reset failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
          } finally {
            await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", { keys: ['ott:demo:password-reset:lock'], arguments: [token] });
          }
        }
      }
      await delay(30_000);
    }
  } finally {
    await Promise.all([database.close(), redis.quit()]);
  }
}

if (process.argv[1]?.endsWith('reset-password-scheduler.ts')) {
  runScheduler().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
