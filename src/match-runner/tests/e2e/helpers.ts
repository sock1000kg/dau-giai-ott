import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BotProcess } from '../../src/bot-process.ts';
import { runCli } from '../../src/cli.ts';
import { CoreGameAdapter } from '../../src/core-adapter.ts';
import { readEventLogFile, type EventLogV1 } from '../../src/event-log.ts';
import { verifyReplay } from '../../src/replay.ts';

const pythonDir = fileURLToPath(new URL('../../../bots/python/', import.meta.url));

export const PYTHON = 'python3';
export const firstLegalBot = path.join(pythonDir, 'first_legal_bot.py');
export const captureFirstBot = path.join(pythonDir, 'capture_first_bot.py');
export const invalidBot = path.join(pythonDir, 'invalid_bot.py');
export const processFaultBot = path.join(pythonDir, 'process_fault_bot.py');

export interface E2eBot {
  readonly script: string;
  readonly args?: readonly string[];
}

export interface E2eMatchOptions {
  readonly x: E2eBot;
  readonly o: E2eBot;
  readonly maxTurns?: number;
  readonly turnTimeoutMs?: number;
  readonly matchId?: string;
  readonly seed?: string;
}

export interface E2eMatch {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly result: Record<string, unknown>;
  readonly log: EventLogV1;
  readonly logText: string;
  readonly pids: readonly number[];
  readonly cleanup: () => void;
}

function createMemoryIo(): {
  readonly io: { readonly stdout: { write(chunk: string): void }; readonly stderr: { write(chunk: string): void } };
  readonly stdout: () => string;
  readonly stderr: () => string;
} {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function toBotArgs(bot: E2eBot): string[] {
  return ['-I', '-B', '-u', bot.script, ...(bot.args ?? [])];
}

/** Runs the production CLI with real Python processes and returns its parsed artifact. */
export async function runPythonMatch(options: E2eMatchOptions): Promise<E2eMatch> {
  const directory = mkdtempSync(path.join(tmpdir(), 'ott-e2e-'));
  const outPath = path.join(directory, 'match.json');
  const io = createMemoryIo();
  const bots: BotProcess[] = [];

  const code = await runCli(
    [
      '--bot-x', PYTHON,
      ...toBotArgs(options.x).flatMap((arg) => ['--bot-x-arg', arg]),
      '--bot-o', PYTHON,
      ...toBotArgs(options.o).flatMap((arg) => ['--bot-o-arg', arg]),
      '--max-turns', String(options.maxTurns ?? 4),
      '--turn-timeout-ms', String(options.turnTimeoutMs ?? 1_000),
      '--match-id', options.matchId ?? 'e2e-match',
      '--seed', options.seed ?? 'e2e-seed',
      '--out', outPath,
    ],
    io.io,
    {
      createBot: (_side, processOptions) => {
        const bot = new BotProcess(processOptions);
        bots.push(bot);
        return bot;
      },
    },
  );

  const stdout = io.stdout();
  if (code !== 0) {
    throw new Error(`CLI failed with ${code}: ${io.stderr()}`);
  }
  const result = JSON.parse(stdout) as Record<string, unknown>;
  const log = await readEventLogFile(outPath);
  const replay = verifyReplay(log, new CoreGameAdapter());
  if (!replay.ok) throw new Error(`Replay failed: ${replay.code}`);

  return {
    code,
    stdout,
    stderr: io.stderr(),
    result,
    log,
    logText: readFileSync(outPath, 'utf8'),
    pids: bots.flatMap((bot) => (bot.pid === undefined ? [] : [bot.pid])),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
