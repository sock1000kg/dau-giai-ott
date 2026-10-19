import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBotStart = vi.fn();
const mockBotStop = vi.fn();
const mockBotRequestAction = vi.fn();
const mockBotConstructor = vi.fn();

vi.mock('../src/sandbox/oci-bot-port.ts', () => {
  return {
    SandboxOciBotPort: class MockSandboxOciBotPort {
      constructor(options: any) {
        mockBotConstructor(options);
      }
      start = mockBotStart;
      stop = mockBotStop;
      requestAction = mockBotRequestAction;
    },
  };
});

import { preflightSubmission } from '../src/preflight-submission.ts';

describe('preflightSubmission infra handling and fault classification', () => {
  const dummyArchive = new Uint8Array([1, 2, 3, 4]);
  const dummySha256 = `sha256:${createHash('sha256').update(dummyArchive).digest('hex')}`;

  const validSubmissionRow = {
    id: 'sub-test-123',
    team_id: 'team-1',
    tournament_stage: 'QUALIFICATION',
    status: 'PREFLIGHT',
    archive_sha256: dummySha256,
    oci_manifest_digest: 'sha256:manifest123',
    oci_config_digest: 'sha256:config123',
    entrypoint: ['/app/bot'],
    object_key: 'submissions/sub-test-123.tar',
    policy_version: 'P2_BASELINE_V1',
  };

  let mockDb: any;
  let mockStorage: any;
  let auditEvents: any[];
  let submissionUpdates: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    auditEvents = [];
    submissionUpdates = [];

    mockBotStart.mockResolvedValue({ ok: true });
    mockBotStop.mockResolvedValue(undefined);
    mockBotRequestAction.mockResolvedValue({
      ok: true,
      action: { type: 'MOVE', pieceId: 0, to: { row: 0, col: 0 } },
    });

    mockStorage = {
      get: vi.fn().mockResolvedValue(dummyArchive),
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT') && sql.includes('FROM submissions WHERE id = $1')) {
          return { rows: [validSubmissionRow] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('SELECT status FROM submissions WHERE id = $1 FOR UPDATE')) {
              return { rows: [{ status: 'PREFLIGHT' }] };
            }
            if (sql.includes("UPDATE submissions SET status = 'VALID'")) {
              return { rowCount: 1 };
            }
            if (sql.includes("UPDATE submissions SET status = 'ACTIVE'")) {
              return { rowCount: 1 };
            }
            if (sql.includes("UPDATE submissions SET status = 'INVALID'")) {
              submissionUpdates.push({ status: 'INVALID', params });
              return { rowCount: 1 };
            }
            if (sql.includes('INSERT INTO audit_events')) {
              auditEvents.push({ sql, params });
              return { rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }),
        };
        return cb(tx);
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. throws PREFLIGHT_INFRA_DOCKER and leaves submission in PREFLIGHT when Docker is unreachable before sandbox', async () => {
    const dockerReachable = vi.fn().mockResolvedValue(false);

    await expect(
      preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
      }),
    ).rejects.toThrow('PREFLIGHT_INFRA_DOCKER');

    expect(dockerReachable).toHaveBeenCalledTimes(1);
    expect(mockBotStart).not.toHaveBeenCalled();
    expect(submissionUpdates.length).toBe(0);
    expect(auditEvents.length).toBe(0);
  });

  it('2. throws PREFLIGHT_INFRA_STORAGE and leaves submission in PREFLIGHT when storage.get fails', async () => {
    mockStorage.get.mockRejectedValue(new Error('S3 connection reset'));
    const dockerReachable = vi.fn().mockResolvedValue(true);

    await expect(
      preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
      }),
    ).rejects.toThrow('PREFLIGHT_INFRA_STORAGE');

    expect(dockerReachable).not.toHaveBeenCalled();
    expect(mockBotStart).not.toHaveBeenCalled();
    expect(submissionUpdates.length).toBe(0);
    expect(auditEvents.length).toBe(0);
  });

  it('3. throws PREFLIGHT_INFRA_DOCKER and leaves submission in PREFLIGHT when BOT_SPAWN_FAILED occurs and Docker is unreachable on re-check', async () => {
    let callCount = 0;
    const dockerReachable = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1; // reachable before sandbox, unreachable during re-check
    });

    mockBotStart.mockResolvedValue({
      ok: false,
      code: 'BOT_SPAWN_FAILED',
      message: 'docker daemon gone',
    });

    await expect(
      preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
      }),
    ).rejects.toThrow('PREFLIGHT_INFRA_DOCKER');

    expect(dockerReachable).toHaveBeenCalledTimes(2);
    expect(mockBotStart).toHaveBeenCalledTimes(1);
    expect(mockBotStop).toHaveBeenCalledTimes(1);
    expect(submissionUpdates.length).toBe(0);
    expect(auditEvents.length).toBe(0);
  });

  it('4. marks submission INVALID and records audit event when BOT_SPAWN_FAILED occurs and Docker is still reachable', async () => {
    const dockerReachable = vi.fn().mockResolvedValue(true);

    mockBotStart.mockResolvedValue({
      ok: false,
      code: 'BOT_SPAWN_FAILED',
      message: 'entrypoint not found inside image',
    });

    await expect(
      preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
      }),
    ).rejects.toThrow('PREFLIGHT_START_BOT_SPAWN_FAILED');

    expect(dockerReachable).toHaveBeenCalledTimes(2);
    expect(mockBotStart).toHaveBeenCalledTimes(1);
    expect(mockBotStop).toHaveBeenCalledTimes(1);
    expect(submissionUpdates.length).toBe(1);
    expect(submissionUpdates[0].status).toBe('INVALID');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].sql).toContain('SUBMISSION_PREFLIGHT_FAILED');
    expect(auditEvents[0].params).toContain('PREFLIGHT_START_BOT_SPAWN_FAILED');
  });

  it('5. forwards configured dockerSocketPath to SandboxOciBotPort constructor', async () => {
    const dockerReachable = vi.fn().mockResolvedValue(true);

    const result = await preflightSubmission({
      submissionId: 'sub-test-123',
      database: mockDb,
      storage: mockStorage,
      dockerReachable,
      dockerSocketPath: '/custom/docker.sock',
    });

    expect(result.status).toBe('ACTIVE');
    expect(mockBotConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        dockerSocketPath: '/custom/docker.sock',
      }),
    );
  });

  it('6. forwards configured dockerSocketPath to custom createBotPort factory seam', async () => {
    const dockerReachable = vi.fn().mockResolvedValue(true);
    const capturedOptions: any[] = [];
    const customCreateBotPort = vi.fn().mockImplementation((opts) => {
      capturedOptions.push(opts);
      return {
        start: vi.fn().mockResolvedValue({ ok: true }),
        requestAction: vi.fn().mockResolvedValue({ ok: true }),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    });

    const result = await preflightSubmission({
      submissionId: 'sub-test-123',
      database: mockDb,
      storage: mockStorage,
      dockerReachable,
      dockerSocketPath: '/seam/docker.sock',
      createBotPort: customCreateBotPort,
    });

    expect(result.status).toBe('ACTIVE');
    expect(customCreateBotPort).toHaveBeenCalledTimes(1);
    expect(capturedOptions[0].dockerSocketPath).toBe('/seam/docker.sock');
  });
});

