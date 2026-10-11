/**
 * BotProcess NDJSON adapter (P1-D05, refined in P1-D06).
 *
 * Implements BotPort for a child process communicating over stdin/stdout via NDJSON:
 * - Spawns executable by argv directly with `shell: false` (no shell string execution).
 * - Transport framing and byte limit enforced by pure LineBuffer.
 * - Parses and schema-validates incoming lines in the request window; lines outside the
 *   window are discarded and logged/counted as unexpected.
 * - Stderr is kept completely separate from protocol streams with a strict byte quota.
 * - Enforces monotonic startup and turn timeouts computed strictly after write completion.
 * - Sticky process faults guarantee send-only methods never throw and subsequent requests fail fast.
 * - Late replies from timed-out turns are safely discarded without poisoning subsequent turns.
 * - Idempotent, clean stop() lifecycle with progressive escalation (stdin EOF -> SIGTERM -> SIGKILL).
 * - Adapter does NOT check matchId, turnId, or action legality; the runner (D04) checks them.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import {
  utf8ByteLength,
  type ActionMessage,
  type InitMessage,
  type MatchResultMessage,
  type ProtocolMessage,
  type ProtocolValidator,
  type StateUpdateMessage,
  type TurnResultMessage,
} from '@ott/bot-protocol';
import type { ProcessFaultCode } from '@ott/game-core';

import { LineBuffer, type LineEvent } from './line-buffer.ts';
import type { BotPort, BotReply, BotStartResult } from './ports.ts';
import { classifyExit, type ProcessPhase } from './process-errors.ts';

export interface BotProcessDiagnostic {
  readonly kind: 'UNEXPECTED_MESSAGE';
  readonly line: string;
}

export interface BotProcessOptions {
  readonly executable: string; // passed to spawn as-is, never through a shell
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>; // default: minimal env (PATH only) — never inherit secrets blindly
  readonly validator: ProtocolValidator; // from @ott/bot-protocol compileProtocolValidator(schema)
  readonly maxMessageBytes: number;
  readonly startupTimeoutMs?: number; // default: 5000 ms (protocol §3 baseline)
  readonly maxStderrBytes?: number; // default: 1048576 bytes (1 MB, protocol §3 baseline)
  readonly stopGraceMs?: number; // default: 500 ms
  readonly now?: () => number; // monotonic clock source; default: performance.now
  readonly onStderr?: (chunk: Uint8Array) => void; // diagnostics sink; never parsed as protocol
  readonly onDiagnostic?: (diagnostic: BotProcessDiagnostic) => void;
}

export interface BotProcessDebugHandles {
  readonly childListeners: number;
  readonly stdinListeners: number;
  readonly stdoutListeners: number;
  readonly stderrListeners: number;
  readonly activeTimers: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export class BotProcess implements BotPort {
  private readonly options: BotProcessOptions;
  private readonly lineBuffer: LineBuffer;
  private readonly startupTimeoutMs: number;
  private readonly maxStderrBytes: number;
  private readonly stopGraceMs: number;
  private readonly now: () => number;

  private child: ChildProcess | null = null;
  private phase: 'unstarted' | ProcessPhase = 'unstarted';
  private _fault: ProcessFaultCode | null = null;
  private pendingRequest: {
    readonly turnId: number;
    readonly resolve: (reply: BotReply) => void;
    settled: boolean;
  } | null = null;

  private turnTimer: NodeJS.Timeout | null = null;
  private readonly activeTimers = new Set<NodeJS.Timeout>();
  private readonly timedOutTurnIds = new Set<number>();

  private _unexpectedLines = 0;
  private _stderrBytes = 0;
  private forwardedStderrBytes = 0;
  private hasExited = false;
  private stopPromise: Promise<void> | null = null;

  constructor(options: BotProcessOptions) {
    this.options = options;
    this.lineBuffer = new LineBuffer({ maxLineBytes: options.maxMessageBytes });
    this.startupTimeoutMs = options.startupTimeoutMs ?? 5000;
    this.maxStderrBytes = options.maxStderrBytes ?? 1048576;
    this.stopGraceMs = options.stopGraceMs ?? 500;
    this.now = options.now ?? (() => performance.now());
  }

  get fault(): ProcessFaultCode | null {
    return this._fault;
  }

  get unexpectedLines(): number {
    return this._unexpectedLines;
  }

  get stderrBytes(): number {
    return this._stderrBytes;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Diagnostic helper for testing: reports listener counts and active timers.
   */
  public debugHandles(): BotProcessDebugHandles {
    const childListeners = this.child
      ? this.child.eventNames().reduce((sum, ev) => sum + this.child!.listenerCount(ev), 0)
      : 0;
    const stdinListeners = this.child?.stdin
      ? this.child.stdin.eventNames().reduce((sum, ev) => sum + this.child!.stdin!.listenerCount(ev), 0)
      : 0;
    const stdoutListeners = this.child?.stdout
      ? this.child.stdout.eventNames().reduce((sum, ev) => sum + this.child!.stdout!.listenerCount(ev), 0)
      : 0;
    const stderrListeners = this.child?.stderr
      ? this.child.stderr.eventNames().reduce((sum, ev) => sum + this.child!.stderr!.listenerCount(ev), 0)
      : 0;

    return {
      childListeners,
      stdinListeners,
      stdoutListeners,
      stderrListeners,
      activeTimers: this.activeTimers.size,
    };
  }

  public async start(init: InitMessage): Promise<BotStartResult> {
    if (this.child || this.phase !== 'unstarted') {
      if (this._fault) {
        return { ok: false, code: this._fault };
      }
      throw new Error('BotProcess has already been started');
    }

    if (this._fault) {
      return { ok: false, code: this._fault };
    }

    this.phase = 'starting';

    const env = this.options.env
      ? { ...this.options.env }
      : process.env.PATH
        ? { PATH: process.env.PATH }
        : {};

    let child: ChildProcess;
    try {
      child = spawn(this.options.executable, [...this.options.args], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.cwd,
        env,
      });
    } catch {
      this.setFault('BOT_SPAWN_FAILED');
      return { ok: false, code: 'BOT_SPAWN_FAILED' };
    }

    this.child = child;

    return new Promise<BotStartResult>((resolve) => {
      let settled = false;

      const settleStart = (result: BotStartResult) => {
        if (settled) return;
        settled = true;
        this.clearTrackedTimeout(startupTimer);

        if (!result.ok) {
          this.setFault(result.code);
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        } else {
          this.phase = 'running';
        }
        resolve(result);
      };

      const startupTimer = this.setTrackedTimeout(() => {
        settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
      }, this.startupTimeoutMs);

      child.stdin?.on('error', (_err) => {
        if (this.phase === 'starting') {
          settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
        } else if (this.phase === 'running') {
          this.recordExitOrStreamEnd();
        }
      });

      child.on('error', (_err) => {
        const currentPhase: ProcessPhase = this.phase === 'unstarted' ? 'starting' : this.phase;
        const fault = classifyExit({ phase: currentPhase });
        if (fault) {
          this.setFault(fault);
        }
        if (currentPhase === 'starting') {
          settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
        } else {
          this.settlePendingRequest({ ok: false, code: this._fault ?? 'BOT_CRASHED' });
        }
      });

      child.on('exit', (code, signal) => {
        this.hasExited = true;
        const currentPhase: ProcessPhase = this.phase === 'unstarted' ? 'starting' : this.phase;
        const fault = classifyExit({ code, signal, phase: currentPhase });
        if (fault) {
          this.setFault(fault);
        }
        if (currentPhase === 'starting') {
          settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
        } else if (currentPhase === 'stopping') {
          this.settlePendingRequest({ ok: false, code: this._fault ?? 'BOT_EOF' });
        } else {
          this.settlePendingRequest({ ok: false, code: this._fault ?? 'BOT_CRASHED' });
        }
      });

      child.on('close', (code, signal) => {
        this.hasExited = true;
        const currentPhase: ProcessPhase = this.phase === 'unstarted' ? 'starting' : this.phase;
        const fault = classifyExit({ code, signal, phase: currentPhase });
        if (fault) {
          this.setFault(fault);
        }
        if (currentPhase === 'starting') {
          settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
        } else if (currentPhase === 'stopping') {
          this.settlePendingRequest({ ok: false, code: this._fault ?? 'BOT_EOF' });
        } else {
          this.settlePendingRequest({ ok: false, code: this._fault ?? 'BOT_CRASHED' });
        }
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        const events = this.lineBuffer.push(chunk);
        for (const event of events) {
          this.onLineEvent(event);
        }
      });

      child.stdout?.on('end', () => {
        this.lineBuffer.flushOnEnd();
        if (this.phase === 'running') {
          this.recordExitOrStreamEnd();
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.handleStderrChunk(chunk);
      });

      this.writePayload(init)
        .then(() => {
          this.setTrackedTimeout(() => {
            if (child.exitCode !== null || child.signalCode !== null || this.hasExited) {
              settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
            } else {
              settleStart({ ok: true });
            }
          }, 25);
        })
        .catch(() => {
          settleStart({ ok: false, code: 'BOT_SPAWN_FAILED' });
        });
    });
  }

  public async requestAction(update: StateUpdateMessage, timeoutMs: number): Promise<BotReply> {
    if (this._fault) {
      return { ok: false, code: this._fault };
    }

    if (this.pendingRequest) {
      throw new Error('A request is already pending');
    }

    if (!this.child || this.hasExited || this.phase === 'stopping') {
      const exitFault = this.deriveExitFault();
      this.setFault(exitFault);
      return { ok: false, code: this._fault ?? exitFault };
    }

    // Step 1: Write STATE_UPDATE
    try {
      await this.writePayload(update);
    } catch {
      const exitFault = this.deriveExitFault();
      this.setFault(exitFault);
      return { ok: false, code: this._fault ?? exitFault };
    }

    if (this._fault) {
      return { ok: false, code: this._fault };
    }

    if (this.hasExited || (this.phase as ProcessPhase) === 'stopping') {
      const exitFault = this.deriveExitFault();
      this.setFault(exitFault);
      return { ok: false, code: this._fault ?? exitFault };
    }

    // Step 2: AFTER the write callback completes, calculate deadline from now() and arm turn timer
    const turnId = update.turnId;

    return new Promise<BotReply>((resolve) => {
      this.pendingRequest = {
        turnId,
        resolve,
        settled: false,
      };

      const startMonotonic = this.now();
      const deadline = startMonotonic + timeoutMs;
      const remainingMs = Math.max(0, deadline - this.now());

      this.turnTimer = this.setTrackedTimeout(() => {
        this.turnTimer = null;
        this.timedOutTurnIds.add(turnId);
        this.settlePendingRequest({ ok: false, code: 'BOT_TIMEOUT' });
      }, remainingMs);
    });
  }

  public async notifyStateUpdate(update: StateUpdateMessage): Promise<void> {
    if (this._fault || this.hasExited || this.phase === 'stopping') {
      return;
    }
    try {
      await this.writePayload(update);
    } catch {
      this.setFault(this.deriveExitFault());
    }
  }

  public async sendTurnResult(message: TurnResultMessage): Promise<void> {
    if (this._fault || this.hasExited || this.phase === 'stopping') {
      return;
    }
    try {
      await this.writePayload(message);
    } catch {
      this.setFault(this.deriveExitFault());
    }
  }

  public async finish(message: MatchResultMessage): Promise<void> {
    if (this._fault || this.hasExited || this.phase === 'stopping') {
      return;
    }
    try {
      await this.writePayload(message);
    } catch {
      this.setFault(this.deriveExitFault());
    }
  }

  public stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.doStop();
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    this.phase = 'stopping';

    // Settle pending request with BOT_EOF abort
    this.settlePendingRequest({ ok: false, code: this._fault ?? 'BOT_EOF' });

    this.lineBuffer.flushOnEnd();

    const child = this.child;
    if (!child || this.hasExited) {
      this.cleanupHandles();
      return;
    }

    // Progressive stop sequence: stdin EOF -> stopGraceMs -> SIGTERM -> stopGraceMs -> SIGKILL
    await new Promise<void>((resolve) => {
      let done = false;
      let graceTimer: NodeJS.Timeout | null = null;
      let termTimer: NodeJS.Timeout | null = null;

      const finish = () => {
        if (done) return;
        done = true;
        if (graceTimer) this.clearTrackedTimeout(graceTimer);
        if (termTimer) this.clearTrackedTimeout(termTimer);
        this.hasExited = true;
        resolve();
      };

      child.once('exit', finish);
      child.once('close', finish);

      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end();
        }
      } catch {
        // ignore
      }

      graceTimer = this.setTrackedTimeout(() => {
        graceTimer = null;
        if (done || this.hasExited) return;

        try {
          child.kill('SIGTERM');
        } catch {
          finish();
          return;
        }

        termTimer = this.setTrackedTimeout(() => {
          termTimer = null;
          if (done || this.hasExited) return;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, this.stopGraceMs);
      }, this.stopGraceMs);
    });

    this.cleanupHandles();
  }

  private setFault(code: ProcessFaultCode): void {
    if (this._fault === null) {
      this._fault = code;
    }
  }

  private deriveExitFault(): ProcessFaultCode {
    if (this.child) {
      if (this.child.signalCode !== null && this.child.signalCode !== undefined) {
        return 'BOT_CRASHED';
      }
      if (this.child.exitCode !== null && this.child.exitCode !== undefined && this.child.exitCode !== 0) {
        return 'BOT_CRASHED';
      }
    }
    return 'BOT_EOF';
  }

  private recordExitOrStreamEnd(): void {
    if (this.phase === 'stopping') {
      return;
    }
    // If the child already has exitCode or signal, classify immediately
    if (this.child && (this.child.exitCode !== null || this.child.signalCode !== null)) {
      const fault = classifyExit({
        code: this.child.exitCode,
        signal: this.child.signalCode,
        phase: this.phase === 'unstarted' ? 'starting' : this.phase,
      });
      if (fault) {
        this.setFault(fault);
        this.settlePendingRequest({ ok: false, code: this._fault ?? fault });
      }
      return;
    }

    // Wait a brief tick (25ms) for the child exit event to be delivered
    this.setTrackedTimeout(() => {
      if (this.phase === 'running' && !this._fault) {
        const fault = this.deriveExitFault();
        this.setFault(fault);
        this.settlePendingRequest({ ok: false, code: this._fault ?? fault });
      }
    }, 25);
  }

  private setTrackedTimeout(fn: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      fn();
    }, ms);
    this.activeTimers.add(timer);
    return timer;
  }

  private clearTrackedTimeout(timer: NodeJS.Timeout | null | undefined): void {
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(timer);
    }
  }

  private settlePendingRequest(reply: BotReply): boolean {
    if (!this.pendingRequest || this.pendingRequest.settled) {
      return false;
    }

    this.pendingRequest.settled = true;

    if (this.turnTimer) {
      this.clearTrackedTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    const resolve = this.pendingRequest.resolve;
    this.pendingRequest = null;
    resolve(reply);
    return true;
  }

  private onLineEvent(event: LineEvent): void {
    if (!this.pendingRequest) {
      this._unexpectedLines++;
      this.options.onDiagnostic?.({
        kind: 'UNEXPECTED_MESSAGE',
        line: event.kind === 'line' ? event.text : '<oversize>',
      });
      return;
    }

    const reply = this.handleLineEvent(event);

    // If it's a valid ACTION whose turnId already timed out, discard as unexpected and keep request open
    if (reply.ok && this.timedOutTurnIds.has(reply.message.turnId)) {
      this._unexpectedLines++;
      this.options.onDiagnostic?.({
        kind: 'UNEXPECTED_MESSAGE',
        line: event.kind === 'line' ? event.text : '<oversize>',
      });
      return;
    }

    this.settlePendingRequest(reply);
  }

  private handleStderrChunk(chunk: Buffer): void {
    const byteLength = chunk.byteLength;
    this._stderrBytes += byteLength;

    if (this.options.onStderr && this.forwardedStderrBytes < this.maxStderrBytes) {
      const allowed = Math.min(byteLength, this.maxStderrBytes - this.forwardedStderrBytes);
      if (allowed > 0) {
        this.forwardedStderrBytes += allowed;
        this.options.onStderr(new Uint8Array(chunk.buffer, chunk.byteOffset, allowed));
      }
    }

    if (this._stderrBytes > this.maxStderrBytes) {
      this.setFault('STDERR_LIMIT_EXCEEDED');
      this.settlePendingRequest({ ok: false, code: 'STDERR_LIMIT_EXCEEDED' });
      try {
        this.child?.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }

  private cleanupHandles(): void {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.turnTimer = null;

    if (this.child) {
      this.child.removeAllListeners();
      if (this.child.stdin) {
        this.child.stdin.removeAllListeners();
        this.child.stdin.destroy();
      }
      if (this.child.stdout) {
        this.child.stdout.removeAllListeners();
        this.child.stdout.destroy();
      }
      if (this.child.stderr) {
        this.child.stderr.removeAllListeners();
        this.child.stderr.destroy();
      }
    }
  }

  private writePayload(message: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.child || !this.child.stdin || this.child.stdin.destroyed || !this.child.stdin.writable) {
        return reject(new Error('Cannot write: stdin is not writable'));
      }
      const payload = JSON.stringify(message) + '\n';
      this.child.stdin.write(payload, 'utf-8', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private handleLineEvent(event: LineEvent): BotReply {
    if (event.kind === 'oversize') {
      return { ok: false, code: 'MESSAGE_TOO_LARGE' };
    }

    if (utf8ByteLength(event.text) > this.options.maxMessageBytes) {
      return { ok: false, code: 'MESSAGE_TOO_LARGE' };
    }

    let value: unknown;
    try {
      value = JSON.parse(event.text);
    } catch {
      return { ok: false, code: 'MALFORMED_JSON' };
    }

    if (!isPlainObject(value)) {
      return { ok: false, code: 'MALFORMED_JSON' };
    }

    if (!this.options.validator.isProtocolMessage(value)) {
      return { ok: false, code: 'SCHEMA_VIOLATION' };
    }

    const message = value as unknown as ProtocolMessage;
    if (message.type !== 'ACTION') {
      return { ok: false, code: 'SCHEMA_VIOLATION' };
    }

    return { ok: true, message: message as ActionMessage };
  }
}
