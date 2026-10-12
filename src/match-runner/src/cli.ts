/**
 * Composition root and local match runner CLI (P1-D08).
 *
 * Wires together configuration, protocol schema validation, BotProcess child processes,
 * the real game-core adapter, MatchRunner turn loop, and atomic event logging.
 *
 * Contracts:
 * - Exit codes: 0 (completed), 1 (infrastructure/runtime failure), 2 (usage/config error).
 * - stdout: Exactly one line containing the match result JSON on exit 0 (or usage on --help).
 * - stderr: Diagnostic messages, bot stderr ([bot X] / [bot O]), and human summary.
 * - Imports `@ott/game-core` for types only; contains no game rules and spawns no processes directly.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileProtocolValidator, type ProtocolValidator } from '@ott/bot-protocol';
import type { PlayerSide } from '@ott/game-core';

import { BotProcess, type BotProcessOptions } from './bot-process.ts';
import { parseCliArgs } from './config.ts';
import { writeEventLogFile, type EventLogV1 } from './event-log.ts';
import { CoreGameAdapter } from './core-adapter.ts';
import { runMatch } from './match-runner.ts';
import type { BotPort, GamePort } from './ports.ts';
import type { MatchReport } from './types.ts';

export interface CliIo {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

export interface CliDeps {
  readonly createGame: () => GamePort;
  readonly createBot: (side: PlayerSide, options: BotProcessOptions) => BotPort;
  readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
  readonly writeEventLog: (path: string, log: EventLogV1) => Promise<void>;
}

export function formatHelpText(): string {
  return [
    'Usage: run-match --bot-x <executable> --bot-o <executable> --out <path> [options]',
    '',
    'Run a local match between two bots using Bot Protocol v1.',
    'The CLI uses the locked game-core Phase 1 map and rules.',
    '',
    'Required options:',
    '  --bot-x <executable>        Executable command for bot X',
    '  --bot-o <executable>        Executable command for bot O',
    '  --out <path>                Destination path for event log JSON',
    '',
    'Options:',
    '  --bot-x-arg <arg>           Argument passed to bot X (repeatable, preserves order)',
    '  --bot-o-arg <arg>           Argument passed to bot O (repeatable, preserves order)',
    '  --match-id <id>             Match ID (default: "local-match", 1-128 chars)',
    '  --seed <s>                  INIT seed string (default: "0")',
    '  --max-turns <n>             Maximum turns before draw (default: 200, integer >= 1)',
    '  --turn-timeout-ms <n>       Per-turn response timeout in ms (default: 3000, integer >= 1)',
    '  --startup-timeout-ms <n>    Startup response timeout in ms (default: 5000, integer >= 1)',
    '  --schema <path>             Path to Bot Protocol JSON Schema',
    '  -h, --help                  Show this usage text and exit',
    '',
    'Exit codes:',
    '  0  Match completed with a valid result (including bot forfeits and faults)',
    '  1  Infrastructure or runtime error (unreadable schema, write failure, engine error)',
    '  2  Usage error or invalid configuration',
    '',
    'Output contract:',
    '  stdout: Exactly one line containing the match result JSON on exit 0',
    '  stderr: Diagnostic logs, bot stderr forwarded with [bot X]/[bot O] prefix, and summary',
    '',
    'Example:',
    '  npm --prefix src/match-runner run --silent match -- \\',
    '    --bot-x python3 --bot-x-arg -I --bot-x-arg -u --bot-x-arg "$PWD/src/bots/python/first_legal_bot.py" \\',
    '    --bot-o python3 --bot-o-arg -I --bot-o-arg -u --bot-o-arg "$PWD/src/bots/python/capture_first_bot.py" \\',
    '    --out /tmp/match.json',
    '',
  ].join('\n');
}

/**
 * Execute the MatchRunner CLI.
 *
 * Returns the exit code (0, 1, or 2). Never calls `process.exit()`.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  deps?: Partial<CliDeps>,
): Promise<number> {
  // 1. Parse arguments
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    for (const err of parsed.errors) {
      io.stderr.write(`error: ${err}\n`);
    }
    io.stderr.write('Run with --help for usage information.\n');
    return 2;
  }

  if ('help' in parsed) {
    io.stdout.write(formatHelpText());
    return 0;
  }

  const config = parsed.config;

  // 2. Read + JSON.parse schema, compileProtocolValidator
  const readFileFn = deps?.readFile ?? ((p, enc) => readFile(p, enc));
  let schemaContent: string;
  try {
    schemaContent = await readFileFn(config.schemaPath, 'utf8');
  } catch (err) {
    io.stderr.write(
      `error: failed to read schema file at "${config.schemaPath}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  let schemaJson: unknown;
  try {
    schemaJson = JSON.parse(schemaContent);
  } catch (err) {
    io.stderr.write(
      `error: failed to parse schema JSON at "${config.schemaPath}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  let validator: ProtocolValidator;
  try {
    validator = compileProtocolValidator(schemaJson);
  } catch (err) {
    io.stderr.write(
      `error: failed to compile schema validator: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 3. Create ports
  const createGame = deps?.createGame ?? (() => new CoreGameAdapter());
  const createBot = deps?.createBot ?? ((_side, options) => new BotProcess(options));

  function forwardStderr(side: PlayerSide, chunk: Uint8Array): void {
    const text = Buffer.from(chunk).toString('utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i === lines.length - 1 && lines[i] === '') continue;
      io.stderr.write(`[bot ${side}] ${lines[i]}\n`);
    }
  }

  const botXOptions: BotProcessOptions = {
    executable: config.bots.X.executable,
    args: config.bots.X.args,
    validator,
    maxMessageBytes: config.limits.maxMessageBytes,
    startupTimeoutMs: config.limits.startupTimeoutMs,
    maxStderrBytes: config.limits.maxStderrBytes,
    onStderr: (chunk) => forwardStderr('X', chunk),
    onDiagnostic: (diag) => {
      io.stderr.write(`[bot X] diagnostic: ${diag.kind} ${diag.line}\n`);
    },
  };

  const botOOptions: BotProcessOptions = {
    executable: config.bots.O.executable,
    args: config.bots.O.args,
    validator,
    maxMessageBytes: config.limits.maxMessageBytes,
    startupTimeoutMs: config.limits.startupTimeoutMs,
    maxStderrBytes: config.limits.maxStderrBytes,
    onStderr: (chunk) => forwardStderr('O', chunk),
    onDiagnostic: (diag) => {
      io.stderr.write(`[bot O] diagnostic: ${diag.kind} ${diag.line}\n`);
    },
  };

  const gamePort = createGame();
  const botX = createBot('X', botXOptions);
  const botO = createBot('O', botOOptions);

  // 4. Run match
  let report: MatchReport;
  try {
    report = await runMatch(
      {
        matchId: config.matchId,
        seed: config.seed,
        game: config.game,
        limits: config.limits,
      },
      {
        game: gamePort,
        bots: { X: botX, O: botO },
      },
    );
  } catch (err) {
    io.stderr.write(
      `error: match execution failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 5. Write event log file atomically
  const writeEventLog = deps?.writeEventLog ?? writeEventLogFile;
  try {
    await writeEventLog(config.outPath, report.log);
  } catch (err) {
    io.stderr.write(
      `error: failed to write event log to "${config.outPath}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 6. Print exactly one line JSON to stdout with fixed key order
  const resultJson = JSON.stringify({
    matchId: report.matchId,
    winnerSide: report.result.winnerSide,
    reason: report.result.reason,
    turnCount: report.result.turnCount,
    finalStateHash: report.result.finalStateHash,
    forfeitedSide: report.result.forfeitedSide,
    faults: {
      X: report.faults.X,
      O: report.faults.O,
    },
    eventLog: path.resolve(config.outPath),
  });

  io.stdout.write(`${resultJson}\n`);

  const winnerText = report.result.winnerSide ? `winner=${report.result.winnerSide}` : 'DRAW';
  io.stderr.write(
    `Match ${report.matchId} completed in ${report.result.turnCount} turns: ${winnerText} (${report.result.reason}). Event log: ${path.resolve(config.outPath)}\n`,
  );

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2), process);
}
