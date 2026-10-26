# GitNexus Engineering Plan

> Task: Repair and deploy durable demo finals data for the public OTT domain and the hourly-reset baseline.
> Evidence verified at commit `a9fb94058938ebe2eaf76c6f5aebfea0ee321db1`; GitNexus index refreshed this session with `--index-only --pdg` and runner schema 4/current.
> Evidence provenance schema 2; global dirty digest `0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd`; cited-path manifest 10 sorted entries; exact generated plan path excluded.

## Objective (§1)

Make `https://ott-frontend.d-thuand.party/finals` render the deterministic eight-team demo finals, and prevent any accepted/reset baseline from omitting the verified ResultBundle data required by that page. Preserve the public qualification data, credentials, and the isolation boundary between `ott-demo` and `ott-demo-reset`.

## Current Behaviour (§2–3)

- [verified] The web/API failure is data-driven: the public finals endpoint selects the newest `result_bundles.status = 'VERIFIED'`; the live public and reset databases currently contain zero result-bundle keys, bundles, and artifacts.
- [verified] `seedDemoFinalsBundle` already generates/loads a deterministic signed bundle, allowlists its public key, and imports its artifacts (`src/platform/api/src/demo/seed-finals-bundle.ts:52-103`); no new application API or schema is required.
- [verified] Snapshot creation records only teams/accounts/matches/replay-publication counts and therefore accepts a baseline with no ResultBundle (`scripts/demo-snapshot.sh:130-140`). Restore compares the same incomplete metric set (`scripts/demo-restore-snapshot.sh:198-210`).
- [verified] The cron installer trusts `demo-snapshot.sh verify` before restore (`scripts/install-demo-reset-cron.sh:80-85`), so strengthening bundle verification protects install, run-now, and scheduled execution.
- [verified] The reset stack is intentionally isolated and must not restore over public `ott-demo` (`docs/runbooks/demo-snapshot-reset.md:1-13`, `scripts/demo-restore-snapshot.sh:70-80`). Public data must be seeded independently.

## Findings (§4–5)

- [graph] `query("demo snapshot baseline finals result bundles restore seed")` found the existing finals seeder and ResultBundle flows; `context(seedDemoFinalsBundle)` found direct callers `seed-accounts.main` and `seed-finals-bundle.main`.
- [graph] `impact(seedDemoFinalsBundle, upstream)` is LOW with two direct callers. The plan uses the existing CLI and does not edit this symbol.
- [graph] `impact(scripts/demo-snapshot.sh, upstream)` and the restore script both returned `risk: UNKNOWN` because Bash calls were unresolved. Text verification found the actual chain: cron installer -> `demo.sh restore-demo` -> restore helper -> snapshot verifier.
- [graph] PDG was indexed, but GitNexus exposes no function symbols for these Bash helpers; control/data constraints below are source-verified rather than reconstructed as PDG edges.

## Proposed Changes (§6)

- `scripts/demo-snapshot.sh` (`verify_bundle`, `create_bundle`): add manifest/database metrics for active ResultBundle keys, VERIFIED bundles, and bundle artifacts; reject create/verify when any required finals count is zero.
- `scripts/demo-restore-snapshot.sh` (restore invariant and final readiness block): compare the added metrics after restore and require the anonymous finals snapshot endpoint to return success before reporting completion.
- `scripts/tests/demo-snapshot.test.sh`: add a red/green regression where an otherwise intact baseline with zero/missing finals metrics is rejected, while a complete manifest remains valid.
- `scripts/tests/demo-snapshot-restore.test.sh`: pin the restore contract to finals invariant/probe behavior without weakening public-mode and isolation guards.
- `docs/runbooks/demo-snapshot-reset.md` and `docs/validation/p2-t64/manifest.md`: document the new invariant and append non-secret remediation evidence. Do not change completed task/checkpoint status.

## Implementation Sequence (§7)

1. Add the failing shell regression for a checksum-valid baseline whose match/replay counts are present but ResultBundle counts are zero or absent; prove it fails on the pre-fix script.
2. Add finals counts and minimum checks to snapshot create/verify and restore, plus the post-start public-finals HTTP probe. Keep destructive restore ordering unchanged: verify before stop, compare DB before writers, HTTP probe after startup.
3. Run focused shell tests, syntax checks, typecheck, build, and the full repository test suite; update runbook/evidence wording; stage and run GitNexus `detect-changes --scope staged` before atomic commits.
4. Review, push, open/merge a PR into `main`, then deploy only from the merged `origin/main` commit.
5. On `jump-jits`, take a recovery backup, seed the existing deterministic finals bundle into public `ott-demo`, verify database counts plus `/api/v1/public/finals/snapshot`, replay and `/finals`; do not restart unrelated services unless the merged script release requires it.
6. Seed the isolated `ott-demo-reset` source state, create a new immutable baseline path (never overwrite the accepted baseline), verify it, update the root-only cron config to the new path, reinstall idempotently, and run one controlled `run-now` restore.
7. Verify the same finals bundle counts, public snapshot response, replay, health/readiness, team/BTC access boundaries, and one subsequent scheduled hourly cycle. Record only non-secret checksum/count/HTTP evidence.

## Test Strategy (§8)

- Red/green: checksum-valid manifest with `verifiedResultBundles=0` -> `demo-snapshot.sh verify` exits non-zero; complete positive counts -> success.
- Restore guard: missing/zero finals metrics fail before service shutdown; restored counts must equal manifest and remain positive.
- Runtime: seed command is idempotent; public and reset APIs return HTTP 200 with a proof-bearing finals snapshot; `/finals` renders eight teams and replay links before and after restore.
- Commands: `npm run demo:snapshot:test`; `bash -n scripts/demo-snapshot.sh scripts/demo-restore-snapshot.sh scripts/install-demo-reset-cron.sh`; `npm run typecheck`; `npm run build`; `npm test`; `git diff --check`.

## Implementation Context (§11)

```yaml
implementation_context:
  task_summary: "Repair and deploy durable demo finals data for public and reset stacks"
  acceptance_criteria:
    - "Public /api/v1/public/finals/snapshot and /finals succeed with the deterministic verified demo bundle"
    - "Snapshot create/verify/restore reject a baseline lacking key, VERIFIED bundle, or artifacts"
    - "New isolated baseline survives run-now and one scheduled restore cycle with finals data intact"
    - "Changes merge to main and deployment provenance, counts, health, routes, and non-secret evidence are recorded"
  evidence_provenance:
    schema_version: 2
    head_commit: "a9fb94058938ebe2eaf76c6f5aebfea0ee321db1"
    generated_plan_path: "docs/plans/2026-10-26-gitnexus-plan-finals-demo-data.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
    cited_path_manifest:
      - {path: "docs/runbooks/demo-snapshot-reset.md", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:8f24581c1988426e7273a13935201bdd2f4c8a696bebb4c268542c8f5eecc710", index_digest: "sha256:8f24581c1988426e7273a13935201bdd2f4c8a696bebb4c268542c8f5eecc710", worktree_digest: "sha256:8f24581c1988426e7273a13935201bdd2f4c8a696bebb4c268542c8f5eecc710", untracked_digest: absent}
      - {path: "docs/validation/p2-t64/manifest.md", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:6038ae0a9d19a703d59cb5eddacdb6dd22ccb10245451b5859fed091f88fdfc0", index_digest: "sha256:6038ae0a9d19a703d59cb5eddacdb6dd22ccb10245451b5859fed091f88fdfc0", worktree_digest: "sha256:6038ae0a9d19a703d59cb5eddacdb6dd22ccb10245451b5859fed091f88fdfc0", untracked_digest: absent}
      - {path: "package.json", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:2efe95ae5fefe6ee2204d174304a0a6d0538e1ef2ef19f8d1a00aa157904bdf2", index_digest: "sha256:2efe95ae5fefe6ee2204d174304a0a6d0538e1ef2ef19f8d1a00aa157904bdf2", worktree_digest: "sha256:2efe95ae5fefe6ee2204d174304a0a6d0538e1ef2ef19f8d1a00aa157904bdf2", untracked_digest: absent}
      - {path: "scripts/demo-restore-snapshot.sh", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:c7e88e01aa5c0d5c261638da3271139072149e06a23d7c203826520b198a209b", index_digest: "sha256:c7e88e01aa5c0d5c261638da3271139072149e06a23d7c203826520b198a209b", worktree_digest: "sha256:c7e88e01aa5c0d5c261638da3271139072149e06a23d7c203826520b198a209b", untracked_digest: absent}
      - {path: "scripts/demo-snapshot.sh", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:e56b652b77aba267a219e0254816defcdea94509a3e5f7a954ac1f7cf75523db", index_digest: "sha256:e56b652b77aba267a219e0254816defcdea94509a3e5f7a954ac1f7cf75523db", worktree_digest: "sha256:e56b652b77aba267a219e0254816defcdea94509a3e5f7a954ac1f7cf75523db", untracked_digest: absent}
      - {path: "scripts/install-demo-reset-cron.sh", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:6fc770a8e7d9e273a44dba654f077ba0006ddd599f09e8e8d6ddf5b82d068dc2", index_digest: "sha256:6fc770a8e7d9e273a44dba654f077ba0006ddd599f09e8e8d6ddf5b82d068dc2", worktree_digest: "sha256:6fc770a8e7d9e273a44dba654f077ba0006ddd599f09e8e8d6ddf5b82d068dc2", untracked_digest: absent}
      - {path: "scripts/tests/demo-snapshot-restore.test.sh", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:2a49c524e7436bf4e9df418215c07264be838d47265a15dd55c991d3eb59c57e", index_digest: "sha256:2a49c524e7436bf4e9df418215c07264be838d47265a15dd55c991d3eb59c57e", worktree_digest: "sha256:2a49c524e7436bf4e9df418215c07264be838d47265a15dd55c991d3eb59c57e", untracked_digest: absent}
      - {path: "scripts/tests/demo-snapshot.test.sh", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:902ad6d6735f0de3da3793bd64f55cbd8d33b9f74a6ae3926ed7cc99058b3d1b", index_digest: "sha256:902ad6d6735f0de3da3793bd64f55cbd8d33b9f74a6ae3926ed7cc99058b3d1b", worktree_digest: "sha256:902ad6d6735f0de3da3793bd64f55cbd8d33b9f74a6ae3926ed7cc99058b3d1b", untracked_digest: absent}
      - {path: "src/platform/api/src/demo/seed-finals-bundle.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:85a31034dd2cbd3330d5d3173da3c2937d875c37aa4ef6d1d3b4fef2150bf7c0", index_digest: "sha256:85a31034dd2cbd3330d5d3173da3c2937d875c37aa4ef6d1d3b4fef2150bf7c0", worktree_digest: "sha256:85a31034dd2cbd3330d5d3173da3c2937d875c37aa4ef6d1d3b4fef2150bf7c0", untracked_digest: absent}
      - {path: "tasks/todo.md", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:81f04d22cebb4dee6d8d26c75fe42daba77c8695fc274adf51fd99026ef3b4af", index_digest: "sha256:81f04d22cebb4dee6d8d26c75fe42daba77c8695fc274adf51fd99026ef3b4af", worktree_digest: "sha256:81f04d22cebb4dee6d8d26c75fe42daba77c8695fc274adf51fd99026ef3b4af", untracked_digest: absent}
  files_to_modify:
    - {file: "scripts/demo-snapshot.sh", symbols: ["verify_bundle", "create_bundle"], intended_change: "Require finals ResultBundle metrics in accepted baselines"}
    - {file: "scripts/demo-restore-snapshot.sh", symbols: ["restore invariant block", "post-start probes"], intended_change: "Verify finals counts and public endpoint after restore"}
    - {file: "scripts/tests/demo-snapshot.test.sh", symbols: [], intended_change: "Regression coverage for missing/zero finals data"}
    - {file: "scripts/tests/demo-snapshot-restore.test.sh", symbols: [], intended_change: "Pin finals restore contract"}
    - {file: "docs/runbooks/demo-snapshot-reset.md", symbols: [], intended_change: "Document finals baseline and deploy checks"}
    - {file: "docs/validation/p2-t64/manifest.md", symbols: [], intended_change: "Append non-secret remediation evidence after deployment"}
  tests:
    - file: "scripts/tests/demo-snapshot.test.sh"
      scenarios:
        - "valid checksums plus missing finals metrics -> verification fails"
        - "valid checksums plus zero VERIFIED bundle/artifact/key -> verification fails"
        - "positive finals metrics plus valid checksums -> verification succeeds"
    - file: "scripts/tests/demo-snapshot-restore.test.sh"
      scenarios:
        - "restore contract retains isolation guards and requires finals validation/probe"
  verification_commands:
    - "npm run demo:snapshot:test"
    - "bash -n scripts/demo-snapshot.sh scripts/demo-restore-snapshot.sh scripts/install-demo-reset-cron.sh"
    - "npm run typecheck"
    - "npm run build"
    - "npm test"
    - "git diff --check"
  pdg_constraints:
    - description: "Source-verified ordering: bundle verification must finish before the restore stops services"
      affected_statements: ["scripts/demo-restore-snapshot.sh:83", "scripts/demo-restore-snapshot.sh:137"]
      implementation_consequence: "Put manifest finals guards in demo-snapshot.sh verify, not after destructive operations"
    - description: "Source-verified ordering: database invariants precede writer startup; HTTP checks follow startup"
      affected_statements: ["scripts/demo-restore-snapshot.sh:198", "scripts/demo-restore-snapshot.sh:212"]
      implementation_consequence: "Compare finals DB counts before compose up and probe the endpoint only after readiness"
  assumptions:
    - "Before deployment, re-check that the public domain still targets ott-demo and that both databases still lack verified finals data"
    - "Resolve all release/env/baseline paths from live Compose labels and root-only config without printing secret values"
    - "GitHub merge permissions and jump-jits SSH access remain available"
  open_questions: []
  avoid:
    - "Do not restore a snapshot over the public ott-demo project"
    - "Do not overwrite the immutable accepted baseline; create a versioned replacement and retain rollback"
    - "Do not log credentials, private keys, tokens, bundle payloads, or private replay contents"
    - "Do not modify frontend/API contracts or database schema; the existing seeder and public endpoint are sufficient"
    - "Do not mark remediation complete until one run-now and one scheduled restore preserve finals data"
```

## Assumptions and Open Questions (§12)

- [assumed] Live paths, stack routing, GitHub permissions, and SSH access will be re-verified immediately before mutation; drift that changes the deployment seam stops the affected step.
- [verified] No requirement/ADR/contract conflict exists: this is a correction to the accepted P2-T61/P2-T64 baseline evidence, not a new finals format.
- Explicitly deferred: changing the public/reset topology or making snapshot restore legal against `ott-demo`; both are outside scope and violate the isolation contract.

## Definition of Done (§13)

- Regression test fails before the fix and all listed verification commands pass after it.
- PR is reviewed, merged into `main`, and deployment uses the exact merged commit.
- Public DB has an active demo key, at least one VERIFIED bundle and its artifacts; public snapshot, `/finals`, and representative bundle replay return HTTP 200.
- The replacement isolated baseline records positive finals counts, passes verification, survives manual `run-now`, and survives one scheduled hourly restore with readiness and finals routes healthy.
- Non-secret evidence records commit, PR, baseline checksum identifier, row/artifact counts, route status, and restore timestamps; rollback baseline remains available.
