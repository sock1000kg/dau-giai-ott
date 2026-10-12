import { describe, expect, it } from 'vitest';

import { validateMatchJob } from '../src/index.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const job = {
  schemaVersion: 'ott.match-job.v1',
  matchId: '0f54d8cb-85ee-4a6e-a63c-cace24e58120',
  idempotencyKey: '0f54d8cb-85ee-4a6e-a63c-cace24e58120',
  policyVersion: 'P2_BASELINE_V1',
  x: { submissionId: '82185759-bbdb-4115-b04f-8e6050fd3561', archiveSha256: digest, manifestDigest: digest, configDigest: digest, policyVersion: 'P2_BASELINE_V1' },
  o: { submissionId: 'dc1db9c5-79b8-4d00-bc67-9d8da97d4538', archiveSha256: digest, manifestDigest: digest, configDigest: digest, policyVersion: 'P2_BASELINE_V1' },
};

describe('MatchJobV1 contract', () => {
  it('accepts versioned match and immutable pinned OCI identities', () => {
    expect(validateMatchJob(job)).toEqual({ ok: true, value: job });
  });

  it('rejects mutable tags, commands, and unknown fields', () => {
    expect(validateMatchJob({ ...job, x: { ...job.x, tag: 'latest' } })).toEqual({ ok: false, code: 'MATCH_JOB_INVALID' });
    expect(validateMatchJob({ ...job, command: ['python', 'main.py'] })).toEqual({ ok: false, code: 'MATCH_JOB_INVALID' });
  });

  it('rejects mismatched idempotency key or policy pin', () => {
    expect(validateMatchJob({ ...job, idempotencyKey: 'another-match' })).toEqual({ ok: false, code: 'MATCH_JOB_INVALID' });
    expect(validateMatchJob({ ...job, policyVersion: 'P2_NEXT', x: { ...job.x, policyVersion: 'P2_BASELINE_V1' } })).toEqual({ ok: false, code: 'MATCH_JOB_INVALID' });
  });
});
