import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPrivateReplay, fetchPublicReplay, SpectatorReplayError } from './api.ts';
import { verifyReplayResponse } from './verify-replay.ts';

const matchId = '00000000-0000-4000-8000-000000000001';

function validReplay() {
  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 1,
    matchId,
    header: {
      format: 'ott.match-event-log',
      formatVersion: 1,
      matchId,
      protocolVersion: 1,
      engineVersion: '1.0.0',
      game: {
        engineVersion: '1.0.0',
        maxTurns: 1,
        map: {
          schemaVersion: 1,
          mapId: 'default',
          version: 1,
          checksum: 'a'.repeat(64),
          width: 9,
          height: 9,
          obstacles: [],
          spawns: [{ id: 'x-one', owner: 'X', type: 'ROCK', position: { col: 1, row: 1 } }],
          goals: { X: { col: 0, row: 0 }, O: { col: 8, row: 8 } },
        },
      },
    },
    entries: [{
      index: 1,
      input: { kind: 'skip', side: 'X', reason: 'NO_LEGAL_ACTION' },
      events: [
        { sequence: 0, revision: 1, turnId: 1, type: 'TURN_SKIPPED', side: 'X', action: null, reason: 'NO_LEGAL_ACTION' },
        { sequence: 1, revision: 1, turnId: 1, type: 'MATCH_FINISHED', side: 'X', action: null, reason: 'TURN_LIMIT' },
      ],
      revision: 1,
      stateHash: 'b'.repeat(64),
    }],
    result: { winnerSide: null, reason: 'TURN_LIMIT', turnCount: 1, forfeitedSide: null, finalStateHash: 'b'.repeat(64) },
    faults: {
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    },
  };
}

function validReplayV2() {
  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 2,
    matchId,
    header: {
      format: 'ott.match-event-log',
      formatVersion: 2,
      matchId,
      protocolVersion: 2,
      engineVersion: '1.0.0',
      limits: {
        timeControl: {
          startupMs: 2000,
          totalBotBudgetMs: 30000,
          matchWallClockMs: 60000,
          perTurn: { mode: 'FIXED', fixedMs: 1000 },
        },
      },
      game: {
        engineVersion: '1.0.0',
        maxTurns: 1,
        map: {
          schemaVersion: 1,
          mapId: 'default',
          version: 1,
          checksum: 'a'.repeat(64),
          width: 9,
          height: 9,
          obstacles: [],
          spawns: [{ id: 'x-one', owner: 'X', type: 'ROCK', position: { col: 1, row: 1 } }],
          goals: { X: { col: 0, row: 0 }, O: { col: 8, row: 8 } },
        },
      },
    },
    entries: [{
      index: 1,
      input: { kind: 'skip', side: 'X', reason: 'NO_LEGAL_ACTION' },
      events: [
        { sequence: 0, revision: 1, turnId: 1, type: 'TURN_SKIPPED', side: 'X', action: null, reason: 'NO_LEGAL_ACTION' },
        { sequence: 1, revision: 1, turnId: 1, type: 'MATCH_FINISHED', side: 'X', action: null, reason: 'TURN_LIMIT' },
      ],
      revision: 1,
      stateHash: 'b'.repeat(64),
    }],
    timing: [
      {
        turnId: 1,
        side: 'X',
        turnLimitMs: 1000,
        deadlineMs: 1000,
        remainingBeforeMs: 30000,
        wallElapsedBeforeMs: 0,
        elapsedMs: 120,
        timedOut: false,
        chargedMs: 120,
        remainingAfterMs: 29880,
        exhaustion: null,
      },
    ],
    result: { winnerSide: null, reason: 'TURN_LIMIT', turnCount: 1, forfeitedSide: null, finalStateHash: 'b'.repeat(64) },
    faults: {
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    },
  };
}

function response(body: string, options: { status?: number; contentType?: string; checksum?: string } = {}): Response {
  const checksum = options.checksum ?? `sha256:${createHash('sha256').update(body).digest('hex')}`;
  return new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'application/vnd.ott.spectator-replay+json;version=1', 'x-replay-sha256': checksum },
  });
}

function responseV2(body: string, options: { status?: number; contentType?: string; checksum?: string } = {}): Response {
  const checksum = options.checksum ?? `sha256:${createHash('sha256').update(body).digest('hex')}`;
  return new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'application/vnd.ott.spectator-replay+json;version=2', 'x-replay-sha256': checksum },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('spectator replay integrity client', () => {
  it('verifies exact response bytes before returning the typed replay model', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const replay = await verifyReplayResponse(response(body));
    expect(replay.matchId).toBe(matchId);
    expect(replay.entries[0]?.events[0]?.sequence).toBe(0);
    expect(replay.entries[0]?.input.kind).toBe('skip');
  });

  it('accepts Fastify-normalized media type parameters while requiring replay version 1', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const replay = await verifyReplayResponse(response(body, {
      contentType: 'application/vnd.ott.spectator-replay+json; version="1"; charset=utf-8',
    }));
    expect(replay.matchId).toBe(matchId);
  });

  it('accepts valid v2 replay with version=2 and Fastify-normalized media type parameters', async () => {
    const body = `${JSON.stringify(validReplayV2(), null, 2)}\n`;
    const replay = await verifyReplayResponse(responseV2(body, {
      contentType: 'application/vnd.ott.spectator-replay+json; version="2"; charset=utf-8',
    }));
    expect(replay.matchId).toBe(matchId);
    expect(replay.schemaVersion).toBe(2);
    if (replay.schemaVersion === 2) {
      expect(replay.timing).toHaveLength(1);
      expect(replay.timing[0]?.elapsedMs).toBe(120);
      expect(replay.timing[0]?.remainingAfterMs).toBe(29880);
      expect(replay.header.limits.timeControl.perTurn.mode).toBe('FIXED');
    }
  });

  it('rejects media-type version mismatch between header and body', async () => {
    const v2Body = `${JSON.stringify(validReplayV2(), null, 2)}\n`;
    // header says version=1, body says schemaVersion=2
    await expect(verifyReplayResponse(response(v2Body, {
      contentType: 'application/vnd.ott.spectator-replay+json;version=1',
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    const v1Body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    // header says version=2, body says schemaVersion=1
    await expect(verifyReplayResponse(responseV2(v1Body, {
      contentType: 'application/vnd.ott.spectator-replay+json;version=2',
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('rejects a modified response before exposing any replay data', async () => {
    const canonicalBody = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const tamperedBody = canonicalBody.replace('TURN_LIMIT', 'FORFEIT__');
    await expect(verifyReplayResponse(response(tamperedBody, { checksum: `sha256:${createHash('sha256').update(canonicalBody).digest('hex')}` })))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('includes the contract final newline in the checksum input', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const checksumWithoutNewline = `sha256:${createHash('sha256').update(body.slice(0, -1)).digest('hex')}`;
    await expect(verifyReplayResponse(response(body, { checksum: checksumWithoutNewline })))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('returns a stable not-found error for private or missing replays', async () => {
    await expect(verifyReplayResponse(new Response(JSON.stringify({ error: { code: 'REPLAY_NOT_FOUND' } }), { status: 404 })))
      .rejects.toMatchObject({ code: 'REPLAY_NOT_FOUND' });
  });

  it('rejects unsupported schema versions even when their bytes have a valid checksum', async () => {
    const replay = { ...validReplay(), schemaVersion: 3 };
    const body = `${JSON.stringify(replay, null, 2)}\n`;
    await expect(verifyReplayResponse(response(body, {
      contentType: 'application/vnd.ott.spectator-replay+json;version=3',
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('rejects v2 replay when versions violate allowlist', async () => {
    const badReplay = {
      ...validReplayV2(),
      header: {
        ...validReplayV2().header,
        formatVersion: 1, // protocol 2 with format 1 is invalid
      },
    };
    const body = `${JSON.stringify(badReplay, null, 2)}\n`;
    await expect(verifyReplayResponse(responseV2(body))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('rejects malformed timing entry in v2', async () => {
    const badTimingReplay = {
      ...validReplayV2(),
      timing: [
        {
          turnId: 1,
          side: 'X',
          turnLimitMs: 1000,
          deadlineMs: 1000,
          remainingBeforeMs: 30000,
          wallElapsedBeforeMs: 0,
          elapsedMs: -10,
          timedOut: false,
          chargedMs: 120,
          remainingAfterMs: 29880,
          exhaustion: null,
        },
      ],
    };
    const body = `${JSON.stringify(badTimingReplay, null, 2)}\n`;
    await expect(verifyReplayResponse(responseV2(body))).rejects.toMatchObject({ code: 'INVALID_REPLAY' });
  });

  it('rejects malformed payloads after checksum verification', async () => {
    const body = '{"schema":"ott.spectator-replay","schemaVersion":1}\n';
    await expect(verifyReplayResponse(response(body))).rejects.toMatchObject({ code: 'INVALID_REPLAY' });
  });

  it('returns an allowlisted model and never forwards unrecognized or private fields', async () => {
    const replay = { ...validReplay(), header: { ...validReplay().header, seed: 'private-seed' }, privateObjectKey: 'secret-key' };
    const body = `${JSON.stringify(replay, null, 2)}\n`;
    const result = await verifyReplayResponse(response(body));
    expect(JSON.stringify(result)).not.toContain('private-seed');
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('requests only the anonymous public endpoint without session credentials', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const fetchMock = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal('fetch', fetchMock);
    await fetchPublicReplay(matchId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/replays/${matchId}`, { credentials: 'omit' });
  });

  it('requests the public bundle replay endpoint when bundleId is supplied', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const fetchMock = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal('fetch', fetchMock);
    const bundleId = 'demo-finals-bundle-2026';
    await fetchPublicReplay(matchId, bundleId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/result-bundles/${bundleId}/replays/${matchId}`, { credentials: 'omit' });
  });

  it('falls back to non-bundle route when bundleId is malformed', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const fetchMock = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal('fetch', fetchMock);
    await fetchPublicReplay(matchId, '../malformed/bundle');
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/replays/${matchId}`, { credentials: 'omit' });
  });

  it('applies the importer bundle-id rule: 1..128 chars, no path/query/fragment/whitespace/control characters', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    for (const bad of ['', 'a'.repeat(129), 'a/b', 'a?b', 'a#b', 'a b', 'a\tb', 'a\u0000b']) {
      const fetchMock = vi.fn().mockResolvedValue(response(body));
      vi.stubGlobal('fetch', fetchMock);
      await fetchPublicReplay(matchId, bad);
      expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/replays/${matchId}`, { credentials: 'omit' });
    }
    for (const good of ['a', 'a'.repeat(128), 'bundle@v1+x', 'finals_2026.v1:final']) {
      const fetchMock = vi.fn().mockResolvedValue(response(body));
      vi.stubGlobal('fetch', fetchMock);
      await fetchPublicReplay(matchId, good);
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/public/result-bundles/${encodeURIComponent(good)}/replays/${matchId}`,
        { credentials: 'omit' },
      );
    }
  });

  it('handles bundle-path 404 and 500 error states identically to normal path', async () => {
    const fetch404 = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch404);
    await expect(fetchPublicReplay(matchId, 'valid-bundle-id')).rejects.toMatchObject({ code: 'REPLAY_NOT_FOUND' });

    const fetch500 = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetch500);
    await expect(fetchPublicReplay(matchId, 'valid-bundle-id')).rejects.toMatchObject({ code: 'REPLAY_UNAVAILABLE' });
  });

  it('verifies integrity and headers on the bundle path response', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    // Bad sha256 header on bundle response
    const badShaResponse = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.ott.spectator-replay+json; version=1',
        'x-replay-sha256': 'sha256:' + '0'.repeat(64),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badShaResponse));
    await expect(fetchPublicReplay(matchId, 'valid-bundle-id')).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });

    // Wrong media type on bundle response
    const badTypeResponse = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'x-replay-sha256': `sha256:${createHash('sha256').update(body).digest('hex')}`,
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badTypeResponse));
    await expect(fetchPublicReplay(matchId, 'valid-bundle-id')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('normalizes network failures and rejects invalid match identifiers before fetching', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network details'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPublicReplay(matchId)).rejects.toMatchObject({ code: 'REPLAY_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(fetchPublicReplay('../private-object')).rejects.toThrow('Invalid replay match ID');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('requests the private endpoint with session credentials and verifies integrity', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const fetchMock = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchPrivateReplay(matchId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/replays/${matchId}`, { credentials: 'include' });
    expect(result.matchId).toBe(matchId);
  });

  it('rejects invalid match IDs and handles 401 unauthenticated for private replay', async () => {
    await expect(fetchPrivateReplay('../invalid')).rejects.toThrow('Invalid replay match ID');

    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPrivateReplay(matchId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
