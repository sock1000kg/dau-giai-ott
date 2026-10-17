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

function response(body: string, options: { status?: number; contentType?: string; checksum?: string } = {}): Response {
  const checksum = options.checksum ?? `sha256:${createHash('sha256').update(body).digest('hex')}`;
  return new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'application/vnd.ott.spectator-replay+json;version=1', 'x-replay-sha256': checksum },
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
    const replay = { ...validReplay(), schemaVersion: 2 };
    const body = `${JSON.stringify(replay, null, 2)}\n`;
    await expect(verifyReplayResponse(response(body))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
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
