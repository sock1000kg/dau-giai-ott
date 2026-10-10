/**
 * Public entrypoint for @ott/match-runner (P1-D02).
 * Consumers import only from this module; internal files are not a public contract.
 *
 * - `ports.ts`  — GamePort/BotPort boundary over Engine API v1 and Bot Protocol v1.
 * - `fakes.ts`  — deterministic in-memory doubles (FakeGame, ScriptedBot).
 *
 * Boundary: this module contains no game rules and spawns no processes; the fakes
 * script lifecycle bookkeeping only and never copy the engine's behavior.
 */
export * from './ports.ts';
export * from './fakes.ts';
