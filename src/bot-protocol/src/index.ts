/**
 * Public entrypoint for @ott/bot-protocol.
 * Consumers import only from this module.
 *
 * - `errors.ts`   — error-code unions and constant lists (P1-L03).
 * - `messages.ts` — locked message and state types (P1-L03).
 * - `validate.ts` — runtime validator against the canonical JSON Schema (P1-L04).
 */
export * from './errors.ts';
export * from './messages.ts';
export * from './validate.ts';
