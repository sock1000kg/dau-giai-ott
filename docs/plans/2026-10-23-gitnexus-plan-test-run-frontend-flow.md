# GitNexus Engineering Plan

> Task: Hoàn thiện contract/backend và xây dựng luồng “Chạy thử bot” end-to-end trên frontend đội thi.
> Evidence verified at commit `986aa532236e0325694be3df4766643fdfeeb21e`; GitNexus index refreshed this session (`analyze --index-only --pdg`).
> Evidence provenance schema 2; global dirty digest `c4bf0609abc0d643a075beb8e4fcfd8d133579aec44eb2721ff4a63a0c769504`; cited-path manifest 38 sorted entries; exact generated plan path excluded.

## 1. Objective

Tạo một mục riêng **Chạy thử bot** cho tài khoản đội thi tại `/team/test-runs`, cho phép chọn submission hợp lệ, chọn bot đối chứng BTC hoặc một submission khác của chính đội, gửi một lần chạy, theo dõi trạng thái/kết quả và mở replay riêng tư. [assumed]

Frontend chỉ được phát hành sau khi ba gate backend được hoàn tất: bot đối chứng thật sự được resolve thay vì self-play, quota mặc định/điểm trừ quota đúng đặc tả, và replay test-run dùng event log có integrity để tái sử dụng `ReplayPlayer`. [inferred]

## 2. Current Behaviour

- Menu đội thi chỉ có **Tổng quan**, **Nộp bot**, **Kết quả**; chưa có mục test-run (`src/platform/web/src/ui/AppNav.tsx:24`). [verified]
- Router xác thực chưa nhận `/team/test-runs`; đường dẫn này hiện rơi vào trang từ chối truy cập (`src/platform/web/src/app/routes.tsx:58`). [verified]
- Backend đã có `POST /api/v1/test-runs`, danh sách, chi tiết và replay (`src/platform/api/src/modules/test-runs/routes.ts:33`). Runtime API cũng đã inject queue producer (`src/platform/api/src/runtime/server.ts:198`). [verified]
- `createTestRun` kiểm tra quyền sở hữu submission/opponent, ghi bản ghi `QUEUED`, đặt `quota_consumed = TRUE`, rồi enqueue priority thấp (`src/platform/api/src/modules/test-runs/service.ts:127`, `src/platform/api/src/modules/test-runs/service.ts:202`). [verified]
- Khi không tìm thấy round/rules, service dùng quota mặc định 5; yêu cầu sản phẩm quy định mặc định 2 lượt/ngày, chỉ tính khi trận bắt đầu và hoàn quota khi lỗi hạ tầng (`src/platform/api/src/modules/test-runs/service.ts:103`, `docs/tai-lieu-yeu-cau.md:430`). [verified]
- Worker không được runtime inject `getReferenceBot`; nhánh `BTC_REFERENCE` vì thế dùng chính archive của submission làm đối thủ (`src/platform/worker/src/runtime/server.ts:250`, `src/platform/worker/src/run-test-job.ts:136`). [verified]
- Worker lưu `JSON.stringify(report.events)`, trong khi replay player yêu cầu một `SpectatorReplay` versioned với media type và SHA-256 header (`src/platform/worker/src/run-test-job.ts:211`, `src/platform/web/src/features/spectator/verify-replay.ts:39`). [verified]
- `P3-N03` đã tick nhưng checkpoint `P3-C` vẫn mở; trạng thái này không được coi là bằng chứng browser/live E2E (`tasks/todo.md:1090`). [verified]

## 3. Relevant Architecture

- Nghiệp vụ test-run thuộc API modular monolith và worker; frontend chỉ gọi HTTP, không được tự suy diễn quota hay danh mục opponent. [inferred]
- `SubmissionForm` và client submission là pattern hiện có cho loading/action/error parsing ở team portal (`src/platform/web/src/features/submissions/SubmissionForm.tsx:1`, `src/platform/web/src/features/submissions/api.ts:1`). [verified]
- Replay chuẩn đi qua event-log verification, `publicEventLog`, media type versioned và checksum trước khi tới UI (`src/platform/api/src/modules/replays/service.ts:227`, `src/platform/api/src/modules/replays/routes.ts:124`, `src/platform/web/src/pages/PrivateReplayPage.tsx:17`). [verified]
- Yêu cầu và SA khóa các boundary: chỉ BTC reference hoặc bot cùng đội, không tính Elo, cùng engine/rules/sandbox, queue ưu tiên thấp hơn trận chính thức và admission có thể pause (`docs/tai-lieu-yeu-cau.md:430`, `docs/architecture/solution-architecture-phase-3.md:145`). [verified]
- `tasks/todo.md` là nguồn duy nhất cho task ID/dependency/status; `tasks/plan.md` chỉ là dependency overview (`docs/README.md:9`). [verified]

## 4. GitNexus Findings

- `context(name="AppNav")`: caller trực tiếp là `AppShellLayout`, có test trực tiếp ở `AppNav.test.tsx`; thêm menu có blast radius nhỏ nhưng phải sửa exact-nav assertions. [graph]
  - Kết quả chính: `incoming: AppNav.test.tsx, AppShellLayout`.
- `impact(target="AppNav", direction="upstream")`: risk `LOW`, direct dependent 1 (`AppShellLayout`), gián tiếp tới `AuthRoutes`/`App`. [graph]
- `impact(target="renderAuthenticated", direction="upstream")`: risk `LOW`, direct dependent `AuthRoutes`; role-route matrix là regression gate. [graph]
- `impact(target="createTestRun", direction="upstream")`: risk `LOW`, direct dependent `registerTestRunRoutes`, gián tiếp `createAuthApp`. [graph]
- `api_impact(route="/api/v1/test-runs", method="POST")`: không thấy consumer hiện tại, 6 execution flows, risk `LOW`; `runtimeEvidence.confirmed=false`, nên đây chỉ là graph evidence và đã được source-read xác nhận. [graph]
- `api_impact(route="/api/v1/test-runs/:id/replay", method="GET")` và GET list: không thấy consumer, mỗi route liên quan 6 flows, risk `LOW`; response shape không được analyzer suy ra. [graph]
- Index PDG được refresh lên 43.231 nodes/101.690 edges/611 flows, nhưng whole-repo flow discovery bị truncate; không được đọc “không có flow” thành “không ảnh hưởng”. [graph]

## 5. Statement-Level PDG Findings

- `pdg_query(target="createTestRun", mode="controls")` cho thấy quota guard `consumedQuota >= maxQuota` điều khiển đường throw trước lookup submission; insert `QUEUED` và enqueue nằm sau các nhánh validate opponent. [graph]
- `pdg_query(target="createTestRun", mode="flows", variable="consumedQuota")` chỉ ra `consumedQuota` được định nghĩa từ truy vấn daily consumption và dùng trực tiếp tại quota guard. [graph]
- Vì quota hiện được đánh dấu consumed trong insert, hai request đồng thời có thể cùng vượt qua count trước khi một request commit; việc thêm UI/double-click làm race này dễ lộ hơn. Cần transaction/unique idempotency chứ không chỉ disable nút. [inferred]
- `pdg_query(target="src/platform/worker/src/run-test-job.ts", mode="controls")` xác nhận `!options.getReferenceBot` điều khiển việc gán `archiveO = archiveX`; sau đó cả hai bot đi vào cùng `runMatch`. [graph]
- Cùng slice cho thấy worker đổi `RUNNING` trước khi load archive, rồi mọi exception đi qua `failTestRun`; chuyển quota sang thời điểm start phải nằm trong cùng atomic claim `QUEUED -> RUNNING`, nếu không retry worker có thể trừ hai lần. [inferred]
- Slice cũng xác nhận replay bytes hiện được tạo từ `report.events`; phải lưu `serializeEventLog(report.log)` và checksum, sau đó API parse/verify/project trước khi trả. [verified]

## 6. Proposed Changes

### 6.1 Backend contract/correctness gate

1. `docs/contracts/test-run-v1.md` — tạo contract v1 cho policy, create/list/detail/replay, pagination, error codes, privacy, idempotency và reset time. Response thay đổi theo hướng additive; không đổi nghĩa field đang có. [inferred]
2. `src/platform/api/migrations/0020_test_run_frontend_contract.sql` — migration additive:
   - đổi default mới của `quota_consumed` thành false, thêm `quota_started_at`;
   - thêm `idempotency_key`, `request_hash` và unique `(team_id, idempotency_key)`;
   - thêm metadata/checksum replay nếu chưa thể suy ra an toàn từ object storage;
   - không sửa migration `0015_test_runs.sql` và không rewrite dữ liệu lịch sử nếu chưa có rule backfill rõ ràng. [inferred]
3. `src/platform/api/src/modules/test-runs/service.ts`:
   - thêm `getTestRunPolicy(teamId, roundId?)` trả round hiện hành, quota `{limit, consumed, reserved, remaining, resetsAt}`, opponent modes và reference-bot catalog;
   - mặc định quota 2 theo requirement;
   - `createTestRun` chạy transaction/lock phù hợp, honor `Idempotency-Key` + request hash một cách atomic; cùng key+cùng body trả resource cũ, cùng key+khác body trả conflict;
   - validate opponent-own khác submission chính, cùng team và eligible; không để frontend là lớp bảo vệ duy nhất;
   - list có pagination ổn định theo `(created_at, id)` và trả metadata additive. [inferred]
4. `src/platform/api/src/modules/test-runs/routes.ts`:
   - thêm `GET /api/v1/test-run-policy`;
   - parse/validate `Idempotency-Key`, page/pageSize và structured errors;
   - replay endpoint trả raw `SpectatorReplay`, `Content-Type: application/vnd.ott.spectator-replay+json;version=N`, `X-Replay-Sha256`, private cache policy; 404 cho cross-team để tránh dò ID. [inferred]
5. `src/platform/worker/src/run-test-job.ts` và `src/platform/worker/src/runtime/server.ts`:
   - atomic claim `QUEUED -> RUNNING` đồng thời trừ quota đúng một lần;
   - inject reference-bot resolver thật từ catalog/config đã seed; thiếu artifact thì fail closed `REFERENCE_BOT_UNAVAILABLE`, tuyệt đối không self-play;
   - lưu serialized `report.log`, checksum và final-state hash; complete chỉ sau khi object storage write thành công;
   - giữ refund chỉ cho lỗi hạ tầng và bảo đảm retry idempotent. [inferred]
6. `src/platform/api/src/modules/replays/service.ts`/`routes.ts` — tái sử dụng parse/verify/projection/header helpers thay vì fork logic replay cho test-run. [inferred]

### 6.2 Team frontend

1. `src/platform/web/src/features/test-runs/api.ts` — strict parsers/types cho policy, paginated runs, create/detail và verified replay; mỗi user intent sinh một idempotency key và giữ nguyên key khi retry do network. [inferred]
2. `src/platform/web/src/features/test-runs/TestRunsPage.tsx` — form + history:
   - load policy và các submission eligible;
   - chọn BTC reference hoặc submission khác của cùng đội;
   - hiển thị quota/reset/admission-paused; disable submit khi invalid/đang gửi;
   - polling có backoff khi `QUEUED/RUNNING`, dừng khi terminal/unmount/ẩn tab;
   - hiển thị result, failure reason và stderr đã được backend giới hạn; không hiện Elo, seed nội bộ hoặc object key.
3. `src/platform/web/src/features/test-runs/TestRunReplayPage.tsx` — fetch replay riêng tư qua contract mới rồi tái sử dụng `verifyReplayResponse`/`ReplayPlayer`; trạng thái chưa hoàn tất, unavailable, integrity fail có thông báo riêng. [inferred]
4. `src/platform/web/src/app/routes.tsx` — route team-only `/team/test-runs` và `/team/test-runs/:id/replay`; admin/public bị từ chối theo pattern hiện tại. [inferred]
5. `src/platform/web/src/ui/AppNav.tsx` — thêm mục **Chạy thử bot**, active cho cả list và replay detail. [inferred]

### 6.3 Tests, demo và quản trị task

1. Thêm API/worker/web tests ở các file §8; mở rộng live local E2E để chạy thật queue + object storage + replay integrity. [inferred]
2. Cập nhật `demo/01-tong-quan.md`, `demo/04-ban-do-chuc-nang-ui.md`, bộ `demo/manually-check/` và biên bản để có test-case menu → create → polling → result → replay, quota, retry/idempotency, RBAC và failure paths. [inferred]
3. Sau khi owner phê duyệt ID, tạo hai task/PR riêng từ `main`: đề xuất `P3-N09` cho backend gate và `P3-D11` cho frontend/manual E2E, frontend depends-on backend. Chỉ tick task sau verification; không tự đóng `P3-C`. [assumed]

## 7. Implementation Sequence

1. Owner xác nhận task IDs/owners, reference-bot catalog source và contract v1; tạo từng branch riêng từ `main`, không tiếp tục trên branch docs hiện tại. [assumed]
2. Viết contract tests failing cho quota=2, atomic idempotency, opponent privacy/eligibility, pagination và replay headers/schema.
3. Thêm migration `0020`, repository/service transaction và policy endpoint; giữ compatibility cho các API hiện hành.
4. Thêm reference-bot resolver runtime, atomic worker claim/quota consumption và event-log persistence; hoàn thiện API projection/replay integrity.
5. Chạy backend tests + live dependency tests; chỉ khi backend gate xanh mới bắt đầu frontend PR.
6. Viết frontend API parsers và behavior tests, sau đó xây `TestRunsPage`/`TestRunReplayPage`.
7. Wire routes/menu, cập nhật route matrix, nav, accessibility/responsive tests.
8. Cập nhật local-demo seed/reference artifact, E2E và manual cases; chạy toàn bộ verification.
9. Chạy GitNexus `detect-changes --scope all`; nếu partial/truncated thì xử lý như unresolved và rerun/đối chiếu source trước review.
10. Đồng bộ contract/demo/task docs trong đúng PR; owner chỉ tick task và checkpoint sau khi evidence được duyệt.

## 8. Test Strategy

- `src/platform/api/tests/test-runs.routes.integration.test.ts` (mới):
  - team hợp lệ → policy trả limit 2, remaining/reset/reference catalog;
  - hai POST song song cùng key/body → một row/một job/một quota reservation;
  - cùng key khác body → conflict có code ổn định;
  - vượt quota, admission paused, invalid/cross-team opponent → đúng status/code, không rò tồn tại;
  - list pagination deterministic; detail/replay cross-team trả 404;
  - completed replay → đúng media type/checksum/schema; corrupt object → integrity error, không trả payload.
- `src/platform/worker/tests/test-run.integration.test.ts`:
  - BTC reference dùng artifact riêng, không cùng digest/submission;
  - thiếu resolver/artifact → `REFERENCE_BOT_UNAVAILABLE`;
  - concurrent/retried job chỉ một claim và một quota consumption;
  - infra failure refund, bot fault không refund;
  - object lưu event log parse/verify được và completion ghi checksum.
- `src/platform/web/src/features/test-runs/test-runs.test.tsx` (mới): loading/empty/success, opponent switching, validation, idempotent retry, polling lifecycle, quota/error mapping, completed replay link.
- `src/platform/web/src/features/test-runs/test-runs.ui.test.tsx` (mới): keyboard flow, labels/live regions/focus, mobile overflow và state badges không phụ thuộc chỉ vào màu.
- Cập nhật `AppNav.test.tsx`, `app-routes.test.tsx`, replay verification fixtures và `tests/e2e/local-demo.test.ts` cho route/RBAC/full live flow.
- Manual E2E ghi actual result/evidence tại `demo/manually-check/02-qualification-team-btc.md` và `BIEN-BAN-KIEM-THU.md`; tối thiểu gồm happy path BTC, own submission, double click/network retry, quota boundary/reset, official-admission pause, infra refund, cross-team privacy, replay integrity và responsive/keyboard.

Verification commands:

```bash
npm test --workspace @ott/platform-api -- test-runs.routes.integration.test.ts
npm test --workspace @ott/platform-worker -- test-run.integration.test.ts
npm test --workspace @ott/platform-web -- test-runs AppNav app-routes verify-replay
npm run typecheck
npm run build
npm run test:e2e:demo
git diff --check
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

`npm run test:e2e:demo` yêu cầu PostgreSQL/Redis/MinIO/worker local hoạt động; failure do dependency phải được báo riêng, không gọi suite xanh. [verified]

## 9. Risk and Impact Analysis

- **Concurrency/highest risk:** quota check + create + enqueue không atomic sẽ over-admit; idempotency lưu DB và atomic worker claim là bắt buộc. [inferred]
- **Replay compatibility:** đổi payload hiện tại có thể ảnh hưởng consumer ngoài graph; versioned media type/contract và source search trước implementation là bắt buộc vì `api_impact.runtimeEvidence.confirmed=false`. [graph]
- **Privacy/security:** detail/replay/stderr chỉ team owner; response 404 cho foreign IDs; không expose object key, secret, full unbounded stderr hoặc internal reference artifact. [inferred]
- **Migration:** chỉ migration forward `0020`; backfill tách rõ, reversible, lock duration được đo trên dữ liệu representative. [inferred]
- **Queue semantics:** priority thấp và admission pause phải ở backend/queue, không phải UI; race với trận official cần integration test. [verified]
- **Reference bot supply:** cấu hình/corpus demo không tự động là artifact production; deployment phải health-check catalog/artifact trước khi bật menu. [inferred]
- **Direct dependents:** `AppShellLayout`, `AuthRoutes`, `registerTestRunRoutes` và các exact-output tests phải được cập nhật theo impact findings. [graph]
- **Observability:** log/metric theo `testRunId`, opponent mode, queue wait, duration, terminal status, refund reason và idempotency replay; không log archive/credentials/stderr nguyên văn. [inferred]
- **Dirty worktree:** `tasks/todo.md`, `tasks/plan.md`, `demo/` và public UI đang có thay đổi ngoài plan; executor phải tách branch/commit và không overwrite các thay đổi này. [verified]

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `docs/contracts/test-run-v1.md` | contract mới | Khóa HTTP/schema/error/idempotency/replay |
| `src/platform/api/migrations/0020_test_run_frontend_contract.sql` | migration mới | Quota timing, idempotency, replay metadata |
| `src/platform/api/src/modules/test-runs/service.ts` | `createTestRun`, policy/list/start helpers | Atomic semantics và metadata UI |
| `src/platform/api/src/modules/test-runs/routes.ts` | `registerTestRunRoutes` | Policy, pagination, idempotency, replay response |
| `src/platform/api/src/modules/replays/service.ts` | `publicEventLog`/helper extraction | Reuse verified projection |
| `src/platform/api/src/runtime/server.ts` | test-run registration | Wire dependencies mới |
| `src/platform/worker/src/run-test-job.ts` | `runTestJob` | Claim/quota/reference bot/event log |
| `src/platform/worker/src/runtime/server.ts` | test-run worker registration | Inject reference resolver |
| `src/platform/web/src/features/test-runs/*` | API/page/replay/tests | Feature frontend mới |
| `src/platform/web/src/app/routes.tsx` | `renderAuthenticated` | Team-only routes |
| `src/platform/web/src/ui/AppNav.tsx` | `AppNav` | Menu và active state |
| Test files nêu tại §8 | existing/new suites | Contract, regression, accessibility, E2E |
| `demo/*.md`, `demo/manually-check/*` | demo/manual artifacts | Hướng dẫn và evidence human E2E |
| `tasks/todo.md`, `tasks/plan.md` | task cards/dependencies | Chỉ cập nhật sau owner approval/verification |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: "Deliver the team test-run frontend only after backend quota, reference-bot and replay-integrity gates are correct."
  acceptance_criteria:
    - "Team nav and team-only routes expose create/history/private replay."
    - "BTC reference and own-submission opponents execute with authoritative backend validation."
    - "Quota is 2/day by default, consumed atomically at start and refunded only for infrastructure failure."
    - "Create retries are atomically idempotent and cannot duplicate rows/jobs/quota."
    - "Replay reuses verified SpectatorReplay/ReplayPlayer flow."
    - "Automated and manual E2E evidence exists; P3-C remains owner-approved only."
  evidence_provenance:
    schema_version: 2
    head_commit: "986aa532236e0325694be3df4766643fdfeeb21e"
    generated_plan_path: "docs/plans/2026-10-23-gitnexus-plan-test-run-frontend-flow.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "c4bf0609abc0d643a075beb8e4fcfd8d133579aec44eb2721ff4a63a0c769504"
    cited_path_manifest:
      - {path: "demo/01-tong-quan.md", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "regular"}, state: "untracked", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "sha256:e20c8e349aacd7813706624019d0da2666a1d24bf3d314fa1a0f3da9e5d3762d"}
      - {path: "demo/04-ban-do-chuc-nang-ui.md", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "regular"}, state: "untracked", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "sha256:9a8fe5b7873eabebaf53e0a339b4f5f7860efe2aaeeb9e587901f661a6266e6f"}
      - {path: "demo/manually-check/02-qualification-team-btc.md", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "regular"}, state: "untracked", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "sha256:45796ce963cdd5a0fbbee273cf811134c0d57c8bf09a571bfa4391a0d07869da"}
      - {path: "demo/manually-check/BIEN-BAN-KIEM-THU.md", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "regular"}, state: "untracked", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "sha256:4eae1594f53521bf79cfac88a95ed8dc3a39a9a88b89f85216a485351bdbbb45"}
      - {path: "demo/manually-check/README.md", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "regular"}, state: "untracked", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "sha256:0480afcac8ebbbbe17e2b993ffbc2e7b83e7e3991721f4982f13f482a582e327"}
      - {path: "docs/README.md", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:79c73ad76501b70b210ec552d0b1e47b40cb180965cb3782ecaa3ee9b7d1959b", index_digest: "sha256:79c73ad76501b70b210ec552d0b1e47b40cb180965cb3782ecaa3ee9b7d1959b", worktree_digest: "sha256:79c73ad76501b70b210ec552d0b1e47b40cb180965cb3782ecaa3ee9b7d1959b", untracked_digest: "absent"}
      - {path: "docs/architecture/solution-architecture-phase-3.md", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:123c13298db025aa6d24828b71a18ffe6d6ae2df29500a3834e832ee1c9433a4", index_digest: "sha256:123c13298db025aa6d24828b71a18ffe6d6ae2df29500a3834e832ee1c9433a4", worktree_digest: "sha256:123c13298db025aa6d24828b71a18ffe6d6ae2df29500a3834e832ee1c9433a4", untracked_digest: "absent"}
      - {path: "docs/contracts/test-run-v1.md", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "docs/tai-lieu-yeu-cau.md", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:5c3bdf07ff50f2b23b4c9002819f8eb49c195a3d26b4ad248c8c93e2077cd2d9", index_digest: "sha256:5c3bdf07ff50f2b23b4c9002819f8eb49c195a3d26b4ad248c8c93e2077cd2d9", worktree_digest: "sha256:5c3bdf07ff50f2b23b4c9002819f8eb49c195a3d26b4ad248c8c93e2077cd2d9", untracked_digest: "absent"}
      - {path: "package.json", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:90d0089a54a0405d22270b0b4851d2f94d536eaed0055346565229d9ffcdfdb4", index_digest: "sha256:90d0089a54a0405d22270b0b4851d2f94d536eaed0055346565229d9ffcdfdb4", worktree_digest: "sha256:90d0089a54a0405d22270b0b4851d2f94d536eaed0055346565229d9ffcdfdb4", untracked_digest: "absent"}
      - {path: "src/platform/api/migrations/0015_test_runs.sql", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:868474da7a047425fb8d2d67c68ff0f96a786529417dfdd2c95fcff4e63b5f35", index_digest: "sha256:868474da7a047425fb8d2d67c68ff0f96a786529417dfdd2c95fcff4e63b5f35", worktree_digest: "sha256:868474da7a047425fb8d2d67c68ff0f96a786529417dfdd2c95fcff4e63b5f35", untracked_digest: "absent"}
      - {path: "src/platform/api/migrations/0020_test_run_frontend_contract.sql", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/api/src/modules/replays/routes.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:9b9a8cf716d9d68a9714dfe653f746d9fe62a6a416323786922cf1ff7d8461c6", index_digest: "sha256:9b9a8cf716d9d68a9714dfe653f746d9fe62a6a416323786922cf1ff7d8461c6", worktree_digest: "sha256:9b9a8cf716d9d68a9714dfe653f746d9fe62a6a416323786922cf1ff7d8461c6", untracked_digest: "absent"}
      - {path: "src/platform/api/src/modules/replays/service.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:50be7a68d64dc31676910d7b4276b477e34da0b3937a98787a2a05c790afd8b1", index_digest: "sha256:50be7a68d64dc31676910d7b4276b477e34da0b3937a98787a2a05c790afd8b1", worktree_digest: "sha256:50be7a68d64dc31676910d7b4276b477e34da0b3937a98787a2a05c790afd8b1", untracked_digest: "absent"}
      - {path: "src/platform/api/src/modules/test-runs/routes.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:88e7b4ba7f0949863db904fa48c5b552df8ff3e6382625b4ca3cf28b2fb6a3a6", index_digest: "sha256:88e7b4ba7f0949863db904fa48c5b552df8ff3e6382625b4ca3cf28b2fb6a3a6", worktree_digest: "sha256:88e7b4ba7f0949863db904fa48c5b552df8ff3e6382625b4ca3cf28b2fb6a3a6", untracked_digest: "absent"}
      - {path: "src/platform/api/src/modules/test-runs/service.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:911cd4dd3de6a00031e230729199135bf3ab00089469d4d411f7d467c21e80a1", index_digest: "sha256:911cd4dd3de6a00031e230729199135bf3ab00089469d4d411f7d467c21e80a1", worktree_digest: "sha256:911cd4dd3de6a00031e230729199135bf3ab00089469d4d411f7d467c21e80a1", untracked_digest: "absent"}
      - {path: "src/platform/api/src/runtime/server.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:cbd171beb5d6638ef04e61388d9d4a79a2266cf4f2c76230fff5218844bdc555", index_digest: "sha256:cbd171beb5d6638ef04e61388d9d4a79a2266cf4f2c76230fff5218844bdc555", worktree_digest: "sha256:cbd171beb5d6638ef04e61388d9d4a79a2266cf4f2c76230fff5218844bdc555", untracked_digest: "absent"}
      - {path: "src/platform/api/tests/test-runs.routes.integration.test.ts", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/web/package.json", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:c02085125ee759723d62ed0f11d644fc5ecc960acb8e7d25be122cccb864eead", index_digest: "sha256:c02085125ee759723d62ed0f11d644fc5ecc960acb8e7d25be122cccb864eead", worktree_digest: "sha256:c02085125ee759723d62ed0f11d644fc5ecc960acb8e7d25be122cccb864eead", untracked_digest: "absent"}
      - {path: "src/platform/web/src/app/app-routes.test.tsx", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:c6b3e1912997d5819211c573a68cfa60cbf5367befff6b24881e4ef5060816d4", index_digest: "sha256:c6b3e1912997d5819211c573a68cfa60cbf5367befff6b24881e4ef5060816d4", worktree_digest: "sha256:c6b3e1912997d5819211c573a68cfa60cbf5367befff6b24881e4ef5060816d4", untracked_digest: "absent"}
      - {path: "src/platform/web/src/app/routes.tsx", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:a8ec5b069c2f21fe08cb529eafb5836ba0711c58904ec94c84f291689b4752df", index_digest: "sha256:a8ec5b069c2f21fe08cb529eafb5836ba0711c58904ec94c84f291689b4752df", worktree_digest: "sha256:a8ec5b069c2f21fe08cb529eafb5836ba0711c58904ec94c84f291689b4752df", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/spectator/verify-replay.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:2093c2fa5d2ce570250c52bda83a47a8e29dec9fb259cccb77f90d854d18e7d0", index_digest: "sha256:2093c2fa5d2ce570250c52bda83a47a8e29dec9fb259cccb77f90d854d18e7d0", worktree_digest: "sha256:2093c2fa5d2ce570250c52bda83a47a8e29dec9fb259cccb77f90d854d18e7d0", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/submissions/SubmissionForm.tsx", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:1979b458772c266c9f1cc1059654b7b87644e2e5b2b4300dd0414ecab8115ef5", index_digest: "sha256:1979b458772c266c9f1cc1059654b7b87644e2e5b2b4300dd0414ecab8115ef5", worktree_digest: "sha256:1979b458772c266c9f1cc1059654b7b87644e2e5b2b4300dd0414ecab8115ef5", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/submissions/api.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:10b8aaafbdd88207369145bdda468c5c6d9f7247ecd4c0c45864fea41d39a896", index_digest: "sha256:10b8aaafbdd88207369145bdda468c5c6d9f7247ecd4c0c45864fea41d39a896", worktree_digest: "sha256:10b8aaafbdd88207369145bdda468c5c6d9f7247ecd4c0c45864fea41d39a896", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/test-runs/TestRunReplayPage.tsx", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/test-runs/TestRunsPage.tsx", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/test-runs/api.ts", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/test-runs/test-runs.test.tsx", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/web/src/features/test-runs/test-runs.ui.test.tsx", object_kind: {head: "absent", index: "absent", worktree: "absent", untracked: "absent"}, state: "absent", rename_from: null, rename_to: null, head_digest: "absent", index_digest: "absent", worktree_digest: "absent", untracked_digest: "absent"}
      - {path: "src/platform/web/src/pages/PrivateReplayPage.tsx", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:6e9e8bda1cd0f580b998f8a9cddeb3ac86bae42bddac639f032c62d0149de15d", index_digest: "sha256:6e9e8bda1cd0f580b998f8a9cddeb3ac86bae42bddac639f032c62d0149de15d", worktree_digest: "sha256:6e9e8bda1cd0f580b998f8a9cddeb3ac86bae42bddac639f032c62d0149de15d", untracked_digest: "absent"}
      - {path: "src/platform/web/src/ui/AppNav.test.tsx", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:6a9192affd2cdeac62efa071cca8f7abaceed949f37aab77875c66930acc4919", index_digest: "sha256:6a9192affd2cdeac62efa071cca8f7abaceed949f37aab77875c66930acc4919", worktree_digest: "sha256:6a9192affd2cdeac62efa071cca8f7abaceed949f37aab77875c66930acc4919", untracked_digest: "absent"}
      - {path: "src/platform/web/src/ui/AppNav.tsx", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:3eeb81a3886bd2ef796870ab9d5371ccbf6f8ce350bebc28fac467f976cd86b2", index_digest: "sha256:3eeb81a3886bd2ef796870ab9d5371ccbf6f8ce350bebc28fac467f976cd86b2", worktree_digest: "sha256:3eeb81a3886bd2ef796870ab9d5371ccbf6f8ce350bebc28fac467f976cd86b2", untracked_digest: "absent"}
      - {path: "src/platform/worker/src/run-test-job.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:0955af3225cc3400040ca958449b87c3b6571ae07a83e7fc7046120590ac59c8", index_digest: "sha256:0955af3225cc3400040ca958449b87c3b6571ae07a83e7fc7046120590ac59c8", worktree_digest: "sha256:0955af3225cc3400040ca958449b87c3b6571ae07a83e7fc7046120590ac59c8", untracked_digest: "absent"}
      - {path: "src/platform/worker/src/runtime/server.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:eaf17e7d72f9d960c44e024f9daba6fe9de7bfb03da13d1870d118598892f9e2", index_digest: "sha256:eaf17e7d72f9d960c44e024f9daba6fe9de7bfb03da13d1870d118598892f9e2", worktree_digest: "sha256:eaf17e7d72f9d960c44e024f9daba6fe9de7bfb03da13d1870d118598892f9e2", untracked_digest: "absent"}
      - {path: "src/platform/worker/tests/test-run.integration.test.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:0b0e827c075d7f333d45ecb24ac24ad47156e072f8c2aa2b1d2e8c7929f796a7", index_digest: "sha256:0b0e827c075d7f333d45ecb24ac24ad47156e072f8c2aa2b1d2e8c7929f796a7", worktree_digest: "sha256:0b0e827c075d7f333d45ecb24ac24ad47156e072f8c2aa2b1d2e8c7929f796a7", untracked_digest: "absent"}
      - {path: "tasks/plan.md", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "unstaged", rename_from: null, rename_to: null, head_digest: "sha256:c6825a0084e2e3608b5ed3c9601ca9925aca5789cab3b2f550451623d73347e5", index_digest: "sha256:c6825a0084e2e3608b5ed3c9601ca9925aca5789cab3b2f550451623d73347e5", worktree_digest: "sha256:d77efa92193c616633d10d6cf9573458ec9176e069c7cf916c30aaa368474855", untracked_digest: "absent"}
      - {path: "tasks/todo.md", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "unstaged", rename_from: null, rename_to: null, head_digest: "sha256:2787679665d98a15b6a7b0838f2b5584576cb9826cf6eb2ce4072834bf3fca93", index_digest: "sha256:2787679665d98a15b6a7b0838f2b5584576cb9826cf6eb2ce4072834bf3fca93", worktree_digest: "sha256:6be0e7d387fb4916be4cc3215dd54df675b0c7c66244f4af37844a3ee39261eb", untracked_digest: "absent"}
      - {path: "tests/e2e/local-demo.test.ts", object_kind: {head: "regular", index: "regular", worktree: "regular", untracked: "absent"}, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:4abea450b862f3f3376a6eb34b6389f87c7262c565c5e0fcc5dabf81fe41a17c", index_digest: "sha256:4abea450b862f3f3376a6eb34b6389f87c7262c565c5e0fcc5dabf81fe41a17c", worktree_digest: "sha256:4abea450b862f3f3376a6eb34b6389f87c7262c565c5e0fcc5dabf81fe41a17c", untracked_digest: "absent"}
  primary_symbols:
    - {symbol: "AppNav", file: "src/platform/web/src/ui/AppNav.tsx", lines: "14-83", role: "team menu and active state"}
    - {symbol: "renderAuthenticated", file: "src/platform/web/src/app/routes.tsx", lines: "58-83", role: "team route authorization"}
    - {symbol: "createTestRun", file: "src/platform/api/src/modules/test-runs/service.ts", lines: "127-261", role: "validation, quota and enqueue"}
    - {symbol: "runTestJob", file: "src/platform/worker/src/run-test-job.ts", lines: "74-256", role: "execution, quota start and replay persistence"}
  related_symbols:
    - {symbol: "SubmissionForm", relationship: "established frontend pattern", relevance: "loading/action/error handling"}
    - {symbol: "publicEventLog", relationship: "projection", relevance: "safe replay payload"}
    - {symbol: "verifyReplayResponse", relationship: "frontend integrity gate", relevance: "reuse for test-run replay"}
  execution_path:
    - "Team page loads policy, eligible submissions and first page of runs."
    - "POST validates owner/opponent/quota/idempotency and enqueues one low-priority job."
    - "Worker atomically claims the job, consumes quota, resolves both artifacts and runs the match."
    - "Worker stores verified event log; API projects it to checksummed private SpectatorReplay."
    - "UI polls terminal state and opens the shared ReplayPlayer."
  pdg_constraints:
    - {description: "Quota check and creation must be serialized/atomic.", affected_statements: ["src/platform/api/src/modules/test-runs/service.ts:132", "src/platform/api/src/modules/test-runs/service.ts:138", "src/platform/api/src/modules/test-runs/service.ts:202"], implementation_consequence: "Use DB transaction/lock plus unique idempotency key; UI disable is insufficient."}
    - {description: "Reference-bot absence currently selects self-play.", affected_statements: ["src/platform/worker/src/run-test-job.ts:136", "src/platform/worker/src/run-test-job.ts:137", "src/platform/worker/src/run-test-job.ts:139"], implementation_consequence: "Inject resolver and fail closed when unavailable."}
    - {description: "RUNNING transition precedes execution and failure handling.", affected_statements: ["src/platform/worker/src/run-test-job.ts:98", "src/platform/worker/src/run-test-job.ts:103", "src/platform/worker/src/run-test-job.ts:236"], implementation_consequence: "Combine state claim and one-time quota consumption; preserve refund semantics."}
  architectural_patterns:
    - {pattern: "Strict API parsing", example_location: "src/platform/web/src/features/submissions/api.ts", usage_guidance: "Reject malformed responses and map stable error codes."}
    - {pattern: "Verified replay projection", example_location: "src/platform/api/src/modules/replays/service.ts:227", usage_guidance: "Verify event log then project; return checksum/media headers."}
    - {pattern: "Role route matrix", example_location: "src/platform/web/src/app/app-routes.test.tsx", usage_guidance: "Cover team/admin/public for both new routes."}
  files_to_modify:
    - {file: "src/platform/api/src/modules/test-runs/service.ts", symbols: ["createTestRun", "new policy/start helpers"], intended_change: "Atomic quota/idempotency and UI metadata."}
    - {file: "src/platform/api/src/modules/test-runs/routes.ts", symbols: ["registerTestRunRoutes"], intended_change: "Policy/list/create/replay contract."}
    - {file: "src/platform/worker/src/run-test-job.ts", symbols: ["runTestJob"], intended_change: "Real reference bot, atomic start and event log."}
    - {file: "src/platform/web/src/features/test-runs/*", symbols: ["new feature"], intended_change: "Create/history/replay UI and tests."}
    - {file: "src/platform/web/src/app/routes.tsx", symbols: ["renderAuthenticated"], intended_change: "Team-only routes."}
    - {file: "src/platform/web/src/ui/AppNav.tsx", symbols: ["AppNav"], intended_change: "Dedicated menu item."}
  tests:
    - {file: "src/platform/api/tests/test-runs.routes.integration.test.ts", scenarios: ["atomic idempotency", "quota and pause", "RBAC/privacy", "pagination", "replay integrity"]}
    - {file: "src/platform/worker/tests/test-run.integration.test.ts", scenarios: ["real reference artifact", "atomic claim", "refund boundaries", "event-log persistence"]}
    - {file: "src/platform/web/src/features/test-runs/test-runs.test.tsx", scenarios: ["form/history/polling", "idempotent retry", "errors and replay link"]}
    - {file: "tests/e2e/local-demo.test.ts", scenarios: ["live API to queue to worker to object storage to replay"]}
  verification_commands:
    - "npm test --workspace @ott/platform-api -- test-runs.routes.integration.test.ts"
    - "npm test --workspace @ott/platform-worker -- test-run.integration.test.ts"
    - "npm test --workspace @ott/platform-web -- test-runs AppNav app-routes verify-replay"
    - "npm run typecheck"
    - "npm run build"
    - "npm run test:e2e:demo"
    - "git diff --check"
    - "node .gitnexus/run.cjs detect-changes --scope all --repo ."
  risks:
    - "Concurrent create/start can over-consume quota without DB atomicity."
    - "Replay contract change may have consumers not resolved by the graph."
    - "Reference artifacts must be provisioned and health-checked before UI enablement."
    - "Current worktree contains unrelated user changes that must be preserved."
  assumptions:
    - "Dedicated /team/test-runs UX is accepted; verify with product owner before implementation."
    - "Proposed IDs P3-N09/P3-D11 are free and owners accept them; verify against current tasks/todo.md before branch creation."
    - "A deployable BTC reference artifact/catalog will be supplied; verify object existence/checksum in local-demo and target environment."
  open_questions:
    - "Catalog source: database-managed records or deployment configuration?"
    - "Which active round is selected when multiple round configurations overlap?"
    - "Should queued-but-not-started runs reserve capacity separately from consumed quota?"
  avoid:
    - "Do not implement frontend before backend gates pass."
    - "Do not use self-play as BTC_REFERENCE fallback."
    - "Do not consume quota at request acceptance or rely only on a pre-insert count."
    - "Do not add a second replay renderer or bypass checksum/schema verification."
    - "Do not expose another team's runs, raw object keys, full stderr or internal artifacts."
    - "Do not tick tasks/checkpoints from simulated or mock-only evidence."
    - "Do not overwrite unrelated dirty worktree changes."
```

## 12. Assumptions and Open Questions

### Assumptions

- [assumed] UX dùng page riêng `/team/test-runs`, không nhúng vào trang Nộp bot; owner xác nhận trước implementation.
- [assumed] `P3-N09`/`P3-D11` là ID đề xuất, chưa phải trạng thái/assignment; kiểm tra và phê duyệt tại `tasks/todo.md` trước khi tạo branch.
- [assumed] BTC cung cấp ít nhất một reference artifact có checksum/entrypoint/policy version và có thể seed trong local-demo.

### Open questions requiring owner decision

1. Reference-bot catalog nằm trong DB có migration/seed hay deployment config đọc-only? Khuyến nghị DB/config adapter chung, API chỉ expose ID + display name.
2. Khi nhiều round config overlap, policy endpoint chọn round nào? Khuyến nghị yêu cầu `roundId` rõ ràng hoặc một “current round” duy nhất từ source-of-truth.
3. `QUEUED` có “reserve” quota để tránh nhận quá nhiều job trước start hay không? Khuyến nghị expose riêng `reserved` và `consumed`; hard limit xét `reserved + consumed`, còn statistic “đã dùng” chỉ tăng tại start.
4. Phần stderr tối đa bao nhiêu byte/dòng và retention bao lâu? Phải khóa trong contract trước UI.

## 13. Definition of Done

- Team user thấy mục **Chạy thử bot**; route list/replay đúng RBAC và responsive/keyboard accessible.
- Policy endpoint là nguồn duy nhất cho quota/reset/opponents; default là 2/ngày và admission pause được thể hiện rõ.
- BTC_REFERENCE chạy artifact đối chứng thật; thiếu artifact fail closed, không self-play.
- Hai create đồng thời/retry cùng intent tạo đúng một run/job; quota không over-admit và chỉ consume một lần khi start.
- Own-submission opponent phải khác submission chính, cùng team và eligible; cross-team access không rò dữ liệu.
- Completed run có result + private replay checksummed phát được bằng `ReplayPlayer`; corrupt/incomplete replay không được render.
- API, worker, frontend, typecheck, build và live local E2E đều pass; manual cases có evidence/actual result.
- Contract/demo/manual docs được đồng bộ trong cùng PR; `tasks/todo.md` chỉ tick sau verification và `P3-C` chỉ đóng khi Thuận duyệt.
- `detect-changes --scope all` không còn kết quả partial/truncated chưa xử lý và mọi HIGH/CRITICAL risk (nếu xuất hiện sau implementation) đã được review.
