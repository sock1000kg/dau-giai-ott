import { Duplex } from 'node:stream';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileProtocolValidator, type InitMessageV2, type StateUpdateMessageV2 } from '@ott/bot-protocol';
import { SandboxOciBotPort } from '../src/sandbox/oci-bot-port.ts';

const state = vi.hoisted(() => ({ writes: [] as unknown[], replyVersion: 2, startDelayMs: 0, killed: 0, removed: 0, stream: undefined as Duplex | undefined,
  finish: undefined as (() => void) | undefined }));
vi.mock('../src/artifacts.ts', () => ({ validatePinnedOciArtifact: () => ({ ociManifestDigest: 'manifest', ociConfigDigest: 'config', entrypoint: ['bot'] }) }));
vi.mock('../src/sandbox/oci-runtime.ts', () => ({ DockerOciRuntime: class {
  async loadAndVerify() { return 'image'; }
  async createAndStart() {
    if (state.startDelayMs) await new Promise((resolve) => setTimeout(resolve, state.startDelayMs));
    const stream = new Duplex({ read() {}, write(chunk, _encoding, done) {
      const message = JSON.parse(chunk.toString()); state.writes.push(message); done();
      if (message.type === 'STATE_UPDATE') setTimeout(() => {
        const line = Buffer.from(JSON.stringify({ type: 'ACTION', protocolVersion: state.replyVersion, matchId: message.matchId,
          turnId: message.turnId, action: message.legalActions[0] }) + '\n');
        const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(line.length, 4);
        stream.push(Buffer.concat([header, line]));
      }, 10);
    }, final(done) { state.finish?.(); done(); } });
    state.stream = stream;
    return { id: 'container', stream };
  }
  wait() { return new Promise((resolve) => { state.finish = () => resolve({ statusCode: 0, oomKilled: false }); }); }
  async kill() { state.killed++; state.finish?.(); }
  async remove() { state.removed++; }
} }));
const fixtures = readFileSync(new URL('../../../../docs/contracts/fixtures/bot-protocol-v2-valid.ndjson', import.meta.url), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
const init = fixtures.find((m) => m.type === 'INIT') as InitMessageV2;
const update = fixtures.find((m) => m.type === 'STATE_UPDATE') as StateUpdateMessageV2;
const bots: SandboxOciBotPort[] = [];
afterEach(async () => { await Promise.all(bots.splice(0).map((b) => b.stop())); state.writes = []; state.startDelayMs = 0; });
function bot(validatorVersion?: number) {
  const b = new SandboxOciBotPort({ archive: new Uint8Array(), expectedEntrypoint: ['bot'], reference: {
    submissionId: 'fixture', archiveSha256: 'sha256:' + 'a'.repeat(64), manifestDigest: 'sha256:' + 'b'.repeat(64),
    configDigest: 'sha256:' + 'c'.repeat(64), policyVersion: 'OTT_SANDBOX_V1',
  }, ...(validatorVersion ? { validator: compileProtocolValidator(JSON.parse(readFileSync(
    new URL(`../../../../docs/contracts/bot-protocol-v${validatorVersion}.schema.json`, import.meta.url), 'utf8'))) } : {}) });
  bots.push(b); return b;
}
describe('sandbox pinned protocol v2 transport', () => {
  it('loads the matching schema and writes exact pinned INIT without v1 timing fields', async () => {
    state.replyVersion = 2;
    const b = bot();
    expect(await b.start(init)).toEqual({ ok: true });
    expect(state.writes[0]).toEqual(init);
    expect(await b.requestAction(update, 1500)).toMatchObject({ ok: true, message: { protocolVersion: 2 } });
  });
  it('rejects downgrade ACTION', async () => {
    state.replyVersion = 1;
    const b = bot(); await b.start(init);
    expect(await b.requestAction(update, 1500)).toEqual({ ok: false, code: 'SCHEMA_VIOLATION' });
  });
  it('keeps the v1 transport compatible', async () => {
    state.replyVersion = 1;
    const v1 = readFileSync(new URL('../../../../docs/contracts/fixtures/bot-protocol-v1-valid.ndjson', import.meta.url), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line));
    const b = bot();
    expect(await b.start(v1.find((m) => m.type === 'INIT'))).toEqual({ ok: true });
    expect(await b.requestAction(v1.find((m) => m.type === 'STATE_UPDATE'), 1500))
      .toMatchObject({ ok: true, message: { protocolVersion: 1 } });
  });
  it('does not replace a v2 deadline with the old fixed 3s cap', async () => {
    state.replyVersion = 2;
    const b = bot(); await b.start(init);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    try {
      expect(await b.requestAction(update, 4000)).toMatchObject({ ok: true });
      expect(timeout.mock.calls.some((call) => call[1] === 4000)).toBe(true);
      expect(timeout.mock.calls.some((call) => call[1] === 3000)).toBe(false);
    } finally { timeout.mockRestore(); }
  });
  it('rejects a mismatched injected validator before loading a container', async () => {
    const b = bot(1);
    expect(await b.start(init)).toEqual({ ok: false, code: 'BOT_SPAWN_FAILED' });
    expect(state.writes).toEqual([]);
  });
  it('enforces pinned startup and removes a container that starts after the timeout', async () => {
    state.startDelayMs = 60;
    const previousKills = state.killed, previousRemoves = state.removed;
    const b = bot();
    expect(await b.start({ ...init, limits: { ...init.limits, timeControl: { ...init.limits.timeControl, startupMs: 5 } } }))
      .toEqual({ ok: false, code: 'BOT_SPAWN_FAILED' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(state.writes).toEqual([]);
    expect(state.killed).toBe(previousKills + 1);
    expect(state.removed).toBe(previousRemoves + 1);
  });
});
