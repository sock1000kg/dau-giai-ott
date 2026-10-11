/**
 * Public entrypoint for @ott/game-core.
 *
 * Consumers import only from this module; internal files are not a public contract.
 *
 * - `types.ts`  — locked Engine API v1 domain/error types (P1-L02).
 * - `engine.ts` — behavior: createGame, listLegalActions, applyAction, skipTurn, forfeitGame, getGameResult.
 * - `hash.ts`   — canonical serialization + `hashGameState` (P1-L06).
 */
export * from './types.ts';
export * from './engine.ts';
export * from './hash.ts';
