/**
 * Public entrypoint for @ott/match-runner (P1-D02 ports + fakes, P1-D03 MatchRunner).
 * Consumers import only from this module; internal files are not a public contract.
 *
 * - `ports.ts`  — GamePort/BotPort boundary over Engine API v1 and Bot Protocol v1.
 * - `fakes.ts`  — deterministic in-memory doubles (FakeGame, ScriptedBot).
 * - `types.ts`  — MatchConfig/MatchPorts/MatchReport and MatchRunnerErrorCode (P1-D03).
 * - `match-runner.ts` — the turn loop `runMatch`, with the P1-D04 fault policy.
 * - `errors.ts` — MatchRunnerError and the pure fault-counter helpers (P1-D04).
 * - `event-log.ts` — match event log format, serializer, parser, atomic file writer (P1-D07).
 * - `timing-policy.ts` — pure Bot Protocol v2 chess-clock policy (P3-L02).
 * - `replay.ts` — pure in-memory replay verifier over GamePort (P1-D07).
 *
 * - `line-buffer.ts` — pure NDJSON line buffer with byte limit (P1-D05).
 * - `process-errors.ts` — process exit and error classifier (P1-D06).
 * - `bot-process.ts` — child process BotPort adapter (P1-D05, P1-D06).
 * - `config.ts` — pure argv parser and CLI configuration validator (P1-D08).
 * - `core-adapter.ts` — real game-core GamePort adapter (P1-D09).
 * - `cli.ts` — local match composition root and CLI runner (P1-D08/P1-D09).
 *
 * Boundary: this module contains no game rules and spawns no processes directly;
 * the CLI injects ports and delegates rules exclusively to the game-core adapter.
 */
export * from './ports.ts';
export * from './fakes.ts';
export * from './types.ts';
export * from './match-runner.ts';
export * from './errors.ts';
export * from './event-log.ts';
export * from './replay.ts';
export * from './line-buffer.ts';
export * from './process-errors.ts';
export * from './bot-process.ts';
export * from './core-adapter.ts';
export * from './config.ts';
export * from './cli.ts';
export * from './timing-policy.ts';
