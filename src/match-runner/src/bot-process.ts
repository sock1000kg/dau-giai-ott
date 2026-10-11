/**
 * BotProcess NDJSON adapter (P1-D05).
 *
 * Implements BotPort for a child process communicating over stdin/stdout via NDJSON:
 * - Spawns executable by argv directly with `shell: false` (no shell string execution).
 * - Transport framing and byte limit enforced by pure LineBuffer.
 * - Parses and schema-validates incoming lines in the request window; lines outside the
 *   window are discarded and logged/counted as unexpected.
 * - Stderr is kept completely separate from protocol streams.
 * - Adapter does NOT check matchId, turnId, or action legality; the runner (D04) checks them.
 *
 * Timeout, crash handling, and exit lifecycle are refined in P1-D06.
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

import { LineBuffer, type LineEvent } from './line-buffer.ts';
import type { BotPort, BotReply, BotStartResult } from './ports.ts';

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
  readonly onStderr?: (chunk: Uint8Array) => void; // diagnostics sink; never parsed as protocol
  readonly onDiagnostic?: (diagnostic: BotProcessDiagnostic) => void;
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
  private child: ChildProcess | null = null;
  private pendingRequest: ((reply: BotReply) => void) | null = null;
  private _unexpectedLines = 0;
  private _stderrBytes = 0;
  private stopped = false;
  private hasExited = false;

  constructor(options: BotProcessOptions) {
    this.options = options;
    this.lineBuffer = new LineBuffer({ maxLineBytes: options.maxMessageBytes });
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

  public async start(init: InitMessage): Promise<BotStartResult> {
    if (this.child) {
      throw new Error('BotProcess has already been started');
    }

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
      return { ok: false, code: 'BOT_SPAWN_FAILED' };
    }

    this.child = child;

    return new Promise<BotStartResult>((resolve) => {
      let settled = false;

      const handleSpawnFailure = () => {
        if (!settled) {
          settled = true;
          this.hasExited = true;
          resolve({ ok: false, code: 'BOT_SPAWN_FAILED' });
        }
      };

      child.once('error', handleSpawnFailure);

      child.on('error', (_err) => {
        this.hasExited = true;
        if (this.pendingRequest) {
          const resolver = this.pendingRequest;
          this.pendingRequest = null;
          resolver({ ok: false, code: 'BOT_EOF' }); // P1-D06: refine
        }
      });

      child.on('exit', (_code, _signal) => {
        this.hasExited = true;
        if (!settled) {
          handleSpawnFailure();
        }
        if (this.pendingRequest) {
          const resolver = this.pendingRequest;
          this.pendingRequest = null;
          resolver({ ok: false, code: 'BOT_EOF' }); // P1-D06: refine
        }
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        const events = this.lineBuffer.push(chunk);
        for (const event of events) {
          if (this.pendingRequest) {
            const resolver = this.pendingRequest;
            this.pendingRequest = null;
            resolver(this.handleLineEvent(event));
          } else {
            this._unexpectedLines++;
            this.options.onDiagnostic?.({
              kind: 'UNEXPECTED_MESSAGE',
              line: event.kind === 'line' ? event.text : '<oversize>',
            });
          }
        }
      });

      child.stdout?.on('end', () => {
        this.lineBuffer.flushOnEnd();
        if (this.pendingRequest) {
          const resolver = this.pendingRequest;
          this.pendingRequest = null;
          resolver({ ok: false, code: 'BOT_EOF' }); // P1-D06: refine
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this._stderrBytes += chunk.byteLength;
        if (this.options.onStderr) {
          this.options.onStderr(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        }
      });

      this.writeMessage(init)
        .then(() => {
          if (!settled) {
            settled = true;
            child.removeListener('error', handleSpawnFailure);
            resolve({ ok: true });
          }
        })
        .catch(() => {
          handleSpawnFailure();
        });
    });
  }

  public async requestAction(update: StateUpdateMessage, timeoutMs: number): Promise<BotReply> {
    // timeoutMs accepted and ignored in D05: // P1-D06: refine
    void timeoutMs;

    if (this.pendingRequest) {
      throw new Error('A request is already pending');
    }

    if (!this.child || this.hasExited) {
      return { ok: false, code: 'BOT_EOF' }; // P1-D06: refine
    }

    try {
      await this.writeMessage(update);
    } catch {
      return { ok: false, code: 'BOT_EOF' }; // P1-D06: refine
    }

    if (this.hasExited) {
      return { ok: false, code: 'BOT_EOF' }; // P1-D06: refine
    }

    return new Promise<BotReply>((resolve) => {
      this.pendingRequest = resolve;
    });
  }

  public async notifyStateUpdate(update: StateUpdateMessage): Promise<void> {
    await this.writeMessage(update);
  }

  public async sendTurnResult(message: TurnResultMessage): Promise<void> {
    await this.writeMessage(message);
  }

  public async finish(message: MatchResultMessage): Promise<void> {
    await this.writeMessage(message);
  }

  public async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    if (this.pendingRequest) {
      const resolver = this.pendingRequest;
      this.pendingRequest = null;
      resolver({ ok: false, code: 'BOT_EOF' }); // P1-D06: refine
    }

    this.lineBuffer.flushOnEnd();

    if (!this.child || this.hasExited) {
      return;
    }

    const child = this.child;
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
    } catch {
      // Ignore errors ending stdin
    }

    if (!this.hasExited) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            this.hasExited = true;
            resolve();
          }
        };

        child.once('exit', done);
        child.once('close', done);

        try {
          child.kill('SIGTERM');
        } catch {
          done();
        }

        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore
          }
          done();
        }, 500);
        timer.unref?.();
      });
    }
  }

  private writeMessage(message: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
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
