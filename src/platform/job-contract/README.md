# @ott/job-contract

Versioned, runtime-independent contract types shared by the Phase 2 control
plane and worker. `P2-T14` exports `validateOciSubmission`, a pure validator
for the OCI Image Layout v1 archive accepted from teams.

`P2-T09` adds `MatchJobV1` and `validateMatchJob`. The job is strict and
versioned; `idempotencyKey` equals the database `matchId`, and both sides carry
submission UUID plus archive, OCI manifest, OCI config and policy digests.
It intentionally has no registry tag, runtime command or user-supplied image
name. BullMQ and Redis clients stay in the API/worker runtime packages, not in
this shared contract.

It validates tar safety, OCI layout/digests/platform and derived entrypoint;
it never extracts, imports or executes an archive. See
[`docs/contracts/oci-submission-v1.md`](../../../docs/contracts/oci-submission-v1.md).

```bash
npm test --workspace @ott/job-contract -- oci-submission
npm run typecheck --workspace @ott/job-contract
```
