import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import type { GameAction, GameState, PlayerSide } from '@ott/game-core';

import { BotProcess } from '../src/bot-process.ts';
import { runCli, type CliDeps } from '../src/cli.ts';
import {
  DEFAULT_MAP,
  DEFAULT_SCHEMA_PATH,
  parseCliArgs,
  type CliConfig,
} from '../src/config.ts';
import { CoreGameAdapter } from '../src/core-adapter.ts';
import { readEventLogFile } from '../src/event-log.ts';
import { FakeGame, ScriptedBot } from '../src/fakes.ts';
import { verifyReplay } from '../src/replay.ts';

const botDir = new URL('fixtures/bots/', import.meta.url);
const echoBotPath = fileURLToPath(new URL('echo-first-legal.mjs', botDir));
const silentBotPath = fileURLToPath(new URL('silent.mjs', botDir));

function createMemoryIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
        },
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe('P1-D08 CLI and Config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'ott-cli-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  describe('Config (pure, parseCliArgs)', () => {
    it('1. Minimal valid argv -> defaults filled', () => {
      const outPath = path.join(tempDir, 'out.json');
      const res = parseCliArgs([
        '--bot-x',
        'python3',
        '--bot-o',
        'python3',
        '--out',
        outPath,
      ]);

      expect(res.ok).toBe(true);
      if (!res.ok || 'help' in res) throw new Error('expected config');
      const config = res.config;

      expect(config.matchId).toBe('local-match');
      expect(config.seed).toBe('0');
      expect(config.outPath).toBe(outPath);
      expect(config.schemaPath).toBe(DEFAULT_SCHEMA_PATH);
      expect(config.game.gameId).toBe('local-match');
      expect(config.game.maxTurns).toBe(200);
      expect(config.game.engineVersion).toBe('1.0.0');
      expect(config.game.map).toEqual(DEFAULT_MAP);

      expect(config.limits.maxTurns).toBe(200);
      expect(config.limits.turnTimeoutMs).toBe(DEFAULT_LIMITS.turnTimeoutMs);
      expect(config.limits.startupTimeoutMs).toBe(DEFAULT_LIMITS.startupTimeoutMs);
      expect(config.limits.maxMessageBytes).toBe(DEFAULT_LIMITS.maxMessageBytes);
      expect(config.limits.maxStderrBytes).toBe(DEFAULT_LIMITS.maxStderrBytes);
      expect(config.limits.maxConsecutiveFaults).toBe(DEFAULT_LIMITS.maxConsecutiveFaults);
      expect(config.limits.maxTotalFaults).toBe(DEFAULT_LIMITS.maxTotalFaults);

      expect(config.bots.X).toEqual({ executable: 'python3', args: [] });
      expect(config.bots.O).toEqual({ executable: 'python3', args: [] });
    });

    it('2. --bot-x-arg repeated keeps order and preserves verbatim content', () => {
      const outPath = path.join(tempDir, 'out.json');
      const res = parseCliArgs([
        '--bot-x',
        'node',
        '--bot-o',
        'node',
        '--out',
        outPath,
        '--bot-x-arg',
        'first arg',
        '--bot-x-arg',
        ';rm -rf /',
        '--bot-x-arg',
        '$(whoami)',
        '--bot-x-arg',
        '"quoted string"',
        '--bot-o-arg',
        'arg for O',
      ]);

      expect(res.ok).toBe(true);
      if (!res.ok || 'help' in res) throw new Error('expected config');

      expect(res.config.bots.X.args).toEqual([
        'first arg',
        ';rm -rf /',
        '$(whoami)',
        '"quoted string"',
      ]);
      expect(res.config.bots.O.args).toEqual(['arg for O']);
    });

    it.each([
      ['missing --bot-x, --bot-o, --out', [], ['--bot-x', '--bot-o', '--out']],
      ['--max-turns 0', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--max-turns', '0'], ['--max-turns']],
      ['--max-turns -1', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--max-turns', '-1'], ['--max-turns']],
      ['--max-turns 1.5', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--max-turns', '1.5'], ['--max-turns']],
      ['--max-turns 1e3', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--max-turns', '1e3'], ['--max-turns']],
      ['--max-turns abc', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--max-turns', 'abc'], ['--max-turns']],
      ['bad --match-id pattern', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--match-id', '_bad'], ['--match-id']],
      ['bad --match-id 129 chars', ['--bot-x', 'x', '--bot-o', 'o', '--out', 'out', '--match-id', 'a'.repeat(129)], ['--match-id']],
      ['unknown flag', ['--unknown'], ['--unknown']],
    ])('3. Errors: %s', (_title, argv, expectedErrorSnippets) => {
      const res = parseCliArgs(argv);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected error');

      for (const snippet of expectedErrorSnippets) {
        expect(res.errors.some((err) => err.includes(snippet))).toBe(true);
      }
    });

    it('4. --help and -h -> help result', () => {
      const res1 = parseCliArgs(['--help']);
      expect(res1).toEqual({ ok: true, help: true });

      const res2 = parseCliArgs(['-h']);
      expect(res2).toEqual({ ok: true, help: true });
    });
  });

  describe('CLI (runCli)', () => {
    it('5. --help -> exit 0 and usage on stdout', async () => {
      const mem = createMemoryIo();
      const code = await runCli(['--help'], mem.io);

      expect(code).toBe(0);
      expect(mem.stdout).toContain('Usage:');
      expect(mem.stdout).toContain('game-core');
      expect(mem.stdout).toContain('Exit codes:');
      expect(mem.stderr).toBe('');
    });

    it('6. Usage error -> exit 2, stdout empty, stderr names every problem', async () => {
      const mem = createMemoryIo();
      const code = await runCli([], mem.io);

      expect(code).toBe(2);
      expect(mem.stdout).toBe('');
      expect(mem.stderr).toContain('--bot-x');
      expect(mem.stderr).toContain('--bot-o');
      expect(mem.stderr).toContain('--out');
      expect(mem.stderr).toContain('Run with --help');
    });

    it('7. Happy run: two echo-first-legal bots, --max-turns 4 -> exit 0, one line JSON, replay ok, PIDs dead', async () => {
      const outPath = path.join(tempDir, 'happy-match.json');
      const mem = createMemoryIo();

      const argv = [
        '--bot-x',
        process.execPath,
        '--bot-x-arg',
        echoBotPath,
        '--bot-o',
        process.execPath,
        '--bot-o-arg',
        echoBotPath,
        '--max-turns',
        '4',
        '--turn-timeout-ms',
        '1000',
        '--out',
        outPath,
      ];

      const spawnedBots: BotProcess[] = [];
      const code = await runCli(argv, mem.io, {
        createBot: (_side, opts) => {
          const bot = new BotProcess(opts);
          spawnedBots.push(bot);
          return bot;
        },
      });

      expect(code).toBe(0);

      // Stdout is exactly one line of JSON
      const stdoutLines = mem.stdout.trim().split('\n');
      expect(stdoutLines).toHaveLength(1);
      const firstLine = stdoutLines[0];
      expect(firstLine).toBeDefined();

      // Verify keys fixed order
      const expectedKeys = [
        'matchId',
        'winnerSide',
        'reason',
        'turnCount',
        'finalStateHash',
        'forfeitedSide',
        'faults',
        'eventLog',
      ];
      const parsedResult = JSON.parse(firstLine!);
      expect(Object.keys(parsedResult)).toEqual(expectedKeys);
      expect(parsedResult.eventLog).toBe(path.resolve(outPath));

      // Event log exists and replay passes
      expect(existsSync(outPath)).toBe(true);
      const log = await readEventLogFile(outPath);
      const replay = verifyReplay(log, new CoreGameAdapter());
      expect(replay.ok).toBe(true);

      // Result fields equal log footer
      expect(parsedResult.winnerSide).toBe(log.footer.result.winnerSide);
      expect(parsedResult.reason).toBe(log.footer.result.reason);
      expect(parsedResult.turnCount).toBe(log.footer.result.turnCount);
      expect(parsedResult.finalStateHash).toBe(log.footer.result.finalStateHash);
      expect(parsedResult.forfeitedSide).toBe(log.footer.result.forfeitedSide);
      expect(parsedResult.faults).toEqual(log.footer.faults);

      // Bot PIDs dead afterwards
      for (const bot of spawnedBots) {
        if (bot.pid) {
          let alive = true;
          try {
            process.kill(bot.pid, 0);
          } catch {
            alive = false;
          }
          expect(alive).toBe(false);
        }
      }
    });

    it('8. Bot faults are results, not CLI errors: silent bot forfeits, nonexistent executable forfeits', async () => {
      // 8a: silent bot forfeits
      const out1 = path.join(tempDir, 'silent.json');
      const mem1 = createMemoryIo();
      const code1 = await runCli(
        [
          '--bot-x',
          process.execPath,
          '--bot-x-arg',
          silentBotPath,
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--turn-timeout-ms',
          '50',
          '--out',
          out1,
        ],
        mem1.io,
      );

      expect(code1).toBe(0);
      const result1 = JSON.parse(mem1.stdout.trim());
      expect(result1.reason).toBe('FORFEIT');
      expect(result1.forfeitedSide).toBe('X');
      expect(result1.winnerSide).toBe('O');

      // 8b: nonexistent executable forfeits with BOT_SPAWN_FAILED
      const out2 = path.join(tempDir, 'spawn-failed.json');
      const mem2 = createMemoryIo();
      const code2 = await runCli(
        [
          '--bot-x',
          '/nonexistent/path/to/bot/binary',
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--out',
          out2,
        ],
        mem2.io,
      );

      expect(code2).toBe(0);
      const result2 = JSON.parse(mem2.stdout.trim());
      expect(result2.reason).toBe('FORFEIT');
      expect(result2.forfeitedSide).toBe('X');
      expect(result2.faults.X.lastErrorCode).toBe('BOT_SPAWN_FAILED');
    });

    it('9. argv delivered verbatim: fixture echoes argv on stderr with [bot X] prefix unchanged', async () => {
      const outPath = path.join(tempDir, 'verbatim-argv.json');
      const mem = createMemoryIo();

      const verbatimArgs = ['--echo-argv', 'has spaces', ';echo injected', '$(whoami)', '"quoted"'];

      const code = await runCli(
        [
          '--bot-x',
          process.execPath,
          '--bot-x-arg',
          echoBotPath,
          ...verbatimArgs.flatMap((a) => ['--bot-x-arg', a]),
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--max-turns',
          '2',
          '--out',
          outPath,
        ],
        mem.io,
      );

      expect(code).toBe(0);
      // Fixture echoes `ARGV:[...]` on stderr, forwarded with `[bot X] ` prefix
      expect(mem.stderr).toContain('[bot X] ARGV:');
      const argvMatch = mem.stderr.match(/\[bot X\] ARGV:(.+)/);
      expect(argvMatch).not.toBeNull();
      const rawArgv = argvMatch?.[1]?.trim();
      expect(rawArgv).toBeDefined();
      const receivedArgv = JSON.parse(rawArgv!) as string[];

      // Verify the verbatim args are intact
      expect(receivedArgv).toEqual(verbatimArgs);
    });

    it('10. stdout purity: stdout contains only the single result line (or usage for help)', async () => {
      const outPath = path.join(tempDir, 'purity.json');
      const mem = createMemoryIo();

      const code = await runCli(
        [
          '--bot-x',
          process.execPath,
          '--bot-x-arg',
          echoBotPath,
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--max-turns',
          '2',
          '--out',
          outPath,
        ],
        mem.io,
      );

      expect(code).toBe(0);
      const lines = mem.stdout.trim().split('\n');
      expect(lines).toHaveLength(1);
      const singleLine = lines[0];
      expect(singleLine).toBeDefined();
      expect(() => JSON.parse(singleLine!)).not.toThrow();

      // Human summary is on stderr, not stdout
      expect(mem.stderr).toContain('Match local-match completed');
      expect(mem.stdout).not.toContain('Match local-match completed');
    });

    it('11. Infrastructure failures -> exit 1, no stdout', async () => {
      // 11a: unreadable schema path
      const mem1 = createMemoryIo();
      const code1 = await runCli(
        [
          '--bot-x',
          process.execPath,
          '--bot-x-arg',
          echoBotPath,
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--schema',
          '/nonexistent/path/schema.json',
          '--out',
          path.join(tempDir, '11a.json'),
        ],
        mem1.io,
      );
      expect(code1).toBe(1);
      expect(mem1.stdout).toBe('');
      expect(mem1.stderr).toContain('schema');

      // 11b: --out in nonexistent directory (no file and no .partial left)
      const nonExistentDirOut = path.join(tempDir, 'no-such-dir', 'match.json');
      const mem2 = createMemoryIo();
      const code2 = await runCli(
        [
          '--bot-x',
          process.execPath,
          '--bot-x-arg',
          echoBotPath,
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--max-turns',
          '2',
          '--out',
          nonExistentDirOut,
        ],
        mem2.io,
      );
      expect(code2).toBe(1);
      expect(mem2.stdout).toBe('');
      expect(existsSync(nonExistentDirOut)).toBe(false);
      expect(existsSync(`${nonExistentDirOut}.partial`)).toBe(false);

      // 11c: injected createGame whose apply throws
      const mem3 = createMemoryIo();
      const throwingGame = new FakeGame();
      throwingGame.apply = () => {
        throw new Error('invariant broken in game engine');
      };

      const code3 = await runCli(
        [
          '--bot-x',
          process.execPath,
          '--bot-x-arg',
          echoBotPath,
          '--bot-o',
          process.execPath,
          '--bot-o-arg',
          echoBotPath,
          '--max-turns',
          '2',
          '--out',
          path.join(tempDir, '11c.json'),
        ],
        mem3.io,
        {
          createGame: () => throwingGame,
        },
      );
      expect(code3).toBe(1);
      expect(mem3.stdout).toBe('');
      expect(mem3.stderr).toContain('invariant broken');
    });

    it('12. Injection / no rules: injected createGame + ScriptedBot, source boundary checks', async () => {
      const outPath = path.join(tempDir, 'injected.json');
      const mem = createMemoryIo();

      const game = new FakeGame({
        finishAt: { turnCount: 2, winnerSide: 'X', reason: 'REACHED_GOAL' },
      });
      const botX = new ScriptedBot({
        replies: [{ kind: 'action', action: { pieceId: 'X1', to: { col: 1, row: 0 } } }],
      });
      const botO = new ScriptedBot({
        replies: [{ kind: 'action', action: { pieceId: 'O1', to: { col: 7, row: 8 } } }],
      });

      const code = await runCli(
        [
          '--bot-x',
          'unused-x',
          '--bot-o',
          'unused-o',
          '--max-turns',
          '10',
          '--out',
          outPath,
        ],
        mem.io,
        {
          createGame: () => game,
          createBot: (side) => (side === 'X' ? botX : botO),
        },
      );

      expect(code).toBe(0);
      const res = JSON.parse(mem.stdout.trim());
      expect(res.winnerSide).toBe('X');
      expect(res.reason).toBe('REACHED_GOAL');

      // Boundary check: cli.ts and config.ts must only import @ott/game-core via `import type`
      const cliSource = readFileSync(path.resolve(__dirname, '../src/cli.ts'), 'utf8');
      const configSource = readFileSync(path.resolve(__dirname, '../src/config.ts'), 'utf8');

      for (const [name, src] of [['cli.ts', cliSource], ['config.ts', configSource]] as const) {
        // no child_process
        expect(src).not.toMatch(/from\s+['"]node:child_process['"]/);
        expect(src).not.toMatch(/from\s+['"]child_process['"]/);

        // only import type from @ott/game-core
        const coreImports = src.match(/import\s+(?:type\s+)?([^;]+)\s+from\s+['"]@ott\/game-core['"]/g) ?? [];
        for (const imp of coreImports) {
          expect(imp.startsWith('import type')).toBe(true);
        }
      }

      // Dynamic import of cli.ts does not start a match
      const imported = await import('../src/cli.ts');
      expect(typeof imported.runCli).toBe('function');
    });

    it('13. Determinism: two runs with same args -> identical stdout except eventLog path, byte-identical log files', async () => {
      const dir1 = path.join(tempDir, 'det1');
      const dir2 = path.join(tempDir, 'det2');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      const out1 = path.join(dir1, 'match.json');
      const out2 = path.join(dir2, 'match.json');

      const mem1 = createMemoryIo();
      const mem2 = createMemoryIo();

      const argvBase = [
        '--bot-x',
        process.execPath,
        '--bot-x-arg',
        echoBotPath,
        '--bot-o',
        process.execPath,
        '--bot-o-arg',
        echoBotPath,
        '--max-turns',
        '4',
        '--seed',
        '42',
      ];

      const code1 = await runCli([...argvBase, '--out', out1], mem1.io);
      const code2 = await runCli([...argvBase, '--out', out2], mem2.io);

      expect(code1).toBe(0);
      expect(code2).toBe(0);

      const res1 = JSON.parse(mem1.stdout.trim());
      const res2 = JSON.parse(mem2.stdout.trim());

      // Normalize eventLog paths before comparison
      const normalized1 = { ...res1, eventLog: '<normalized>' };
      const normalized2 = { ...res2, eventLog: '<normalized>' };
      expect(normalized1).toEqual(normalized2);

      // Byte-identical event-log files
      const bytes1 = readFileSync(out1);
      const bytes2 = readFileSync(out2);
      expect(bytes1.equals(bytes2)).toBe(true);
    });
  });
});
