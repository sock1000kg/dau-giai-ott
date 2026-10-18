import { createHash } from 'node:crypto';
import type { Database, ObjectStorage } from '@ott/platform-api';
import { CoreGameAdapter, serializeEventLog, verifyReplay, type AnyEventLog, type MatchReport } from '@ott/match-runner';
import { persistFinalizedResult, type ClaimedMatch } from './result-repository.ts';

export interface FinalizeMatchResultOptions {
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly claim: ClaimedMatch;
  readonly report: MatchReport<AnyEventLog>;
}

/** Verify the canonical replay, persist its content-addressed bytes, then atomically publish result/events/outbox. */
export async function finalizeMatchResult(options: FinalizeMatchResultOptions): Promise<{
  readonly alreadyFinalized: boolean;
  readonly eventLogKey: string;
  readonly eventLogSha256: string;
}> {
  const replay = verifyReplay(options.report.log, new CoreGameAdapter());
  if (!replay.ok || replay.result.finalStateHash !== options.report.result.finalStateHash) {
    throw new Error('MATCH_EVENT_LOG_INTEGRITY_FAILED');
  }

  const bytes = Buffer.from(serializeEventLog(options.report.log), 'utf8');
  const eventLogSha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const eventLogKey = `match-results/${options.claim.config.matchId}/event-log/${eventLogSha256}.json`;
  await options.storage.put(eventLogKey, bytes);
  const persisted = await persistFinalizedResult(options.database, {
    claim: options.claim,
    result: options.report.result,
    events: options.report.events,
    eventLogKey,
    eventLogSha256,
    faults: options.report.faults,
  });
  return { ...persisted, eventLogKey, eventLogSha256 };
}
