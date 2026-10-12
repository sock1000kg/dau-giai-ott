# @ott/job-contract

Versioned, runtime-independent contract types shared by the Phase 2 control
plane and worker. `P2-T14` exports `validateOciSubmission`, a pure validator
for the OCI Image Layout v1 archive accepted from teams.

It validates tar safety, OCI layout/digests/platform and derived entrypoint;
it never extracts, imports or executes an archive. See
[`docs/contracts/oci-submission-v1.md`](../../../docs/contracts/oci-submission-v1.md).

```bash
npm test --workspace @ott/job-contract -- oci-submission
npm run typecheck --workspace @ott/job-contract
```
