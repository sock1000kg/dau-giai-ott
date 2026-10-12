import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ActionMessage, InitMessage, MatchResultMessage, ProtocolMessage, ProtocolValidator, StateUpdateMessage, TurnResultMessage } from '@ott/bot-protocol';
import { compileProtocolValidator, utf8ByteLength } from '@ott/bot-protocol';
import type { BotPort, BotReply, BotStartResult } from '@ott/match-runner';
import type { ProcessFaultCode } from '@ott/game-core';
import type { OciArtifactReference } from '@ott/job-contract';
import { validatePinnedOciArtifact } from '../artifacts.ts';
import { DockerOciRuntime, type RunningContainer } from './oci-runtime.ts';
import { SANDBOX_POLICY_V1, type SandboxPolicy } from './policy.ts';

export interface SandboxOciBotPortOptions {
  readonly archive: Uint8Array;
  readonly reference: OciArtifactReference;
  readonly expectedEntrypoint: readonly string[];
  readonly validator?: ProtocolValidator;
  readonly dockerSocketPath?: string;
  readonly policy?: SandboxPolicy;
}

type Pending = { readonly turnId: number; readonly resolve: (reply: BotReply) => void; timer: NodeJS.Timeout };

/** BotPort over Docker Engine attach streams; no image build, shell, CLI or host mount. */
export class SandboxOciBotPort implements BotPort {
  private readonly options: SandboxOciBotPortOptions;
  private readonly policy: SandboxPolicy;
  private readonly runtime: DockerOciRuntime;
  private readonly identity;
  private validator: ProtocolValidator | undefined;
  private running: RunningContainer | undefined;
  private pending: Pending | undefined;
  private fault: ProcessFaultCode | undefined;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private protocolBytes = Buffer.alloc(0);
  private dockerFrames = Buffer.alloc(0);
  private closed = false;
  private waitTask?: Promise<{ readonly statusCode: number; readonly oomKilled: boolean }>;
  private stopTask?: Promise<void>;

  constructor(options: SandboxOciBotPortOptions) {
    this.options = options;
    this.policy = options.policy ?? SANDBOX_POLICY_V1;
    this.runtime = new DockerOciRuntime({ ...(options.dockerSocketPath === undefined ? {} : { socketPath: options.dockerSocketPath }), policy: this.policy });
    this.identity = validatePinnedOciArtifact(options.archive, options.reference, options.expectedEntrypoint, this.policy);
    this.validator = options.validator;
  }

  async start(init: InitMessage): Promise<BotStartResult> {
    if (this.running || this.closed) return { ok: false, code: 'BOT_SPAWN_FAILED' };
    try {
      this.validator ??= compileProtocolValidator(JSON.parse(await readFile(new URL('../../../../../docs/contracts/bot-protocol-v1.schema.json', import.meta.url), 'utf8')) as unknown);
      const imageId = await this.runtime.loadAndVerify(this.options.archive, this.identity.ociManifestDigest, this.identity.ociConfigDigest, this.identity.entrypoint);
      this.running = await this.runtime.createAndStart(imageId, this.identity.entrypoint, `ott-${randomUUID()}`);
      this.running.stream.on('data', (chunk: Buffer) => this.onDockerData(chunk));
      this.running.stream.on('error', () => this.onExit('BOT_CRASHED'));
      // Stream EOF has no exit status; the Engine wait endpoint is authoritative for exit/OOM classification.
      this.waitTask = this.runtime.wait(this.running.id).then((result) => {
        if (!this.closed) this.onExit(result.oomKilled ? 'RESOURCE_LIMIT_EXCEEDED' : result.statusCode === 0 ? 'BOT_EOF' : 'BOT_CRASHED');
        return result;
      }).catch(() => {
        if (!this.closed) this.onExit('BOT_CRASHED');
        return { statusCode: 1, oomKilled: false };
      });
      const effectiveInit: InitMessage = {
        ...init,
        limits: {
          ...init.limits,
          startupTimeoutMs: Math.min(init.limits.startupTimeoutMs, this.policy.startupTimeoutMs),
          turnTimeoutMs: Math.min(init.limits.turnTimeoutMs, this.policy.turnTimeoutMs),
          maxMessageBytes: Math.min(init.limits.maxMessageBytes, this.policy.maxMessageBytes),
          maxStderrBytes: Math.min(init.limits.maxStderrBytes, this.policy.maxStderrBytes),
        },
      };
      if (!this.write(effectiveInit)) {
        const code = this.processFault() ?? 'BOT_SPAWN_FAILED';
        await this.stop();
        return { ok: false, code };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (this.fault) {
        const code = this.processFault() ?? 'BOT_SPAWN_FAILED';
        await this.stop();
        return { ok: false, code };
      }
      return { ok: true };
    } catch {
      await this.stop();
      return { ok: false, code: 'BOT_SPAWN_FAILED' };
    }
  }

  requestAction(update: StateUpdateMessage, timeoutMs: number): Promise<BotReply> {
    if (this.fault) return Promise.resolve({ ok: false, code: this.fault });
    if (this.pending || !this.running) return Promise.resolve({ ok: false, code: 'BOT_CRASHED' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.turnId !== update.turnId) return;
        this.settle({ ok: false, code: 'BOT_TIMEOUT' });
      }, Math.min(timeoutMs, this.policy.turnTimeoutMs));
      this.pending = { turnId: update.turnId, resolve, timer };
      if (!this.write(update)) this.settle({ ok: false, code: this.fault ?? 'BOT_CRASHED' });
    });
  }

  async notifyStateUpdate(update: StateUpdateMessage): Promise<void> { this.write(update); }
  async sendTurnResult(message: TurnResultMessage): Promise<void> { this.write(message); }
  async finish(message: MatchResultMessage): Promise<void> { this.write(message); }

  async stop(): Promise<void> {
    this.stopTask ??= this.cleanup();
    return this.stopTask;
  }

  async inspectSandbox() {
    if (!this.running) throw new Error('SANDBOX_NOT_RUNNING');
    return this.runtime.inspectSandbox(this.running.id);
  }

  /** Read-only Docker stats for local P2-T15 quota qualification; never sent to teams. */
  async benchmarkStats() {
    if (!this.running) throw new Error('SANDBOX_NOT_RUNNING');
    return this.runtime.benchmarkStats(this.running.id);
  }

  private write(message: ProtocolMessage): boolean {
    if (!this.running || this.fault || this.closed) return false;
    const line = `${JSON.stringify(message)}\n`;
    if (utf8ByteLength(line.slice(0, -1)) > this.policy.maxMessageBytes) return false;
    return this.running.stream.write(line);
  }

  private onDockerData(chunk: Buffer): void {
    if (this.closed) return;
    this.dockerFrames = Buffer.concat([this.dockerFrames, chunk]);
    let offset = 0;
    while (this.dockerFrames.length - offset >= 8) {
      const streamType = this.dockerFrames[offset]!;
      const size = this.dockerFrames.readUInt32BE(offset + 4);
      if (size > this.policy.maxStdoutBytes + this.policy.maxStderrBytes) { this.fail('RESOURCE_LIMIT_EXCEEDED'); return; }
      if (this.dockerFrames.length - offset < 8 + size) break;
      const body = this.dockerFrames.subarray(offset + 8, offset + 8 + size);
      if (streamType === 1) this.onStdout(body);
      else if (streamType === 2) this.onStderr(body);
      offset += 8 + size;
    }
    this.dockerFrames = this.dockerFrames.subarray(offset);
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBytes += chunk.byteLength;
    if (this.stdoutBytes > this.policy.maxStdoutBytes) { this.fail('RESOURCE_LIMIT_EXCEEDED'); return; }
    this.protocolBytes = Buffer.concat([this.protocolBytes, chunk]);
    if (this.protocolBytes.length > this.policy.maxMessageBytes && !this.protocolBytes.includes(0x0a)) { this.settle({ ok: false, code: 'MESSAGE_TOO_LARGE' }); return; }
    for (;;) {
      const newline = this.protocolBytes.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.protocolBytes.subarray(0, newline).toString('utf8');
      this.protocolBytes = this.protocolBytes.subarray(newline + 1);
      this.onProtocolLine(line);
    }
  }

  private onStderr(chunk: Buffer): void {
    this.stderrBytes += chunk.byteLength;
    if (this.stderrBytes > this.policy.maxStderrBytes) this.fail('STDERR_LIMIT_EXCEEDED');
  }

  private onProtocolLine(line: string): void {
    if (utf8ByteLength(line) > this.policy.maxMessageBytes) { this.settle({ ok: false, code: 'MESSAGE_TOO_LARGE' }); return; }
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.settle({ ok: false, code: 'MALFORMED_JSON' }); return; }
    if (!this.validator?.isProtocolMessage(message) || typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'ACTION') {
      this.settle({ ok: false, code: 'SCHEMA_VIOLATION' }); return;
    }
    const action = message as ActionMessage;
    if (!this.pending || action.turnId !== this.pending.turnId) return;
    this.settle({ ok: true, message: action });
  }

  private settle(reply: BotReply): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(reply);
  }

  private onExit(code: ProcessFaultCode): void {
    if (this.closed || this.fault) return;
    this.fault = code;
    if (code === 'RESOURCE_LIMIT_EXCEEDED' || code === 'STDERR_LIMIT_EXCEEDED') void this.runtime.kill(this.running!.id);
    this.settle({ ok: false, code });
  }

  private fail(code: ProcessFaultCode): void {
    this.fault = code;
    this.settle({ ok: false, code });
    if (this.running) void this.runtime.kill(this.running.id);
  }

  private async cleanup(): Promise<void> {
    this.closed = true;
    if (this.pending) this.settle({ ok: false, code: this.fault ?? 'BOT_EOF' });
    const running = this.running;
    if (!running) return;
    const timer = setTimeout(() => { void this.runtime.kill(running.id); }, this.policy.stopGraceMs);
    running.stream.end();
    try { await this.waitTask; } finally {
      clearTimeout(timer);
      running.stream.destroy();
      await this.runtime.remove(running.id).catch(() => undefined);
      this.running = undefined;
    }
  }

  private processFault(): ProcessFaultCode | undefined {
    return this.fault;
  }
}
