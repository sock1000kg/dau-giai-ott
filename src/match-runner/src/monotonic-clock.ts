import { performance } from 'node:perf_hooks';
import type { MonotonicClock } from './ports.ts';

/** Production clock for v2 composition roots; unaffected by wall-clock adjustments. */
export const monotonicClock: MonotonicClock = { nowMs: () => performance.now() };
