import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, beforeAll } from 'vitest';

import {
  DEMO_E2E_MAX_WAIT_TO_CLOSE_MS,
  buildDemoRuleSetSchedule,
  type DemoScheduleResult,
} from './local-demo-schedule.js';

const execFileAsync = promisify(execFile);

// -----------------------------------------------------------------------------
// Cookie Jar Helper
// -----------------------------------------------------------------------------
class CookieJar {
  private readonly cookies = new Map<string, string>();

  public updateFromHeaders(headers: Headers): void {
    const rawCookies: string[] = [];
    const getSetCookieFn = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookieFn === 'function') {
      rawCookies.push(...getSetCookieFn.call(headers));
    } else {
      const single = headers.get('set-cookie');
      if (single) {
        rawCookies.push(single);
      }
    }

    for (const raw of rawCookies) {
      const parts = raw.split(';')[0]?.trim();
      if (parts) {
        const eqIdx = parts.indexOf('=');
        if (eqIdx > 0) {
          const name = parts.slice(0, eqIdx).trim();
          const value = parts.slice(eqIdx + 1).trim();
          this.cookies.set(name, value);
        }
      }
    }
  }

  public getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  public clear(): void {
    this.cookies.clear();
  }
}

// -----------------------------------------------------------------------------
// HTTP Request Wrapper & Diagnostic Status Asserter
// -----------------------------------------------------------------------------
interface ApiRequestOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | Uint8Array;
  readonly jar?: CookieJar;
}

async function apiRequest(
  baseUrl: string,
  endpoint: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const url = `${baseUrl}${endpoint}`;
  const headers = new Headers(options.headers);
  if (options.jar) {
    const cookieHeader = options.jar.getCookieHeader();
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body as any,
  });

  if (options.jar) {
    options.jar.updateFromHeaders(response.headers);
  }

  return response;
}

async function assertStatus(
  res: Response,
  expected: number | number[],
  description: string,
): Promise<string> {
  const text = await res.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  expect(
    allowed.includes(res.status),
    `${description}: expected HTTP ${allowed.join('/')}, got ${res.status}. Body: ${text}`,
  ).toBe(true);
  return text;
}

// -----------------------------------------------------------------------------
// Demo Accounts CSV Parser
// -----------------------------------------------------------------------------
interface DemoAccount {
  readonly username: string;
  readonly password: string;
  readonly role: string;
  readonly team?: string;
}

function loadDemoAccounts(csvPath: string): Map<string, DemoAccount> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Demo accounts CSV not found at: ${csvPath}`);
  }
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const map = new Map<string, DemoAccount>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [username, password, role, team] = line.split(',');
    if (username && password !== undefined && role) {
      map.set(username.trim(), {
        username: username.trim(),
        password: password.trim(),
        role: role.trim(),
        ...(team?.trim() ? { team: team.trim() } : {}),
      });
    }
  }
  return map;
}

// -----------------------------------------------------------------------------
// Test Suite
// -----------------------------------------------------------------------------
describe('Clean-checkout local demo qualification E2E (P2-T37 API-level)', () => {
  const baseUrl = process.env.OTT_E2E_BASE_URL ?? 'http://127.0.0.1:8080';
  const projectName = process.env.OTT_DEMO_PROJECT ?? 'ott-demo-e2e';
  const accountsCsvPath = process.env.OTT_E2E_ACCOUNTS_CSV ?? path.resolve(process.cwd(), '.local/demo/accounts.csv');

  const btcJar = new CookieJar();
  const team01Jar = new CookieJar();
  const team02Jar = new CookieJar();

  let accounts: Map<string, DemoAccount>;
  let roundId = '';
  let ruleSetId = '';
  let demoSchedule: DemoScheduleResult | null = null;
  let submission01Id = '';
  let submission02Id = '';
  let fixture01Buffer: Buffer;
  let fixture02Buffer: Buffer;
  let fixture01Sha256 = '';
  let fixture02Sha256 = '';
  let firstMatchId = '';
  let firstMatchTeamNames: { x: string; o: string } | null = null;

  // Inter-step dependency tracking
  let t1Active = false;
  let t2Active = false;
  let submission01Status = '';
  let submission02Status = '';

  const fixture1Path = path.resolve(process.cwd(), 'src/bots/sandbox-corpus/artifacts/oci-fixtures/v2-first-legal.oci.tar');
  const fixture2Path = path.resolve(process.cwd(), 'src/bots/sandbox-corpus/artifacts/oci-fixtures/v2-capture-first.oci.tar');
  const hasFixtures = fs.existsSync(fixture1Path) && fs.existsSync(fixture2Path);

  beforeAll(() => {
    accounts = loadDemoAccounts(accountsCsvPath);
    expect(accounts.has('btc'), 'Accounts CSV must contain btc').toBe(true);
    expect(accounts.has('team01'), 'Accounts CSV must contain team01').toBe(true);
    expect(accounts.has('team02'), 'Accounts CSV must contain team02').toBe(true);

    if (hasFixtures) {
      fixture01Buffer = fs.readFileSync(fixture1Path);
      fixture02Buffer = fs.readFileSync(fixture2Path);
      fixture01Sha256 = `sha256:${crypto.createHash('sha256').update(fixture01Buffer).digest('hex')}`;
      fixture02Sha256 = `sha256:${crypto.createHash('sha256').update(fixture02Buffer).digest('hex')}`;
    }
  });

  // ---------------------------------------------------------------------------
  // Step A: Gateway and Health Probe Reachability
  // ---------------------------------------------------------------------------
  it('a. verifies gateway /healthz, /api/v1/health/ready, SPA /, and /snapshots/ are reachable', async () => {
    // Gateway /healthz
    const healthzRes = await apiRequest(baseUrl, '/healthz');
    await assertStatus(healthzRes, 200, 'GET /healthz reachability');

    // Platform API live probe
    const healthLiveRes = await apiRequest(baseUrl, '/api/v1/health/live');
    await assertStatus(healthLiveRes, 200, 'GET /api/v1/health/live reachability');

    // Gateway ready probe /api/v1/health/ready
    const readyRes = await apiRequest(baseUrl, '/api/v1/health/ready');
    const readyText = await assertStatus(readyRes, 200, 'GET /api/v1/health/ready probe');
    const readyJson = JSON.parse(readyText) as { status?: string };
    expect(readyJson.status, 'Ready probe status must be "ready"').toBe('ready');

    // Gateway SPA /
    const spaRes = await apiRequest(baseUrl, '/');
    const spaText = await assertStatus(spaRes, 200, 'GET / SPA root');
    expect(spaText.toLowerCase(), 'SPA root response must be HTML').toContain('html');

    // Gateway snapshots directory /snapshots/
    const snapshotsRes = await apiRequest(baseUrl, '/snapshots/');
    expect([200, 404], `GET /snapshots/ through gateway must be reachable (got ${snapshotsRes.status})`).toContain(snapshotsRes.status);
  });

  // ---------------------------------------------------------------------------
  // Step B: User Authentication via Gateway
  // ---------------------------------------------------------------------------
  it('b. authenticates btc, team01, and team02 via gateway; rejects wrong credentials with 401', async () => {
    const btcAccount = accounts.get('btc')!;
    const team01Account = accounts.get('team01')!;
    const team02Account = accounts.get('team02')!;

    // Login BTC
    const btcLoginRes = await apiRequest(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: btcAccount.username, password: btcAccount.password }),
      jar: btcJar,
    });
    await assertStatus(btcLoginRes, 200, 'BTC admin login');
    expect(btcJar.getCookieHeader(), 'BTC login must set session cookie').toContain('ott_session');

    // Login Team 01
    const t1LoginRes = await apiRequest(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: team01Account.username, password: team01Account.password }),
      jar: team01Jar,
    });
    await assertStatus(t1LoginRes, 200, 'Team 01 login');
    expect(team01Jar.getCookieHeader(), 'Team 01 login must set session cookie').toContain('ott_session');

    // Login Team 02
    const t2LoginRes = await apiRequest(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: team02Account.username, password: team02Account.password }),
      jar: team02Jar,
    });
    await assertStatus(t2LoginRes, 200, 'Team 02 login');
    expect(team02Jar.getCookieHeader(), 'Team 02 login must set session cookie').toContain('ott_session');

    // Wrong password returns 401
    const badLoginRes = await apiRequest(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'btc', password: 'wrong-password-for-test' }),
    });
    await assertStatus(badLoginRes, 401, 'Bad credentials rejection');
  });

  // ---------------------------------------------------------------------------
  // Step C: BTC Opens Qualification Round
  // ---------------------------------------------------------------------------
  it('c. BTC resolves/creates rule set and opens qualification round (SUBMISSION_OPEN)', async () => {
    // 1. Always create a fresh rule set for this run with a short, relative schedule
    const catalogRes = await apiRequest(baseUrl, '/api/v1/admin/rounds/catalog', { jar: btcJar });
    const catalogText = await assertStatus(catalogRes, 200, 'GET /api/v1/admin/rounds/catalog');
    const catalogJson = JSON.parse(catalogText) as {
      data?: {
        maps?: Array<{ mapId: string; checksum: string }>;
        engineVersions?: string[];
        faultPolicyVersions?: string[];
      };
    };

    const mapEntry = catalogJson.data?.maps?.[0];
    const mapId = mapEntry?.mapId ?? 'default';
    const mapChecksum = mapEntry?.checksum ?? '';
    const engineVer = catalogJson.data?.engineVersions?.[0] ?? '1.0.0';
    const faultPolicy = catalogJson.data?.faultPolicyVersions?.[0] ?? 'P2_BASELINE_V1';

    // Build fresh relative schedule (D ~75s margin covers reservations and uploads, grace = deadline + 5s)
    demoSchedule = buildDemoRuleSetSchedule();
    const createRuleSetPayload = {
      tournamentStage: 'QUALIFICATION',
      reason: `Demo qualification rule set via E2E test ${Date.now()}`,
      rules: {
        schemaVersion: 'ott.round-rules.v1',
        engineVersion: engineVer,
        mapSet: [{ mapId, checksum: mapChecksum }],
        maxTurns: 200,
        faultPolicyVersion: faultPolicy,
        timeControl: {
          startupMs: 5000,
          totalBotBudgetMs: 60000,
          matchWallClockMs: 120000,
          perTurn: { mode: 'FIXED', fixedMs: 200 },
        },
        resources: {
          memoryMiB: 256,
          milliCpu: 1000,
          pids: 32,
          tmpfsMiB: 64,
          archiveMiB: 32,
          unpackedMiB: 128,
          maxLayers: 16,
        },
        schedule: demoSchedule.schedule,
        testRun: {
          quotaPerTeamPerDay: 5,
          opponents: ['OWN_SUBMISSION', 'BTC_REFERENCE'],
        },
      },
    };

    const createRsRes = await apiRequest(baseUrl, '/api/v1/admin/round-rule-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRuleSetPayload),
      jar: btcJar,
    });
    const createRsText = await assertStatus(createRsRes, [200, 201], 'POST /api/v1/admin/round-rule-sets');
    const createRsJson = JSON.parse(createRsText) as { data?: { id: string } };
    ruleSetId = createRsJson.data?.id ?? '';
    expect(ruleSetId, 'Fresh rule set ID must be established').toBeTruthy();

    // 2. Check existing rounds in QUALIFICATION stage
    const roundsRes = await apiRequest(baseUrl, '/api/v1/admin/rounds?tournamentStage=QUALIFICATION', {
      jar: btcJar,
    });
    const roundsText = await assertStatus(roundsRes, 200, 'GET /api/v1/admin/rounds');
    const roundsJson = JSON.parse(roundsText) as {
      data?: { items?: Array<{ id: string; status: string; ruleSetId?: string }> };
    };

    // If an active round exists whose rule set is not this run's, fail with a clear message naming it
    const activeRounds = roundsJson.data?.items?.filter((r) => r.status !== 'PUBLISHED') ?? [];
    if (activeRounds.length > 0) {
      const active = activeRounds[0]!;
      throw new Error(
        `Cannot create fresh round: existing active round ${active.id} (status: ${active.status}, ruleSetId: ${active.ruleSetId ?? 'none'}) is not this run's fresh rule set (${ruleSetId}). Ensure stack is reset before test.`,
      );
    }

    // Create fresh round in DRAFT_RULES status
    const createRoundRes = await apiRequest(baseUrl, '/api/v1/admin/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentStage: 'QUALIFICATION',
        reason: 'Demo qualification round via E2E test',
      }),
      jar: btcJar,
    });
    const createRoundText = await assertStatus(createRoundRes, [200, 201], 'POST /api/v1/admin/rounds');
    const createRoundJson = JSON.parse(createRoundText) as { data?: { id: string } };
    roundId = createRoundJson.data?.id ?? '';
    expect(roundId, 'Round ID must be returned on creation').toBeTruthy();

    // Open round with fresh ruleSetId
    const openRoundRes = await apiRequest(baseUrl, `/api/v1/admin/rounds/${roundId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ruleSetId,
        reason: 'Opening round submissions via E2E test',
      }),
      jar: btcJar,
    });
    await assertStatus(openRoundRes, 200, `POST /api/v1/admin/rounds/${roundId}/open`);

    // 3. Confirm round status is SUBMISSION_OPEN
    const checkRes = await apiRequest(baseUrl, `/api/v1/admin/rounds?tournamentStage=QUALIFICATION`, {
      jar: btcJar,
    });
    const checkText = await assertStatus(checkRes, 200, 'Verify round SUBMISSION_OPEN');
    const checkJson = JSON.parse(checkText) as {
      data?: { items?: Array<{ id: string; status: string; ruleSetId?: string }> };
    };
    const targetRound = checkJson.data?.items?.find((r) => r.id === roundId);
    expect(targetRound, `Round ${roundId} must exist`).toBeTruthy();
    expect(targetRound?.status, `Round ${roundId} status must be SUBMISSION_OPEN`).toBe('SUBMISSION_OPEN');
    expect(targetRound?.ruleSetId, `Round ${roundId} must bind to rule set ${ruleSetId}`).toBe(ruleSetId);

    // Assertion (a): anonymous public maps endpoint returns current round map, and download equals definition
    const publicMapsRes = await apiRequest(baseUrl, '/api/v1/public/rounds/current/maps');
    const publicMapsText = await assertStatus(publicMapsRes, 200, 'GET /api/v1/public/rounds/current/maps');
    const publicMapsJson = JSON.parse(publicMapsText) as {
      round?: { name: string; status: string };
      maps?: Array<{ mapId: string; checksum: string; definition: Record<string, unknown> }>;
    };
    expect(publicMapsJson.maps?.length, 'Public maps must contain at least one map').toBeGreaterThanOrEqual(1);
    const pubMap = publicMapsJson.maps![0]!;
    expect(pubMap.mapId).toBe(mapId);
    expect(pubMap.checksum).toBe(mapChecksum);

    const downloadRes = await apiRequest(
      baseUrl,
      `/api/v1/public/maps/${encodeURIComponent(pubMap.mapId)}?checksum=${encodeURIComponent(pubMap.checksum)}`,
    );
    const downloadText = await assertStatus(downloadRes, 200, `Download map ${pubMap.mapId}`);
    const downloadJson = JSON.parse(downloadText);
    expect(downloadJson).toEqual(pubMap.definition);
  });

  // ---------------------------------------------------------------------------
  // Step D: Team Bot Uploads and Preflight to ACTIVE
  // ---------------------------------------------------------------------------
  it.skipIf(!hasFixtures)(
    'd. two teams upload distinct OCI bot archives; coordinator preflight promotes them to ACTIVE',
    async () => {
      // --- Team 01: Reservation + Upload ---
      const t1ReserveRes = await apiRequest(baseUrl, '/api/v1/submission-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveSha256: fixture01Sha256 }),
        jar: team01Jar,
      });
      const t1ReserveText = await assertStatus(t1ReserveRes, [200, 201], 'Team 01 reservation');
      const t1ReserveJson = JSON.parse(t1ReserveText) as { data?: { id: string } };
      const t1ReservationId = t1ReserveJson.data?.id;
      expect(t1ReservationId, 'Team 01 reservation ID must be present').toBeTruthy();

      const t1UploadRes = await apiRequest(baseUrl, '/api/v1/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-reservation-id': t1ReservationId!,
        },
        body: fixture01Buffer,
        jar: team01Jar,
      });
      const t1UploadText = await assertStatus(t1UploadRes, [200, 201], 'Team 01 bot upload');
      const t1UploadJson = JSON.parse(t1UploadText) as {
        data?: { id: string; status: string; archiveSha256: string };
      };
      submission01Id = t1UploadJson.data?.id ?? '';
      expect(submission01Id, 'Team 01 submission ID must be present').toBeTruthy();
      expect(t1UploadJson.data?.archiveSha256, 'Team 01 upload SHA-256 must match fixture digest').toBe(fixture01Sha256);

      // --- Team 02: Reservation + Upload ---
      const t2ReserveRes = await apiRequest(baseUrl, '/api/v1/submission-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveSha256: fixture02Sha256 }),
        jar: team02Jar,
      });
      const t2ReserveText = await assertStatus(t2ReserveRes, [200, 201], 'Team 02 reservation');
      const t2ReserveJson = JSON.parse(t2ReserveText) as { data?: { id: string } };
      const t2ReservationId = t2ReserveJson.data?.id;
      expect(t2ReservationId, 'Team 02 reservation ID must be present').toBeTruthy();

      const t2UploadRes = await apiRequest(baseUrl, '/api/v1/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-reservation-id': t2ReservationId!,
        },
        body: fixture02Buffer,
        jar: team02Jar,
      });
      const t2UploadText = await assertStatus(t2UploadRes, [200, 201], 'Team 02 bot upload');
      const t2UploadJson = JSON.parse(t2UploadText) as {
        data?: { id: string; status: string; archiveSha256: string };
      };
      submission02Id = t2UploadJson.data?.id ?? '';
      expect(submission02Id, 'Team 02 submission ID must be present').toBeTruthy();
      expect(t2UploadJson.data?.archiveSha256, 'Team 02 upload SHA-256 must match fixture digest').toBe(fixture02Sha256);

      // Exercise same-bytes case: Team 02 can independently reserve fixture 01 bytes without colliding with Team 01
      const sameBytesReserveRes = await apiRequest(baseUrl, '/api/v1/submission-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveSha256: fixture01Sha256 }),
        jar: team02Jar,
      });
      await assertStatus(sameBytesReserveRes, [200, 201], 'Team 02 same-bytes reservation');

      // Poll until coordinator preflight loop promotes both submissions to ACTIVE (timeout ≤ 120s).
      //
      // Submission status enum reference:
      // - SQL Enum: src/platform/api/migrations/0001_initial.sql:3
      //   CREATE TYPE submission_status AS ENUM ('UPLOADED', 'INSPECTING', 'INVALID', 'PREFLIGHT', 'VALID', 'ACTIVE', 'SUPERSEDED', 'REVOKED');
      // - TS Enum: src/platform/web/src/features/submissions/api.ts:1 (SubmissionStatusCode)
      //
      // Note: GET /api/v1/submissions (src/platform/api/src/modules/submissions/routes.ts:127-135)
      // returns only { id, status, archiveSha256, createdAt, preflightPosition } and does not
      // expose an error or failure code. Therefore, assertions report submission ID and status.
      //
      // Stop early if either submission enters a terminal non-ACTIVE status (INVALID, SUPERSEDED, REVOKED).
      const deadline = Date.now() + 120_000;

      while (Date.now() < deadline && (!t1Active || !t2Active)) {
        if (!t1Active) {
          const sub1Res = await apiRequest(baseUrl, '/api/v1/submissions', { jar: team01Jar });
          if (sub1Res.status === 200) {
            const sub1Json = (await sub1Res.json()) as {
              data?: Array<{ id: string; status: string }>;
            };
            const target = sub1Json.data?.find((s) => s.id === submission01Id);
            if (target) {
              submission01Status = target.status;
              if (target.status === 'ACTIVE') {
                t1Active = true;
              } else if (target.status !== 'PREFLIGHT') {
                // Terminal non-ACTIVE status encountered: abort poll loop immediately
                break;
              }
            }
          }
        }

        if (!t2Active) {
          const sub2Res = await apiRequest(baseUrl, '/api/v1/submissions', { jar: team02Jar });
          if (sub2Res.status === 200) {
            const sub2Json = (await sub2Res.json()) as {
              data?: Array<{ id: string; status: string }>;
            };
            const target = sub2Json.data?.find((s) => s.id === submission02Id);
            if (target) {
              submission02Status = target.status;
              if (target.status === 'ACTIVE') {
                t2Active = true;
              } else if (target.status !== 'PREFLIGHT') {
                // Terminal non-ACTIVE status encountered: abort poll loop immediately
                break;
              }
            }
          }
        }

        if (!t1Active || !t2Active) {
          if (
            (submission01Status && submission01Status !== 'PREFLIGHT' && submission01Status !== 'ACTIVE') ||
            (submission02Status && submission02Status !== 'PREFLIGHT' && submission02Status !== 'ACTIVE')
          ) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // Assert status with explicit message naming the submission ID and observed terminal status
      expect(
        submission01Status,
        `team01 submission ${submission01Id} status must be ACTIVE (observed: ${submission01Status || 'NONE'})`,
      ).toBe('ACTIVE');
      expect(
        submission02Status,
        `team02 submission ${submission02Id} status must be ACTIVE (observed: ${submission02Status || 'NONE'})`,
      ).toBe('ACTIVE');
      expect(
        t1Active,
        `team01 submission ${submission01Id} must reach ACTIVE within timeout (last status: ${submission01Status})`,
      ).toBe(true);
      expect(
        t2Active,
        `team02 submission ${submission02Id} must reach ACTIVE within timeout (last status: ${submission02Status})`,
      ).toBe(true);

      // AC-22: BTC queries flagged submissions endpoint; demo fixtures are distinct so total must be 0
      const flaggedRes = await apiRequest(baseUrl, '/api/v1/admin/submissions/flagged', { jar: btcJar });
      const flaggedText = await assertStatus(flaggedRes, 200, 'BTC queries flagged submissions');
      const flaggedJson = JSON.parse(flaggedText) as { data?: unknown[]; total?: number };
      expect(flaggedJson.total, 'Demo fixtures should produce zero duplicate flags').toBe(0);
      expect(flaggedJson.data, 'Flagged submissions list should be empty').toEqual([]);

      // Assertion (b): team runs a self-play test run on default map and polls until terminal status (<= 120s)
      const policyRes = await apiRequest(baseUrl, '/api/v1/test-run-policy', { jar: team01Jar });
      const policyText = await assertStatus(policyRes, 200, 'GET /api/v1/test-run-policy');
      const policyJson = JSON.parse(policyText) as {
        data?: {
          maps?: Array<{ mapId: string; checksum: string }>;
          opponents?: {
            ownSubmissionAllowed: boolean;
            referenceBots?: Array<{ id: string; displayName: string }>;
          };
        };
      };
      expect(policyJson.data?.opponents?.ownSubmissionAllowed, 'ownSubmissionAllowed must be true for test run').toBe(true);
      const testMap = policyJson.data?.maps?.[0];
      expect(testMap, 'Test run policy must provide maps').toBeTruthy();

      const createTestRunRes = await apiRequest(baseUrl, '/api/v1/test-runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-self-play-${Date.now()}`,
        },
        body: JSON.stringify({
          submissionId: submission01Id,
          opponentType: 'OWN_SUBMISSION',
          opponentSubmissionId: submission01Id,
          mapId: testMap!.mapId,
          mapChecksum: testMap!.checksum,
        }),
        jar: team01Jar,
      });
      const createTestRunText = await assertStatus(createTestRunRes, [200, 201], 'POST /api/v1/test-runs (self-play)');
      const createTestRunJson = JSON.parse(createTestRunText) as { data?: { id: string; status: string } };
      const testRunId = createTestRunJson.data?.id;
      expect(testRunId, 'Test run ID must be returned').toBeTruthy();

      const testRunDeadline = Date.now() + 120_000;
      let finalTestRunStatus = createTestRunJson.data?.status ?? 'QUEUED';
      while (Date.now() < testRunDeadline) {
        if (finalTestRunStatus === 'COMPLETED' || finalTestRunStatus === 'FAILED' || finalTestRunStatus === 'CANCELLED') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const pollRes = await apiRequest(baseUrl, `/api/v1/test-runs/${testRunId}`, { jar: team01Jar });
        if (pollRes.status === 200) {
          const pollJson = (await pollRes.json()) as { data?: { status: string } };
          finalTestRunStatus = pollJson.data?.status ?? finalTestRunStatus;
        }
      }
      const selfRunRes = await apiRequest(baseUrl, `/api/v1/test-runs/${testRunId}`, { jar: team01Jar });
      const selfRunText = await assertStatus(selfRunRes, 200, 'GET /api/v1/test-runs/:id (self-play)');
      const selfRunJson = JSON.parse(selfRunText) as {
        data?: {
          status: string;
          result?: { reason?: string; winnerSide?: string; turnCount?: number };
          failureReason?: string | null;
        };
      };
      finalTestRunStatus = selfRunJson.data?.status ?? finalTestRunStatus;
      const selfFailure = selfRunJson.data?.failureReason ?? 'none';
      expect(['COMPLETED', 'FAILED'], `Test run ${testRunId} must reach terminal status (status: ${finalTestRunStatus}, failureReason: ${selfFailure})`).toContain(finalTestRunStatus);
      expect(finalTestRunStatus, `Test run ${testRunId} must complete successfully without forfeit or schema violation (status: ${finalTestRunStatus}, failureReason: ${selfFailure})`).toBe('COMPLETED');
      expect(selfRunJson.data?.result?.reason, `Self-play match result reason must not be FORFEIT (failureReason: ${selfFailure})`).not.toBe('FORFEIT');
      expect(selfRunJson.data?.failureReason, `Self-play test run must not fail: ${selfFailure}`).toBeFalsy();

      const selfReplayRes = await apiRequest(baseUrl, `/api/v1/test-runs/${testRunId}/replay`, { jar: team01Jar });
      const selfReplayText = await assertStatus(selfReplayRes, 200, 'GET /api/v1/test-runs/:id/replay (self-play)');
      const selfReplay = JSON.parse(selfReplayText) as {
        entries?: Array<{
          input?: { kind?: string; side?: string; reason?: string; fault?: string };
          events?: Array<{ type?: string }>;
        }>;
        faults?: {
          X?: { recoverableTotal?: number; lastErrorCode?: string | null };
          O?: { recoverableTotal?: number; lastErrorCode?: string | null };
        };
        result?: { reason?: string };
      };
      const selfEntries = selfReplay.entries ?? [];
      const selfSkipViolations = selfEntries.filter(
        (e) => e.input?.kind === 'skip' && e.input?.reason === 'SCHEMA_VIOLATION',
      );
      expect(selfSkipViolations, 'Self-play replay must not contain SCHEMA_VIOLATION skip entries').toHaveLength(0);

      const selfForfeitEntries = selfEntries.filter(
        (e) => e.input?.kind === 'forfeit' || e.input?.fault === 'SCHEMA_VIOLATION',
      );
      expect(selfForfeitEntries, 'Self-play replay must not contain forfeit or SCHEMA_VIOLATION entries').toHaveLength(0);

      expect(selfReplay.faults?.X, 'Self-play replay must expose faults.X').toBeDefined();
      expect(selfReplay.faults?.O, 'Self-play replay must expose faults.O').toBeDefined();
      expect(selfReplay.faults?.X?.recoverableTotal, 'Self-play side X recoverable faults must be 0').toBe(0);
      expect(selfReplay.faults?.O?.recoverableTotal, 'Self-play side O recoverable faults must be 0').toBe(0);
      expect(selfReplay.faults?.X?.lastErrorCode, 'Self-play side X lastErrorCode must not be SCHEMA_VIOLATION').not.toBe('SCHEMA_VIOLATION');
      expect(selfReplay.faults?.O?.lastErrorCode, 'Self-play side O lastErrorCode must not be SCHEMA_VIOLATION').not.toBe('SCHEMA_VIOLATION');

      const selfApplyEntries = selfEntries.filter((e) => e.input?.kind === 'apply');
      expect(selfApplyEntries.length, 'Self-play replay must contain at least 3 non-skip moves').toBeGreaterThanOrEqual(3);
      expect(selfReplay.result?.reason, 'Self-play replay result reason must not be FORFEIT').not.toBe('FORFEIT');

      // Assertion (c): gateway serves downloadable demo bot with pinned checksum
      const downloadRes = await fetch(`${baseUrl}/downloads/ott-demo-bot-go-v1.oci.tar`);
      expect(downloadRes.status, 'GET /downloads/ott-demo-bot-go-v1.oci.tar must return 200').toBe(200);
      const downloadBuf = Buffer.from(await downloadRes.arrayBuffer());
      expect(downloadBuf.byteLength, 'Demo bot archive must match expected size').toBe(829440);
      const downloadSha256 = crypto.createHash('sha256').update(downloadBuf).digest('hex');
      expect(downloadSha256, 'Downloaded demo bot must match pinned SHA-256').toBe(
        '80d1dd7d9fb46f3c2a4779f0a62cc7ee0d6a3ce4b741df026adbb7bf6109b4e6',
      );

      // Assertion (d): test run against BTC_REFERENCE (btc-baseline)
      const refBots = policyJson.data?.opponents?.referenceBots ?? [];
      expect(
        refBots.some((b: { id: string }) => b.id === 'btc-baseline'),
        'referenceBots must list btc-baseline',
      ).toBe(true);

      const btcTestRunRes = await apiRequest(baseUrl, '/api/v1/test-runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `e2e-btc-ref-${Date.now()}`,
        },
        body: JSON.stringify({
          submissionId: submission01Id,
          opponentType: 'BTC_REFERENCE',
          opponentReferenceBot: 'btc-baseline',
          mapId: testMap!.mapId,
          mapChecksum: testMap!.checksum,
        }),
        jar: team01Jar,
      });
      const btcTestRunText = await assertStatus(btcTestRunRes, [200, 201], 'POST /api/v1/test-runs (BTC_REFERENCE)');
      const btcTestRunJson = JSON.parse(btcTestRunText) as { data?: { id: string; status: string } };
      const btcTestRunId = btcTestRunJson.data?.id;
      expect(btcTestRunId, 'BTC test run ID must be returned').toBeTruthy();

      const btcDeadline = Date.now() + 120_000;
      let finalBtcStatus = btcTestRunJson.data?.status ?? 'QUEUED';
      while (Date.now() < btcDeadline) {
        if (finalBtcStatus === 'COMPLETED' || finalBtcStatus === 'FAILED' || finalBtcStatus === 'CANCELLED') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const pollRes = await apiRequest(baseUrl, `/api/v1/test-runs/${btcTestRunId}`, { jar: team01Jar });
        if (pollRes.status === 200) {
          const pollJson = (await pollRes.json()) as { data?: { status: string } };
          finalBtcStatus = pollJson.data?.status ?? finalBtcStatus;
        }
      }
      const btcRunRes = await apiRequest(baseUrl, `/api/v1/test-runs/${btcTestRunId}`, { jar: team01Jar });
      const btcRunText = await assertStatus(btcRunRes, 200, 'GET /api/v1/test-runs/:id (BTC_REFERENCE)');
      const btcRunJson = JSON.parse(btcRunText) as {
        data?: {
          status: string;
          result?: { reason?: string; winnerSide?: string; turnCount?: number };
          failureReason?: string | null;
        };
      };
      finalBtcStatus = btcRunJson.data?.status ?? finalBtcStatus;
      const btcFailure = btcRunJson.data?.failureReason ?? 'none';
      expect(['COMPLETED', 'FAILED'], `BTC test run ${btcTestRunId} must reach terminal status (status: ${finalBtcStatus}, failureReason: ${btcFailure})`).toContain(finalBtcStatus);
      expect(finalBtcStatus, `BTC test run ${btcTestRunId} must complete successfully without forfeit or schema violation (status: ${finalBtcStatus}, failureReason: ${btcFailure})`).toBe('COMPLETED');
      expect(btcRunJson.data?.result?.reason, `BTC test run match result reason must not be FORFEIT (failureReason: ${btcFailure})`).not.toBe('FORFEIT');
      expect(btcRunJson.data?.failureReason, `BTC test run must not fail: ${btcFailure}`).toBeFalsy();

      const btcReplayRes = await apiRequest(baseUrl, `/api/v1/test-runs/${btcTestRunId}/replay`, { jar: team01Jar });
      const btcReplayText = await assertStatus(btcReplayRes, 200, 'GET /api/v1/test-runs/:id/replay (BTC_REFERENCE)');
      const btcReplay = JSON.parse(btcReplayText) as {
        entries?: Array<{
          input?: { kind?: string; side?: string; reason?: string; fault?: string };
          events?: Array<{ type?: string }>;
        }>;
        faults?: {
          X?: { recoverableTotal?: number; lastErrorCode?: string | null };
          O?: { recoverableTotal?: number; lastErrorCode?: string | null };
        };
        result?: { reason?: string };
      };
      const btcEntries = btcReplay.entries ?? [];
      const btcSkipViolations = btcEntries.filter(
        (e) => e.input?.kind === 'skip' && e.input?.reason === 'SCHEMA_VIOLATION',
      );
      expect(btcSkipViolations, 'BTC test run replay must not contain SCHEMA_VIOLATION skip entries').toHaveLength(0);

      const btcForfeitEntries = btcEntries.filter(
        (e) => e.input?.kind === 'forfeit' || e.input?.fault === 'SCHEMA_VIOLATION',
      );
      expect(btcForfeitEntries, 'BTC test run replay must not contain forfeit or SCHEMA_VIOLATION entries').toHaveLength(0);

      expect(btcReplay.faults?.X, 'BTC test run replay must expose faults.X').toBeDefined();
      expect(btcReplay.faults?.O, 'BTC test run replay must expose faults.O').toBeDefined();
      expect(btcReplay.faults?.X?.recoverableTotal, 'BTC test run side X recoverable faults must be 0').toBe(0);
      expect(btcReplay.faults?.O?.recoverableTotal, 'BTC test run side O recoverable faults must be 0').toBe(0);
      expect(btcReplay.faults?.X?.lastErrorCode, 'BTC test run side X lastErrorCode must not be SCHEMA_VIOLATION').not.toBe('SCHEMA_VIOLATION');
      expect(btcReplay.faults?.O?.lastErrorCode, 'BTC test run side O lastErrorCode must not be SCHEMA_VIOLATION').not.toBe('SCHEMA_VIOLATION');

      const btcApplyEntries = btcEntries.filter((e) => e.input?.kind === 'apply');
      expect(btcApplyEntries.length, 'BTC test run replay must contain at least 3 non-skip moves').toBeGreaterThanOrEqual(3);
      expect(btcReplay.result?.reason, 'BTC replay result reason must not be FORFEIT').not.toBe('FORFEIT');

      // Assertion (e): upload downloaded demo bot as team01 submission and verify preflight promotes to ACTIVE
      const demoBotReserveRes = await apiRequest(baseUrl, '/api/v1/submission-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveSha256: `sha256:${downloadSha256}` }),
        jar: team01Jar,
      });
      const demoBotReserveText = await assertStatus(demoBotReserveRes, [200, 201], 'Reserve downloaded demo bot submission');
      const demoBotReserveJson = JSON.parse(demoBotReserveText) as { data?: { id: string } };
      const demoReservationId = demoBotReserveJson.data?.id;
      expect(demoReservationId, 'Downloaded bot reservation ID must be present').toBeTruthy();

      const demoUploadRes = await apiRequest(baseUrl, '/api/v1/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-reservation-id': demoReservationId!,
        },
        body: downloadBuf,
        jar: team01Jar,
      });
      const demoUploadText = await assertStatus(demoUploadRes, [200, 201], 'Upload downloaded demo bot archive');
      const demoUploadJson = JSON.parse(demoUploadText) as {
        data?: { id: string; status: string; archiveSha256: string };
      };
      const demoSubId = demoUploadJson.data?.id;
      expect(demoSubId, 'Downloaded bot submission ID must be present').toBeTruthy();
      expect(demoUploadJson.data?.archiveSha256, 'Downloaded bot SHA-256 must match digest').toBe(`sha256:${downloadSha256}`);

      // Poll until the newly uploaded demo bot reaches ACTIVE
      const demoPollDeadline = Date.now() + 120_000;
      let demoSubStatus = 'PREFLIGHT';
      while (Date.now() < demoPollDeadline) {
        const subListRes = await apiRequest(baseUrl, '/api/v1/submissions', { jar: team01Jar });
        if (subListRes.status === 200) {
          const subListJson = (await subListRes.json()) as {
            data?: Array<{ id: string; status: string }>;
          };
          const target = subListJson.data?.find((s) => s.id === demoSubId);
          if (target) {
            demoSubStatus = target.status;
            if (target.status === 'ACTIVE') break;
            if (target.status !== 'PREFLIGHT') break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      expect(demoSubStatus, `Downloaded demo bot submission ${demoSubId} must reach ACTIVE`).toBe('ACTIVE');
      submission01Id = demoSubId!;
      submission01Status = demoSubStatus;
    },
  );

  // ---------------------------------------------------------------------------
  // Step E: BTC Closes Submissions, Starts Round, Matches Finalize, Ratings Apply
  // ---------------------------------------------------------------------------
  it.skipIf(!hasFixtures)(
    'e. BTC closes submissions and starts round; series/matches finalize; leaderboard updates',
    async () => {
      expect(
        t1Active && t2Active,
        `Prerequisite step d did not complete: both submissions must be ACTIVE before round close/start (team01: ${submission01Status || 'unknown'}, team02: ${submission02Status || 'unknown'})`,
      ).toBe(true);

      expect(demoSchedule, 'demoSchedule must be initialized by step c').toBeTruthy();
      const graceEndsAtMs = demoSchedule!.timestamps.graceMs;

      // Close requires now >= graceEndsAt (src/platform/api/src/modules/rounds/service.ts:526).
      // Sleep the remaining time until grace period has elapsed.
      const nowBeforeClose = Date.now();
      if (nowBeforeClose <= graceEndsAtMs) {
        const waitMs = graceEndsAtMs - nowBeforeClose + 200; // 200ms safety buffer
        if (waitMs > DEMO_E2E_MAX_WAIT_TO_CLOSE_MS + 30_000) {
          throw new Error(
            `Wait time to round close (${waitMs}ms) exceeds maximum allowed budget (${DEMO_E2E_MAX_WAIT_TO_CLOSE_MS + 30_000}ms)`,
          );
        }
        console.log(`[step e] Waiting ${waitMs}ms until grace period ends at ${demoSchedule!.schedule.graceEndsAt}...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      // Close submissions
      const closeRes = await apiRequest(baseUrl, `/api/v1/admin/rounds/${roundId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Closing submissions via E2E test' }),
        jar: btcJar,
      });
      await assertStatus(closeRes, 200, `POST /api/v1/admin/rounds/${roundId}/close`);

      // Start round
      const startKey = `demo-e2e-start-${roundId}-${Date.now()}`;
      const startRes = await apiRequest(baseUrl, `/api/v1/admin/rounds/${roundId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': startKey,
        },
        body: JSON.stringify({
          ruleSetId,
          reason: 'Starting qualification matches via E2E test',
        }),
        jar: btcJar,
      });
      const startText = await assertStatus(startRes, [200, 201], `POST /api/v1/admin/rounds/${roundId}/start`);
      const startJson = JSON.parse(startText) as { data?: { status: string } };
      expect(
        ['RUNNING', 'SETTLING', 'FINALIZED'].includes(startJson.data?.status ?? ''),
        `Round start status must be active (got ${startJson.data?.status})`,
      ).toBe(true);

      // Poll until series/matches are FINALIZED and leaderboard contains 2 teams (timeout ≤ 300s)
      const deadline = Date.now() + 300_000;
      let finalized = false;
      let leaderboardTeamsCount = 0;

      while (Date.now() < deadline && (!finalized || leaderboardTeamsCount < 2)) {
        const seriesRes = await apiRequest(baseUrl, '/api/v1/results/series?stage=QUALIFICATION', {
          jar: btcJar,
        });
        if (seriesRes.status === 200) {
          const seriesJson = (await seriesRes.json()) as {
            data?: { items?: Array<{ status: string }> };
          };
          const items = seriesJson.data?.items ?? [];
          if (items.length > 0 && items.every((s) => s.status === 'FINALIZED')) {
            finalized = true;
          }
        }

        const lbRes = await apiRequest(baseUrl, '/api/v1/leaderboard?stage=QUALIFICATION');
        if (lbRes.status === 200) {
          const lbJson = (await lbRes.json()) as {
            data?: { items?: Array<{ teamId: string; rank: string; rating: number }> };
          };
          leaderboardTeamsCount = lbJson.data?.items?.length ?? 0;
        }

        if (!finalized || leaderboardTeamsCount < 2) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      expect(finalized, 'All scheduled round series must reach FINALIZED status').toBe(true);
      expect(leaderboardTeamsCount, 'Leaderboard must contain exactly 2 participating teams').toBe(2);

      // Assert rating ledger effect via public leaderboard
      const publicLbRes = await apiRequest(baseUrl, '/api/v1/leaderboard?stage=QUALIFICATION');
      const publicLbText = await assertStatus(publicLbRes, 200, 'GET /api/v1/leaderboard?stage=QUALIFICATION');
      const publicLbJson = JSON.parse(publicLbText) as {
        data?: {
          items?: Array<{
            rank: string | number;
            team?: { id: string; name: string };
            teamId?: string;
            teamName?: string;
            rating: number;
            seriesWins?: number;
            seriesLosses?: number;
          }>;
        };
      };
      const items = publicLbJson.data?.items ?? [];
      expect(items, 'Leaderboard items count must be 2').toHaveLength(2);
      expect(items.map((i) => i.team?.name ?? i.teamName).sort(), 'Leaderboard teams must match demo teams').toEqual(['Team 01', 'Team 02']);
      expect(Number(items[0]!.rank), 'Top team rank must be 1').toBe(1);
    },
  );

  // ---------------------------------------------------------------------------
  // Step F: Results Visible via Gateway
  // ---------------------------------------------------------------------------
  it.skipIf(!hasFixtures)(
    'f. verifies series results, matches, and leaderboard visibility across roles',
    async () => {
      expect(
        t1Active && t2Active,
        'Prerequisite step d did not complete: both submissions must be ACTIVE before querying match/series results',
      ).toBe(true);

      // 1. BTC sees all series results
      const seriesRes = await apiRequest(baseUrl, '/api/v1/results/series?stage=QUALIFICATION', {
        jar: btcJar,
      });
      const seriesText = await assertStatus(seriesRes, 200, 'BTC series results query');
      const seriesJson = JSON.parse(seriesText) as {
        data?: { items?: Array<{ seriesId: string; status: string }> };
      };
      expect(seriesJson.data?.items?.length, 'Series count must be > 0').toBeGreaterThan(0);
      expect(seriesJson.data?.items?.[0]?.status, 'First series must be FINALIZED').toBe('FINALIZED');

      // 2. Team 01 sees its own matches
      const t1MatchesRes = await apiRequest(baseUrl, '/api/v1/results/matches?stage=QUALIFICATION', {
        jar: team01Jar,
      });
      const t1MatchesText = await assertStatus(t1MatchesRes, 200, 'Team 01 matches query');
      const t1MatchesJson = JSON.parse(t1MatchesText) as {
        data?: {
          items?: Array<{
            matchId: string;
            status: string;
            teams: { x: { name: string }; o: { name: string } };
          }>;
        };
      };
      const t1Items = t1MatchesJson.data?.items ?? [];
      expect(t1Items.length, 'Team 01 matches count must be > 0').toBeGreaterThan(0);
      firstMatchId = t1Items[0]!.matchId;
      firstMatchTeamNames = { x: t1Items[0]!.teams.x.name, o: t1Items[0]!.teams.o.name };
      expect(firstMatchId, 'First match ID must be present').toBeTruthy();

      // 3. Team 02 sees its own matches
      const t2MatchesRes = await apiRequest(baseUrl, '/api/v1/results/matches?stage=QUALIFICATION', {
        jar: team02Jar,
      });
      const t2MatchesText = await assertStatus(t2MatchesRes, 200, 'Team 02 matches query');
      const t2MatchesJson = JSON.parse(t2MatchesText) as {
        data?: { items?: Array<{ matchId: string }> };
      };
      expect(t2MatchesJson.data?.items?.length, 'Team 02 matches count must be > 0').toBeGreaterThan(0);

      // 4. Anonymous client accesses public leaderboard without authentication
      const publicLb = await apiRequest(baseUrl, '/api/v1/leaderboard?stage=QUALIFICATION');
      await assertStatus(publicLb, 200, 'Anonymous public leaderboard access');

      // 5. Anonymous client fetches /snapshots/latest.json through gateway
      // Coordinator snapshot loop publishes periodically (≤ 30s interval); poll ≤ 90s until snapshot lists finished round
      const snapshotDeadline = Date.now() + 90_000;
      let snapshotFound = false;
      let latestJson: { schemaVersion?: number; file?: string } = {};
      let snapshotData: { stage?: string; round?: { name?: string }; results?: unknown[]; leaderboard?: unknown[] } = {};

      while (Date.now() < snapshotDeadline && !snapshotFound) {
        try {
          const latestRes = await apiRequest(baseUrl, '/snapshots/latest.json');
          if (latestRes.status === 200) {
            latestJson = (await latestRes.json()) as { schemaVersion?: number; file?: string };
            if (latestJson.file) {
              const fileRes = await apiRequest(baseUrl, `/snapshots/${latestJson.file}`);
              if (fileRes.status === 200) {
                snapshotData = (await fileRes.json()) as typeof snapshotData;
                if ((snapshotData.results?.length ?? 0) > 0 && (snapshotData.leaderboard?.length ?? 0) === 2) {
                  snapshotFound = true;
                  break;
                }
              }
            }
          }
        } catch {
          // Retry until coordinator finishes publishing snapshot
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      expect(snapshotFound, 'Gateway must serve /snapshots/latest.json listing the finished qualification round within 90s').toBe(true);
      expect(snapshotData.stage, 'Snapshot stage must be QUALIFICATION').toBe('QUALIFICATION');
      expect(snapshotData.results?.length, 'Snapshot results count must be > 0').toBeGreaterThan(0);
      expect(snapshotData.leaderboard?.length, 'Snapshot leaderboard must contain 2 teams').toBe(2);
    },
  );

  // ---------------------------------------------------------------------------
  // Step G: Replay Access & Privacy Contract (ADR-0005)
  // ---------------------------------------------------------------------------
  it.skipIf(!hasFixtures)(
    'g. verifies private replay access for teams/BTC (KNOWN GAP: qualification replays are v2), public stage isolation, and anonymous access rejection',
    async () => {
      expect(
        t1Active && t2Active,
        'Prerequisite step d did not complete: both submissions must be ACTIVE before verifying replays',
      ).toBe(true);
      expect(firstMatchId, 'Prerequisite: match ID from step f must exist before verifying replays').toBeTruthy();

      // 1. Anonymous client calling private replay endpoint returns 401 UNAUTHENTICATED
      // (src/platform/api/src/modules/replays/routes.ts:126 via requireAuthenticated in src/platform/api/src/modules/auth/authorize.ts:20)
      const anonPrivateRes = await apiRequest(baseUrl, `/api/v1/replays/${firstMatchId}`);
      const anonPrivateText = await assertStatus(anonPrivateRes, 401, 'Anonymous private replay rejection');
      const anonPrivateJson = JSON.parse(anonPrivateText) as { error?: { code: string } };
      expect(anonPrivateJson.error?.code, 'Anonymous private replay error code must be UNAUTHENTICATED').toBe('UNAUTHENTICATED');

      // 2. Anonymous client cannot fetch qualification replay through public endpoint -> 404 REPLAY_NOT_FOUND
      // (src/platform/api/src/modules/replays/routes.ts:109 via getPublicReplay in src/platform/api/src/modules/replays/service.ts:121)
      const anonPublicRes = await apiRequest(baseUrl, `/api/v1/public/replays/${firstMatchId}`);
      const anonPublicText = await assertStatus(anonPublicRes, 404, 'Anonymous qualification public replay rejection');
      const anonPublicJson = JSON.parse(anonPublicText) as { error?: { code: string } };
      expect(anonPublicJson.error?.code, 'Error code must be REPLAY_NOT_FOUND').toBe('REPLAY_NOT_FOUND');

      // 3. Non-existent/tampered match ID returns 404
      const tamperedIdRes = await apiRequest(
        baseUrl,
        '/api/v1/public/replays/00000000-0000-4000-8000-000000000000',
      );
      await assertStatus(tamperedIdRes, 404, 'Tampered match ID public replay rejection');

      // 4. BTC staging attempt on qualification match returns 409 REPLAY_NOT_PUBLIC_STAGE
      // (Qualification replays are private to participating teams & BTC; public publication requires FINALS stage per ADR-0005)
      // (src/platform/api/src/modules/replays/service.ts:168 assertFinalsStage)
      const stageKey = `stage-attempt-${firstMatchId}`;
      const stageAttemptRes = await apiRequest(baseUrl, `/api/v1/admin/replays/${firstMatchId}/stage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': stageKey,
        },
        body: JSON.stringify({ reason: 'E2E qualification replay stage attempt' }),
        jar: btcJar,
      });
      const stageErrText = await assertStatus(stageAttemptRes, 409, 'BTC qualification replay staging rejection');
      const stageErrJson = JSON.parse(stageErrText) as { error?: { code: string } };
      expect(stageErrJson.error?.code, 'Error code must be REPLAY_NOT_PUBLIC_STAGE').toBe('REPLAY_NOT_PUBLIC_STAGE');

      // 5. Team 01, Team 02, and BTC private replay access (v2 format for qualification matches).
      const verifyAuthorizedReplayAccess = async (jar: CookieJar, actor: string) => {
        const res = await apiRequest(baseUrl, `/api/v1/replays/${firstMatchId}`, { jar });
        expect(res.status, `${actor} private replay access: expected HTTP 200`).toBe(200);
        const rawBuffer = Buffer.from(await res.arrayBuffer());
        const expectedSha = `sha256:${crypto.createHash('sha256').update(rawBuffer).digest('hex')}`;
        expect(res.headers.get('x-replay-sha256'), `${actor} x-replay-sha256 header must match raw body sha256`).toBe(expectedSha);

        const contentType = res.headers.get('content-type') ?? '';
        expect(contentType, `${actor} Content-Type must be spectator-replay`).toContain('application/vnd.ott.spectator-replay+json');
        expect(contentType, `${actor} Content-Type must specify version 2`).toMatch(/version="?2"?/);
        expect(res.headers.get('cache-control'), `${actor} Cache-Control must be private, no-store`).toBe('private, no-store');

        const body = JSON.parse(rawBuffer.toString('utf8')) as {
          matchId?: string;
          schemaVersion?: number;
          header?: { formatVersion?: number; protocolVersion?: number; limits?: { timeControl?: unknown } };
          entries?: unknown[];
          timing?: unknown[];
          teams?: { X?: { name?: string }; O?: { name?: string } };
        };
        expect(body.matchId, `${actor} replay body match ID must match`).toBe(firstMatchId);
        expect(body.schemaVersion, `${actor} replay schemaVersion must be 2`).toBe(2);
        expect(body.header?.formatVersion, `${actor} header formatVersion must be 2`).toBe(2);
        expect(body.header?.protocolVersion, `${actor} header protocolVersion must be 2`).toBe(2);
        expect(body.header?.limits?.timeControl, `${actor} header limits timeControl must be defined`).toBeDefined();
        expect(Array.isArray(body.entries), `${actor} replay entries must be an array`).toBe(true);
        expect(body.entries?.length, `${actor} replay entries array must not be empty`).toBeGreaterThan(0);
        expect(Array.isArray(body.timing), `${actor} replay timing must be an array`).toBe(true);
        expect(body.timing?.length, `${actor} replay timing array must not be empty`).toBeGreaterThan(0);
        expect(firstMatchTeamNames, 'Team names of the match must be known from step f').not.toBeNull();
        expect(body.teams?.X?.name, `${actor} replay teams.X.name must equal the match X team name`).toBe(firstMatchTeamNames!.x);
        expect(body.teams?.O?.name, `${actor} replay teams.O.name must equal the match O team name`).toBe(firstMatchTeamNames!.o);
        expect([body.teams?.X?.name, body.teams?.O?.name].sort(), `${actor} replay teams must be the two demo teams`).toEqual(['Team 01', 'Team 02']);
        expect(Object.keys(body.teams?.X ?? {}), `${actor} replay teams.X must carry the name only`).toEqual(['name']);
      };

      await verifyAuthorizedReplayAccess(team01Jar, 'Team 01');
      await verifyAuthorizedReplayAccess(team02Jar, 'Team 02');
      await verifyAuthorizedReplayAccess(btcJar, 'BTC Admin');
    },
  );

  // ---------------------------------------------------------------------------
  // Step H: Stack Restart Resilience
  // ---------------------------------------------------------------------------
  it.skipIf(!hasFixtures)(
    'h. restarts api, worker, and coordinator containers; verifies state retention and no duplicated results',
    async () => {
      expect(
        t1Active && t2Active,
        'Prerequisite step d did not complete: both submissions must be ACTIVE before testing restart resilience',
      ).toBe(true);

      // Query state before restart
      const preLbRes = await apiRequest(baseUrl, '/api/v1/leaderboard?stage=QUALIFICATION');
      const preLbText = await assertStatus(preLbRes, 200, 'Pre-restart leaderboard query');
      const preLbJson = JSON.parse(preLbText) as {
        data?: { items?: Array<{ team?: { id: string; name: string }; teamId?: string; rank: string | number; rating: number }> };
      };

      const preMatchesRes = await apiRequest(baseUrl, '/api/v1/results/matches?stage=QUALIFICATION', {
        jar: btcJar,
      });
      const preMatchesText = await assertStatus(preMatchesRes, 200, 'Pre-restart matches query');
      const preMatchesJson = JSON.parse(preMatchesText) as {
        data?: { pagination?: { total?: number }; items?: unknown[] };
      };
      const preMatchTotal = preMatchesJson.data?.pagination?.total ?? preMatchesJson.data?.items?.length ?? 0;

      // Ensure non-vacuous assertion: at least 1 match and 2 teams must exist
      expect(preMatchTotal, 'Prerequisite: at least 1 match must exist before verifying restart resilience').toBeGreaterThan(0);
      expect(preLbJson.data?.items?.length, 'Prerequisite: 2-team leaderboard must exist before verifying restart resilience').toBe(2);

      // Shell to Docker compose with explicit compose file and env file
      const composeFile = path.resolve(process.cwd(), 'infra/local/compose.yaml');
      const envFile = process.env.OTT_DEMO_ENV_FILE ?? path.resolve(process.cwd(), '.local/demo-e2e/demo.env');
      const composeArgs = ['compose', '-p', projectName];
      if (fs.existsSync(composeFile)) {
        composeArgs.push('-f', composeFile);
      }
      if (fs.existsSync(envFile)) {
        composeArgs.push('--env-file', envFile);
      }

      await execFileAsync('docker', [
        ...composeArgs,
        'stop',
        'api',
        'worker',
        'coordinator',
      ]);

      await execFileAsync('docker', [
        ...composeArgs,
        'start',
        'api',
        'worker',
        'coordinator',
      ]);

      // Wait until gateway /api/v1/health/ready recovers (timeout ≤ 90s)
      const restartDeadline = Date.now() + 90_000;
      let readyAfterRestart = false;
      let lastReadyStatus = 0;
      let lastReadyBody = '';
      while (Date.now() < restartDeadline && !readyAfterRestart) {
        try {
          const res = await apiRequest(baseUrl, '/api/v1/health/ready');
          lastReadyStatus = res.status;
          if (res.status === 200) {
            readyAfterRestart = true;
          } else {
            lastReadyBody = await res.text().catch(() => '');
          }
        } catch (err) {
          lastReadyBody = err instanceof Error ? err.message : String(err);
        }
        if (!readyAfterRestart) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      expect(
        readyAfterRestart,
        `Gateway readiness probe must recover after container restart (last HTTP ${lastReadyStatus}: ${lastReadyBody})`,
      ).toBe(true);

      // Wait 2 x coordinator poll interval (~6s) to ensure coordinator cycles without duplicate scheduling
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Re-query state after restart
      const postLbRes = await apiRequest(baseUrl, '/api/v1/leaderboard?stage=QUALIFICATION');
      const postLbText = await assertStatus(postLbRes, 200, 'Post-restart leaderboard query');
      const postLbJson = JSON.parse(postLbText) as {
        data?: { items?: Array<{ team?: { id: string; name: string }; teamId?: string; rank: string | number; rating: number }> };
      };
      expect(postLbJson.data?.items, 'Leaderboard entries must be identical post-restart').toEqual(preLbJson.data?.items);

      // Re-authenticate BTC session if needed, then re-query matches count
      const postMatchesRes = await apiRequest(baseUrl, '/api/v1/results/matches?stage=QUALIFICATION', {
        jar: btcJar,
      });
      const postMatchesText = await assertStatus(postMatchesRes, 200, 'Post-restart matches query');
      const postMatchesJson = JSON.parse(postMatchesText) as {
        data?: { pagination?: { total?: number }; items?: unknown[] };
      };
      const postMatchTotal = postMatchesJson.data?.pagination?.total ?? postMatchesJson.data?.items?.length ?? 0;
      expect(postMatchTotal, 'Match count must remain identical post-restart (no duplicated match jobs)').toBe(preMatchTotal);
    },
  );
});
