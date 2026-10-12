import { createHash } from 'node:crypto';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import type { MatchJobV1, OciArtifactReference } from '@ott/job-contract';
import type { BotPort } from '@ott/match-runner';
import { CoreGameAdapter, runMatch } from '@ott/match-runner';
import type { Database, ObjectStorage } from '@ott/platform-api';
import { validateMatchJob } from '@ott/job-contract';
import { SANDBOX_POLICY_V1 } from './sandbox/policy.ts';
import { SandboxOciBotPort } from './sandbox/oci-bot-port.ts';
import { claimMatch, markAttemptFailed, type ClaimedMatch } from './result-repository.ts';
import { finalizeMatchResult } from './finalize-result.ts';

const PLATFORM_POLICY_VERSION = 'P2_BASELINE_V1';

export interface MatchAttemptContext {
  readonly attemptNumber: number;
  readonly maxAttempts: number;
}

export interface RunMatchJobOptions {
  readonly job: MatchJobV1;
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly attempt?: MatchAttemptContext;
  readonly createBotPort?: (
    archive: Uint8Array,
    reference: OciArtifactReference,
    entrypoint: readonly string[],
  ) => BotPort | Promise<BotPort>;
}

export interface RunMatchJobResult {
  readonly alreadyFinalized: boolean;
  readonly outcome: import('@ott/game-core').GameResult;
  readonly eventLogKey?: string;
  readonly eventLogSha256?: string;
}

function executionReference(reference: OciArtifactReference, profileVersion: string): OciArtifactReference {
  if (profileVersion !== PLATFORM_POLICY_VERSION || reference.policyVersion !== profileVersion) {
    throw new Error('MATCH_POLICY_VERSION_UNSUPPORTED');
  }
  // The platform profile ID is the job/DB contract; the sandbox adapter pins its own implementation ID.
  return { ...reference, policyVersion: SANDBOX_POLICY_V1.version };
}

function archiveChecksum(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function readPinnedArchive(storage: ObjectStorage, submission: ClaimedMatch['submissions']['X']): Promise<Uint8Array> {
  const archive = await storage.get(submission.objectKey);
  if (archiveChecksum(archive) !== submission.reference.archiveSha256) throw new Error('SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH');
  return archive;
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
    ? error.message
    : 'MATCH_EXECUTION_FAILED';
}

function defaultBotPort(archive: Uint8Array, reference: OciArtifactReference, entrypoint: readonly string[]): BotPort {
  return new SandboxOciBotPort({ archive, reference, expectedEntrypoint: entrypoint });
}

/** Claims a database snapshot, runs the pinned artifacts through MatchRunner and finalizes exactly once. */
export async function runMatchJob(options: RunMatchJobOptions): Promise<RunMatchJobResult> {
  const validation = validateMatchJob(options.job);
  if (!validation.ok) throw new Error(validation.code);
  const claimResult = await claimMatch(options.database, validation.value);
  if (claimResult.kind === 'already-finalized') return { alreadyFinalized: true, outcome: claimResult.result };
  const claim = claimResult.value;
  const maxAttempts = options.attempt?.maxAttempts ?? 3;
  const attemptNumber = options.attempt?.attemptNumber ?? claim.attempt.attemptNumber;

  try {
    const [archiveX, archiveO] = await Promise.all([
      readPinnedArchive(options.storage, claim.submissions.X),
      readPinnedArchive(options.storage, claim.submissions.O),
    ]);
    const factory = options.createBotPort ?? defaultBotPort;
    const [botX, botO] = await Promise.all([
      factory(archiveX, executionReference(claim.submissions.X.reference, claim.config.policyVersion), claim.submissions.X.entrypoint),
      factory(archiveO, executionReference(claim.submissions.O.reference, claim.config.policyVersion), claim.submissions.O.entrypoint),
    ]);
    const report = await runMatch({
      matchId: claim.config.matchId,
      seed: claim.config.seed,
      game: claim.config.game,
      limits: { ...DEFAULT_LIMITS, maxTurns: claim.config.game.maxTurns, turnTimeoutMs: claim.config.turnTimeoutMs },
    }, { game: new CoreGameAdapter(), bots: { X: botX, O: botO } });
    const finalized = await finalizeMatchResult({ database: options.database, storage: options.storage, claim, report });
    return {
      alreadyFinalized: finalized.alreadyFinalized,
      outcome: report.result,
      eventLogKey: finalized.eventLogKey,
      eventLogSha256: finalized.eventLogSha256,
    };
  } catch (error) {
    const terminal = attemptNumber >= maxAttempts || errorCode(error) === 'MATCH_RESULT_CONFLICT';
    await markAttemptFailed(options.database, claim, errorCode(error), terminal).catch(() => undefined);
    throw error;
  }
}
