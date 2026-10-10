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
 * - `replay.ts` — pure in-memory replay verifier over GamePort (P1-D07).
 *
 * Boundary: this module contains no game rules and spawns no processes; the fakes
 * script lifecycle bookkeeping only and never copy the engine's behavior.
 */
export * from './ports.ts';
export * from './fakes.ts';
export * from './types.ts';
export * from './match-runner.ts';
export * from './errors.ts';
export * from './event-log.ts';
export * from './replay.ts';
