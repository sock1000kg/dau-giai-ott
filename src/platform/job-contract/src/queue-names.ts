/** Versioned BullMQ topic names shared by control and execution processes. */
export const MATCH_QUEUE_NAME = 'ott.match.v1';
export const DEAD_LETTER_QUEUE_NAME = 'ott.match.dead-letter.v1';

export const PREFLIGHT_QUEUE_NAME = 'ott.preflight.v1';
export const TEST_RUN_QUEUE_NAME = 'ott.test-run.v1';

/**
 * Strict priority order: official > preflight > test-run.
 * Lower number in BullMQ indicates higher priority (1 is highest).
 */
export const QUEUE_PRIORITY = {
  OFFICIAL: 1,
  PREFLIGHT: 2,
  TEST_RUN: 3,
} as const;

export type QueuePriority = (typeof QUEUE_PRIORITY)[keyof typeof QUEUE_PRIORITY];
export type JobQueueCategory = 'official' | 'preflight' | 'test-run';

export function priorityForCategory(category: JobQueueCategory): QueuePriority {
  switch (category) {
    case 'official':
      return QUEUE_PRIORITY.OFFICIAL;
    case 'preflight':
      return QUEUE_PRIORITY.PREFLIGHT;
    case 'test-run':
      return QUEUE_PRIORITY.TEST_RUN;
  }
}
