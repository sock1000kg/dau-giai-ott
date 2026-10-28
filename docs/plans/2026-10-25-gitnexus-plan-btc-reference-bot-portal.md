# GitNexus Engineering Plan

> Task: Cho phép BTC tự tải lên, quản lý và kích hoạt một OCI reference bot trên portal để các đội dùng trong chạy thử.
> **Lưu ý (2026-10-27):** Hai điểm thiết kế trong plan này đã được thay bằng P3-N10 tiêu chí 3 và `docs/contracts/test-run-v1.md`, nên không dùng để triển khai: (1) catalog cho phép **nhiều** bot enabled, không có ràng buộc một bot hoạt động; (2) worker **fail closed** nếu bot bị tắt trước khi resolve (lỗi hạ tầng, quota được hoàn), không chạy tiếp bằng bản đã pin. Nguồn sự thật: `tasks/todo.md` và contract.
> Evidence verified at commit 133560f2657927369c9b5d1249e1ac3932c6ae82; GitNexus index refreshed this session (--index-only), although per-query freshness text inconsistently reported one commit behind, so source reads are load-bearing.
> Evidence provenance schema 2; global dirty digest sha256:4ba8e47377b5778ad44913706a190c9b21a21a88ae2b75955b4e0c37788ffc52; cited-path manifest 19 sorted entries; exact generated plan path excluded.

## Objective (§1)

Deliver one BTC-operated portal flow for uploading an OCI image archive, validating and storing it as an immutable reference-bot version, explicitly activating it, and exposing the active bot to teams through the existing private, low-priority test-run workflow. [verified: `docs/tai-lieu-yeu-cau.md`, `docs/contracts/test-run-v1.md`]

## Current Behaviour (§2–3)

- [verified] The team policy and UI already understand `BTC_REFERENCE`; the option appears only when `getTestRunPolicy` returns enabled catalog rows.
- [verified] The catalog table stores OCI object/digests/entrypoint/policy/enabled state, but there is no BTC admin route, page, or navigation entry to populate it.
- [verified] `seedDemoReferenceBot` is the only provisioning path: demo-only, environment-driven, pinned-checksum, fixed ID, and not callable from the portal.
- [verified] Submission upload already supplies the reusable 256 MiB streaming, quarantine, OCI validation, content-addressed storage, and rate-limit patterns.
- [verified] Admission and `runTestJob` both require `enabled=TRUE`; therefore disabling/replacing a bot after admission can make an already queued run fail.
- [verified] Admin mutations already use BTC authorization, IP allowlisting, idempotency keys, transactions/advisory locks, reasons, and append-only audit events.

## Findings (§4–5)

- [graph] `impact(createAuthApp, upstream, depth=2)` is HIGH with 19 direct integration-test callers; route registration must retain optional storage wiring and run the full API regression suite.
- [graph] `impact(getTestRunPolicy)`, `impact(runTestJob)`, and `impact(AppNav)` are LOW and identify the policy route, worker test, and navigation tests as direct dependants.
- [graph][verified] `impact(migrationFiles)` returned UNKNOWN; text/source verification found `loadMigrations` plus migration-registry tests, so migration registry parity is mandatory.
- [graph] `query` for reference-bot/admin upload found no current management flow; result-bundle operations and team submissions are the closest established patterns.
- [verified] No PDG layer was available for `runTestJob`; standard-plan freshness policy keeps the refreshed non-PDG index, and the worker ordering constraint is derived from direct source inspection.

## Proposed Changes (§6)

- Add the next migration and registry entry to extend `test_run_reference_bots` with creator/activation metadata, digest uniqueness, and a partial unique constraint allowing at most one enabled bot; preserve existing seeded rows.
- Add a dedicated reference-bot module and BTC-only routes: `GET /api/v1/admin/reference-bots`; `POST /api/v1/admin/reference-bots?displayName=...` using `application/vnd.oci.image.archive.v1+tar` plus `Idempotency-Key`; `POST /:id/activate`; and `POST /:id/disable`, both with mandatory reason. Upload creates a disabled immutable version; activation atomically swaps the active version and audits before/after state.
- Reuse/extract OCI validation and content-addressed object storage from the submission/demo paths. Do not expose `object_key`, credentials, or internal storage details in API responses.
- Keep `createTestRun` admission gated on the currently enabled row, but make `runTestJob` resolve the already-admitted immutable row by ID without rechecking enabled state.
- Refactor `seedDemoReferenceBot` to call the shared provisioning service while retaining its demo-only environment and checksum guards.
- Add `/admin/reference-bots`, BTC navigation label “Bot chạy thử”, upload/history/checksum/status UI, and separate reasoned activation/disable confirmations; the team page continues consuming the existing policy contract.
- Update the test-run contract, operator/admin documentation, task cards, and manual E2E cases in the same PRs.

## Implementation Sequence (§7)

1. Create task cards `P3-N10` (API/storage/worker) and `P3-D12` (portal UI, depends on P3-N10), then branch from `main` using the assigned owner prefixes; confirm IDs/owners before editing status.
2. Add the migration, schema registry entry, invariants, and rollback-safe compatibility tests.
3. Implement the shared service and admin list/upload/activate/disable routes using existing auth, allowlist, limiter, idempotency, transaction, audit, quarantine, and OCI-policy primitives.
4. Move demo seeding onto the shared service and fix worker lookup semantics while keeping admission semantics unchanged.
5. Add the dedicated BTC page, API client, menu/route guards, accessible upload and activation states, and error handling.
6. Update contracts/docs/tasks/manual cases; run focused suites, then root typecheck/build/test and demo E2E.
7. Deploy only after PRs merge to `main` and checkpoint approval; run a real BTC-upload → activate → team-run canary before declaring the feature available.

## Test Strategy (§8)

- API: RBAC/allowlist; wrong MIME, empty, oversized, corrupt OCI; successful disabled upload and object persistence; replay/conflicting idempotency key; safe response redaction; reasoned activate/disable audit; concurrent activation leaves exactly one enabled; team policy exposes only active bot.
- Migration: registry/file parity, existing-row compatibility, digest uniqueness, and one-active constraint.
- Worker: a run admitted before disable/replacement still completes using its pinned row; new admissions cannot select a disabled bot; integrity/policy failures retain current terminal/refund behavior.
- Web: BTC-only nav/route; file/size validation; upload progress and errors; history/checksums; confirmation/reason; double-submit prevention; keyboard and responsive behavior; team BTC option appears/disappears from policy.
- Manual E2E: BTC uploads OCI → activates it → team selects it → run reaches QUEUED/RUNNING/COMPLETED → replay is viewable; replacement hides the old bot from new admissions without breaking an already queued run.
- Commands: `npm test --workspace @ott/platform-api -- reference-bots test-runs demo-reference-bot migrations-registry`; `npm test --workspace @ott/platform-worker -- test-run.integration.test.ts`; `npm test --workspace @ott/platform-web -- reference-bots AppNav app-routes test-runs`; `npm run typecheck`; `npm run build`; `npm test`; `npm run test:e2e:demo`.

## Implementation Context (§11)

```yaml
implementation_context:
  task_summary: "BTC uploads and manages an immutable OCI reference bot; teams run against the single active version through the existing test-run contract."
  evidence_provenance:
    {
      "schema_version": 2,
      "head_commit": "133560f2657927369c9b5d1249e1ac3932c6ae82",
      "generated_plan_path": "docs/plans/2026-10-25-gitnexus-plan-btc-reference-bot-portal.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "4ba8e47377b5778ad44913706a190c9b21a21a88ae2b75955b4e0c37788ffc52"
      },
      "cited_path_manifest": [
        {
          "path": "docs/README.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6c406880b2eac785286ee7105f34ea2fe3628116aa0b15eb8133835631e6930e",
          "index_digest": "sha256:6c406880b2eac785286ee7105f34ea2fe3628116aa0b15eb8133835631e6930e",
          "worktree_digest": "sha256:6c406880b2eac785286ee7105f34ea2fe3628116aa0b15eb8133835631e6930e",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/contracts/test-run-v1.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5889bf11e18720120572740332575292580dc5c2107cef2d905f49a6f448dd25",
          "index_digest": "sha256:5889bf11e18720120572740332575292580dc5c2107cef2d905f49a6f448dd25",
          "worktree_digest": "sha256:5889bf11e18720120572740332575292580dc5c2107cef2d905f49a6f448dd25",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/tai-lieu-yeu-cau.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:f84b6330c74e85d97846e9631a875d55aacdf3ad195420397f349a273f6189c1",
          "index_digest": "sha256:f84b6330c74e85d97846e9631a875d55aacdf3ad195420397f349a273f6189c1",
          "worktree_digest": "sha256:f84b6330c74e85d97846e9631a875d55aacdf3ad195420397f349a273f6189c1",
          "untracked_digest": "absent"
        },
        {
          "path": "package.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:be3479f54834886307903d9176f2ae7ec2c02ca98786dedc8a93492baa2d7d7a",
          "index_digest": "sha256:be3479f54834886307903d9176f2ae7ec2c02ca98786dedc8a93492baa2d7d7a",
          "worktree_digest": "sha256:be3479f54834886307903d9176f2ae7ec2c02ca98786dedc8a93492baa2d7d7a",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/migrations/0020_test_run_frontend_contract.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b02bf3718638baf289b50fe67269405c69ac391070580bdc021f0b25540c728a",
          "index_digest": "sha256:b02bf3718638baf289b50fe67269405c69ac391070580bdc021f0b25540c728a",
          "worktree_digest": "sha256:b02bf3718638baf289b50fe67269405c69ac391070580bdc021f0b25540c728a",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/src/app.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4260b21a34c4afbdaffaa0b577a9963e97abb1827c3287b2cc06991e5f5a4be4",
          "index_digest": "sha256:4260b21a34c4afbdaffaa0b577a9963e97abb1827c3287b2cc06991e5f5a4be4",
          "worktree_digest": "sha256:4260b21a34c4afbdaffaa0b577a9963e97abb1827c3287b2cc06991e5f5a4be4",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/src/db/schema.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:8feb8df5dc04d802484bb87c7cb60ac6ef23920fa082e102edad54938ec36db0",
          "index_digest": "sha256:8feb8df5dc04d802484bb87c7cb60ac6ef23920fa082e102edad54938ec36db0",
          "worktree_digest": "sha256:8feb8df5dc04d802484bb87c7cb60ac6ef23920fa082e102edad54938ec36db0",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/src/demo/seed-reference-bot.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ab3caa91366bbd4879c25d02b45f37bc04340b1ce16374d92c9be4acda61fb6e",
          "index_digest": "sha256:ab3caa91366bbd4879c25d02b45f37bc04340b1ce16374d92c9be4acda61fb6e",
          "worktree_digest": "sha256:ab3caa91366bbd4879c25d02b45f37bc04340b1ce16374d92c9be4acda61fb6e",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/src/modules/operations/service.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:31db3cc832b429fd065885c4eaa6969d6706439de7716b3cd291c32ebc868b90",
          "index_digest": "sha256:31db3cc832b429fd065885c4eaa6969d6706439de7716b3cd291c32ebc868b90",
          "worktree_digest": "sha256:31db3cc832b429fd065885c4eaa6969d6706439de7716b3cd291c32ebc868b90",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/src/modules/submissions/routes.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3b9637801cdb2aba0c3e779c52cbc11c81c7416170ea73dee46f0806ec6e28ee",
          "index_digest": "sha256:3b9637801cdb2aba0c3e779c52cbc11c81c7416170ea73dee46f0806ec6e28ee",
          "worktree_digest": "sha256:3b9637801cdb2aba0c3e779c52cbc11c81c7416170ea73dee46f0806ec6e28ee",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/src/modules/test-runs/service.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a81578a73d31c384c450c071117e996e232b3fc45652dde46801a45af244f4a2",
          "index_digest": "sha256:a81578a73d31c384c450c071117e996e232b3fc45652dde46801a45af244f4a2",
          "worktree_digest": "sha256:a81578a73d31c384c450c071117e996e232b3fc45652dde46801a45af244f4a2",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/api/tests/demo-reference-bot.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4b9edb3623d0f5278be3e4e5b480e16fc143dd881f144ae9145b5ec577714773",
          "index_digest": "sha256:4b9edb3623d0f5278be3e4e5b480e16fc143dd881f144ae9145b5ec577714773",
          "worktree_digest": "sha256:4b9edb3623d0f5278be3e4e5b480e16fc143dd881f144ae9145b5ec577714773",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/web/src/app/routes.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:419b24151b9074d669c1792147577e17c26103337831c9b2d12079e5436d5ab2",
          "index_digest": "sha256:419b24151b9074d669c1792147577e17c26103337831c9b2d12079e5436d5ab2",
          "worktree_digest": "sha256:419b24151b9074d669c1792147577e17c26103337831c9b2d12079e5436d5ab2",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/web/src/features/test-runs/TestRunsPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:67e1659b28d5356d5fa0e501338d450b8aed301aace3f093251734a352ab9a04",
          "index_digest": "sha256:67e1659b28d5356d5fa0e501338d450b8aed301aace3f093251734a352ab9a04",
          "worktree_digest": "sha256:67e1659b28d5356d5fa0e501338d450b8aed301aace3f093251734a352ab9a04",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/web/src/ui/AppNav.test.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:578aefe6124153e0f024f31812058bf727dfbaaa0d155cd6053e51cbb593c537",
          "index_digest": "sha256:578aefe6124153e0f024f31812058bf727dfbaaa0d155cd6053e51cbb593c537",
          "worktree_digest": "sha256:578aefe6124153e0f024f31812058bf727dfbaaa0d155cd6053e51cbb593c537",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/web/src/ui/AppNav.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:949f41113ee24d808b7d0d59771802f881c6654c84c5299ce54bfdfbe8037e13",
          "index_digest": "sha256:949f41113ee24d808b7d0d59771802f881c6654c84c5299ce54bfdfbe8037e13",
          "worktree_digest": "sha256:949f41113ee24d808b7d0d59771802f881c6654c84c5299ce54bfdfbe8037e13",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/worker/src/run-test-job.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:686e28191a0eb73e4a728afd805929afad15e994eb703e1bf5fe9f008969621d",
          "index_digest": "sha256:686e28191a0eb73e4a728afd805929afad15e994eb703e1bf5fe9f008969621d",
          "worktree_digest": "sha256:686e28191a0eb73e4a728afd805929afad15e994eb703e1bf5fe9f008969621d",
          "untracked_digest": "absent"
        },
        {
          "path": "src/platform/worker/tests/test-run.integration.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1a50bbd0ea66e5d31f4dfc9fb1ea59186132ee0d4eb3c2c18ac88c61b1aabc95",
          "index_digest": "sha256:1a50bbd0ea66e5d31f4dfc9fb1ea59186132ee0d4eb3c2c18ac88c61b1aabc95",
          "worktree_digest": "sha256:1a50bbd0ea66e5d31f4dfc9fb1ea59186132ee0d4eb3c2c18ac88c61b1aabc95",
          "untracked_digest": "absent"
        },
        {
          "path": "tasks/todo.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7412920da2cf9bbed2ef0b166644a6dd0863e5a6a4e6553d0569c098fef60af4",
          "index_digest": "sha256:7412920da2cf9bbed2ef0b166644a6dd0863e5a6a4e6553d0569c098fef60af4",
          "worktree_digest": "sha256:7412920da2cf9bbed2ef0b166644a6dd0863e5a6a4e6553d0569c098fef60af4",
          "untracked_digest": "absent"
        }
      ]
    }
  files_to_modify:
    - file: "src/platform/api/migrations/0022_reference_bot_portal.sql"
      symbols: []
      intended_change: "Extend immutable catalog metadata and enforce digest/single-active invariants."
    - file: "src/platform/api/src/db/schema.ts"
      symbols: ["migrationFiles"]
      intended_change: "Register the migration."
    - file: "src/platform/api/src/modules/reference-bots/"
      symbols: []
      intended_change: "Add shared provisioning/catalog service and BTC admin routes."
    - file: "src/platform/api/src/app.ts"
      symbols: ["createAuthApp"]
      intended_change: "Register storage-backed reference-bot routes under existing admin controls."
    - file: "src/platform/api/src/demo/seed-reference-bot.ts"
      symbols: ["seedDemoReferenceBot"]
      intended_change: "Reuse shared provisioning while preserving demo guards."
    - file: "src/platform/api/src/modules/test-runs/service.ts"
      symbols: ["getTestRunPolicy", "createTestRun"]
      intended_change: "Retain active-only discovery and admission."
    - file: "src/platform/worker/src/run-test-job.ts"
      symbols: ["runTestJob"]
      intended_change: "Resolve the admitted immutable bot by ID even after later disable."
    - file: "src/platform/web/src/features/reference-bots/"
      symbols: []
      intended_change: "Add BTC management page, client, styles, and tests."
    - file: "src/platform/web/src/ui/AppNav.tsx"
      symbols: ["AppNav"]
      intended_change: "Add BTC-only Bot chạy thử navigation."
    - file: "src/platform/web/src/app/routes.tsx"
      symbols: ["renderAuthenticated"]
      intended_change: "Add protected /admin/reference-bots route."
    - file: "docs/contracts/test-run-v1.md"
      symbols: []
      intended_change: "Specify portal lifecycle, pinning, visibility, and audit semantics."
    - file: "tasks/todo.md"
      symbols: []
      intended_change: "Add owner/dependency/status cards; tick only after verification."
  tests:
    - file: "src/platform/api/tests/reference-bots.routes.test.ts"
      scenarios: ["upload validation and persistence", "idempotency replay/conflict", "RBAC/redaction", "atomic activation and audit", "policy exposure"]
    - file: "src/platform/api/tests/demo-reference-bot.test.ts"
      scenarios: ["shared-service seed remains guarded, checksum-pinned, and idempotent"]
    - file: "src/platform/worker/tests/test-run.integration.test.ts"
      scenarios: ["admitted run survives later disable", "disabled bot rejects new admission"]
    - file: "src/platform/web/src/features/reference-bots/ReferenceBotsPage.test.tsx"
      scenarios: ["upload/history/status", "reasoned activation", "errors/double-submit/accessibility"]
    - file: "src/platform/web/src/ui/AppNav.test.tsx"
      scenarios: ["BTC sees management link; team and unauthenticated roles do not"]
  verification_commands:
    - "npm test --workspace @ott/platform-api -- reference-bots test-runs demo-reference-bot migrations-registry"
    - "npm test --workspace @ott/platform-worker -- test-run.integration.test.ts"
    - "npm test --workspace @ott/platform-web -- reference-bots AppNav app-routes test-runs"
    - "npm run typecheck"
    - "npm run build"
    - "npm test"
    - "npm run test:e2e:demo"
  assumptions:
    - "Recheck that 0022 remains the next migration number immediately before implementation."
    - "Confirm P3-N10/P3-D12 IDs and assigned owner prefixes in tasks/todo.md before creating branches."
    - "Confirm product accepts exactly one active BTC reference bot in v1; enforce it in database and transaction."
  open_questions:
    - "Owner assignment for P3-N10 and P3-D12 requires project approval."
    - "Asynchronous bot preflight is deferred; v1 performs OCI/policy validation and requires a real canary test run before checkpoint approval."
  avoid:
    - "Do not repeat full repository discovery."
    - "Do not code directly on main or deploy before merge and checkpoint approval."
    - "Do not overwrite or include existing untracked demo/manually-check/artifacts."
    - "Do not expose object keys, credentials, or cross-team artifacts."
    - "Do not delete old bot objects or rows in v1; queued runs pin immutable IDs."
```

## Assumptions and Open Questions (§12)

- [assumed] V1 permits exactly one active BTC bot and keeps prior versions disabled but immutable; confirm before migration implementation.
- [assumed] Use `P3-N10` and `P3-D12`; task ownership remains to be assigned by the project lead.
- [inferred] Upload and activation are deliberately separate so an unreviewed artifact is never immediately offered to teams.
- [inferred] Asynchronous preflight is a follow-up; structural OCI/policy validation plus a real canary is the v1 gate.
- Existing untracked `demo/manually-check/artifacts/` is user-owned and outside this plan.

## Definition of Done (§13)

- BTC can upload a valid OCI archive, see immutable digest metadata, activate/disable it with a reason, and every mutation is idempotent, authorized, rate-limited, transactional, and audited.
- Teams see only the active BTC bot, can complete and replay a private low-priority test run against it, and cannot access another team's artifacts.
- Replacement/disable blocks new selection without breaking already admitted queued runs; database constraints prevent multiple active bots.
- Focused and root verification commands pass, docs/tasks/manual E2E are synchronized, and the demo canary is evidenced before checkpoint approval.

