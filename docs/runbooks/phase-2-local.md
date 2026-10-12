# Runbook — Phase 2 local application and sandbox

## Prerequisites

- Follow [local services](local-services.md) for PostgreSQL, Redis and SeaweedFS.
- Node.js 22, npm workspaces and a local Docker Engine accessible to the worker.
- Do not expose the Docker socket to bot containers or browser-facing services.

## Sandbox corpus and quota qualification

Build trusted local canaries and run the sandbox integration test:

```bash
npm --workspace @ott/sandbox-corpus run build:corpus
npm --workspace @ott/sandbox-corpus test
npm test --workspace @ott/platform-worker -- --run tests/sandbox.integration.test.ts
```

To record startup, first-action and Docker quota samples, set
`OTT_SANDBOX_BENCHMARK_REPORT` to the version-controlled report path before the
worker test. The checked-in single-host result and gate decision are documented
in [the OCI sandbox SAD](../architecture/sad-oci-bot-submissions.md).

`OTT_SANDBOX_V1` is an internal implementation baseline, not a published team
quota. Do not open team registration based on a single developer-machine run;
registration remains closed until repeated measurements on representative
hosts establish fairness/isolation and the tournament owner approves D-08.
