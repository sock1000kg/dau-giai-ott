/**
 * Public entrypoint for @ott/game-core.
 *
 * Consumers import only from this module; internal files are not a public contract.
 *
 * - `types.ts`  — locked Engine API v1 domain/error types (P1-L02).
 * - `engine.ts` — behavior: baseline (P1-L01) + `createGame` (P1-L02).
 */
export * from './types.ts';
export * from './engine.ts';
