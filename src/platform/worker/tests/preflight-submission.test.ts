import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileProtocolValidator, validateTimeControlV2 } from '@ott/bot-protocol';

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

import { preflightSubmission, PREFLIGHT_TIME_CONTROL } from '../src/preflight-submission.ts';

const v2Schema = JSON.parse(readFileSync(new URL('../../../../docs/contracts/bot-protocol-v2.schema.json', import.meta.url), 'utf8'));
const v2Validator = compileProtocolValidator(v2Schema);

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

  it('7. sends Bot Protocol v2 INIT and STATE_UPDATE passing v2 validator', async () => {
    const dockerReachable = vi.fn().mockResolvedValue(true);
    let capturedInit: any;
    let capturedUpdate: any;

    mockBotStart.mockImplementation(async (init) => {
      capturedInit = init;
      return { ok: true };
    });
    mockBotRequestAction.mockImplementation(async (update) => {
      capturedUpdate = update;
      return {
        ok: true,
        action: { type: 'MOVE', pieceId: 0, to: { row: 0, col: 0 } },
      };
    });

    const result = await preflightSubmission({
      submissionId: 'sub-test-123',
      database: mockDb,
      storage: mockStorage,
      dockerReachable,
    });

    expect(result.status).toBe('ACTIVE');

    // Assert INIT is valid v2
    expect(capturedInit).toBeDefined();
    expect(capturedInit.type).toBe('INIT');
    expect(capturedInit.protocolVersion).toBe(2);
    expect(typeof capturedInit.botSeed).toBe('string');
    expect(capturedInit.botSeed).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(capturedInit.botSeed)).toBe(true);
    expect(capturedInit.limits.timeControl).toEqual(PREFLIGHT_TIME_CONTROL);
    expect(validateTimeControlV2(capturedInit.limits.timeControl).ok).toBe(true);
    expect(v2Validator.isProtocolMessage(capturedInit)).toBe(true);

    // Assert STATE_UPDATE is valid v2
    expect(capturedUpdate).toBeDefined();
    expect(capturedUpdate.type).toBe('STATE_UPDATE');
    expect(capturedUpdate.protocolVersion).toBe(2);
    expect(capturedUpdate.timeBudget).toEqual({
      turnLimitMs: PREFLIGHT_TIME_CONTROL.perTurn.fixedMs,
      remainingBotBudgetMs: PREFLIGHT_TIME_CONTROL.totalBotBudgetMs,
    });
    expect(v2Validator.isProtocolMessage(capturedUpdate)).toBe(true);
  });

  it('8. marks submission INVALID with PREFLIGHT_ACTION_SCHEMA_VIOLATION when bot replies with protocolVersion 1', async () => {
    const dockerReachable = vi.fn().mockResolvedValue(true);

    // When a bot replies with protocolVersion 1 against a v2 session,
    // SandboxOciBotPort returns { ok: false, code: 'SCHEMA_VIOLATION' }
    mockBotRequestAction.mockResolvedValue({
      ok: false,
      code: 'SCHEMA_VIOLATION',
    });

    await expect(
      preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
      }),
    ).rejects.toThrow('PREFLIGHT_ACTION_SCHEMA_VIOLATION');

    expect(submissionUpdates.length).toBe(1);
    expect(submissionUpdates[0].status).toBe('INVALID');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].sql).toContain('SUBMISSION_PREFLIGHT_FAILED');
    expect(auditEvents[0].params).toContain('PREFLIGHT_ACTION_SCHEMA_VIOLATION');
  });

  describe('AC-22: OCI layer recording and duplicate check wiring in preflight', () => {
    it('calls layer recording and duplicate check after smoke success and before activation', async () => {
      const order: string[] = [];
      const dockerReachable = vi.fn().mockResolvedValue(true);
      const mockExtract = vi.fn().mockImplementation(() => {
        order.push('extract');
        return {
          manifestDigest: 'sha256:manifest123',
          configDigest: 'sha256:config123',
          layers: [{ digest: 'sha256:l1', mediaType: 'application/vnd.oci.image.layer.v1.tar', size: 100 }],
          baseLayerDigests: [],
          nonBaseLayerDigests: ['sha256:l1'],
        };
      });
      const mockRecord = vi.fn().mockImplementation(async () => {
        order.push('record');
        return { totalLayers: 1, newLayersCount: 1, sharedLayersCount: 0 };
      });
      const mockCheck = vi.fn().mockImplementation(async () => {
        order.push('check');
        return { isDuplicate: false };
      });

      // Track activation in db transaction
      const origTransaction = mockDb.transaction;
      mockDb.transaction = vi.fn().mockImplementation(async (cb: any) => {
        order.push('activate');
        return origTransaction(cb);
      });

      const result = await preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
        extractLayers: mockExtract,
        recordLayers: mockRecord,
        checkDuplicate: mockCheck,
      });

      expect(result.status).toBe('ACTIVE');
      expect(order).toEqual(['extract', 'record', 'check', 'activate']);
      expect(mockRecord).toHaveBeenCalledWith(mockDb, {
        submissionId: 'sub-test-123',
        layers: [
          {
            digest: 'sha256:l1',
            mediaType: 'application/vnd.oci.image.layer.v1.tar',
            sizeBytes: 100,
            storageKey: 'layers/sha256/l1',
            isBaseLayer: false,
          },
        ],
      });
      expect(mockCheck).toHaveBeenCalledWith(mockDb, {
        submissionId: 'sub-test-123',
        teamId: 'team-1',
        manifestDigest: 'sha256:manifest123',
        nonBaseLayerDigests: ['sha256:l1'],
      });
    });

    it('extraction error logs warning and continues to activate (still ACTIVE)', async () => {
      const dockerReachable = vi.fn().mockResolvedValue(true);
      const mockExtract = vi.fn().mockImplementation(() => {
        throw new Error('CORRUPT_TAR');
      });
      const mockRecord = vi.fn();
      const mockCheck = vi.fn();
      const warnMock = vi.fn();

      const result = await preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
        extractLayers: mockExtract,
        recordLayers: mockRecord,
        checkDuplicate: mockCheck,
        logger: { warn: warnMock },
      });

      expect(result.status).toBe('ACTIVE');
      expect(mockExtract).toHaveBeenCalledTimes(1);
      expect(mockRecord).not.toHaveBeenCalled();
      expect(mockCheck).not.toHaveBeenCalled();
      expect(warnMock).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(warnMock.mock.calls[0]![0] as string);
      expect(logged).toEqual({
        level: 'warn',
        message: 'duplicate check skipped',
        submissionId: 'sub-test-123',
        code: 'CORRUPT_TAR',
      });
    });

    it('duplicate-check error logs warning and continues to activate (still ACTIVE)', async () => {
      const dockerReachable = vi.fn().mockResolvedValue(true);
      const mockExtract = vi.fn().mockReturnValue({
        manifestDigest: 'sha256:manifest123',
        configDigest: 'sha256:config123',
        layers: [],
        baseLayerDigests: [],
        nonBaseLayerDigests: [],
      });
      const mockRecord = vi.fn().mockResolvedValue({ totalLayers: 0, newLayersCount: 0, sharedLayersCount: 0 });
      const mockCheck = vi.fn().mockRejectedValue(new Error('DB_QUERY_TIMEOUT'));
      const warnMock = vi.fn();

      const result = await preflightSubmission({
        submissionId: 'sub-test-123',
        database: mockDb,
        storage: mockStorage,
        dockerReachable,
        extractLayers: mockExtract,
        recordLayers: mockRecord,
        checkDuplicate: mockCheck,
        logger: { warn: warnMock },
      });

      expect(result.status).toBe('ACTIVE');
      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockCheck).toHaveBeenCalledTimes(1);
      expect(warnMock).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(warnMock.mock.calls[0]![0] as string);
      expect(logged).toEqual({
        level: 'warn',
        message: 'duplicate check skipped',
        submissionId: 'sub-test-123',
        code: 'DB_QUERY_TIMEOUT',
      });
    });

    it('smoke failure means neither layer recording nor duplicate check is called', async () => {
      const dockerReachable = vi.fn().mockResolvedValue(true);
      mockBotStart.mockResolvedValue({ ok: false, code: 'TIMEOUT' });

      const mockExtract = vi.fn();
      const mockRecord = vi.fn();
      const mockCheck = vi.fn();

      await expect(
        preflightSubmission({
          submissionId: 'sub-test-123',
          database: mockDb,
          storage: mockStorage,
          dockerReachable,
          extractLayers: mockExtract,
          recordLayers: mockRecord,
          checkDuplicate: mockCheck,
        }),
      ).rejects.toThrow('PREFLIGHT_START_TIMEOUT');

      expect(mockExtract).not.toHaveBeenCalled();
      expect(mockRecord).not.toHaveBeenCalled();
      expect(mockCheck).not.toHaveBeenCalled();
      expect(submissionUpdates.length).toBe(1);
      expect(submissionUpdates[0].status).toBe('INVALID');
    });

    it('PREFLIGHT_INFRA_DOCKER and PREFLIGHT_INFRA_STORAGE errors remain unchanged', async () => {
      const dockerReachable = vi.fn().mockResolvedValue(false);
      const mockExtract = vi.fn();

      await expect(
        preflightSubmission({
          submissionId: 'sub-test-123',
          database: mockDb,
          storage: mockStorage,
          dockerReachable,
          extractLayers: mockExtract,
        }),
      ).rejects.toThrow('PREFLIGHT_INFRA_DOCKER');

      expect(mockExtract).not.toHaveBeenCalled();

      // Storage infra failure
      mockStorage.get.mockRejectedValue(new Error('S3 down'));
      const dockerOk = vi.fn().mockResolvedValue(true);
      await expect(
        preflightSubmission({
          submissionId: 'sub-test-123',
          database: mockDb,
          storage: mockStorage,
          dockerReachable: dockerOk,
          extractLayers: mockExtract,
        }),
      ).rejects.toThrow('PREFLIGHT_INFRA_STORAGE');

      expect(mockExtract).not.toHaveBeenCalled();
    });
  });
});

