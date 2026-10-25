# Implementation Plan: Phase 1–3 theo phân công nhóm Dev

**Trạng thái 2026-10-20:** Phase 1 và Phase 2 local `P2-T01`–`P2-T29` hoàn tất; extension `P2-T30`–`P2-T37`/`P2-C` còn mở. Phase 3 có 25/25 task tick nhưng 0/8 checkpoint được duyệt; xem `tasks/todo.md` để biết giới hạn verification.
`P2-T40` bổ sung OCI bot fixtures tương thích preflight v1 và match v2; `P2-T38` dùng chúng để nạp dữ liệu mẫu sau `P2-T35`/`P2-T36`, không thay gate `P2-C`.
**Phê duyệt Phase 3:** D-14–D-30, ADR-0008–0010 và contract baseline được duyệt ngày 14/10/2026
**Người duyệt Gate P3-0:** Đinh Đức Thuận
**Nguồn:** `docs/team-assignment.md`, `docs/tai-lieu-yeu-cau.md`
**Task chi tiết:** `tasks/todo.md`

`tasks/todo.md` là nguồn duy nhất cho trạng thái và dependency task. Nếu phần index trong plan này khác checklist, dừng và sửa hai file trong cùng thay đổi trước khi giao task cho AI.

## 0. Quy tắc phê duyệt tài liệu

- Tài liệu được đánh giá `HIGH RECOMMEND` được Đinh Đức Thuận tự động duyệt.
- Tài liệu mức trung bình, thấp hoặc còn quyết định ảnh hưởng lớn phải chờ duyệt thủ công.
- Tự động duyệt chỉ áp dụng cho tài liệu; không tự động cho phép thao tác phá hủy dữ liệu hoặc bỏ qua checkpoint kỹ thuật. Deploy cloud nằm ngoài phạm vi Phase 2 hiện tại.

## 1. Mục tiêu

Phase 1 phải tạo được một lệnh chạy hai bot Python trên localhost, dùng game core triển khai theo hành vi Human-vs-Human tham chiếu, giao tiếp qua Bot Protocol v1 và xuất kết quả/event log có thể tái hiện.

Phase 2 dùng kết quả Phase 1 để xây luồng nộp bot, queue/worker, sandbox, scheduling, Elo, leaderboard, replay và giao diện web hoàn chỉnh trên local. Từ ngày 2026-10-13, Đinh Đức Thuận là owner duy nhất của toàn bộ Phase 2; deploy cloud không thuộc plan hoặc Definition of Done của phase này.

## 2. Quy ước ID và owner

### 2.1 Cấu trúc Task ID

Task ID dùng mẫu:

```text
P<phase>-<owner><sequence>
```

Ví dụ `P1-L01`:

- `P1`: Phase 1.
- `L`: owner là Long Trần.
- `01`: task thứ nhất của Long trong Phase 1.

Quy tắc:

- `phase` bắt đầu từ `1` và tăng theo giai đoạn triển khai.
- `owner` dùng đúng mã trong bảng bên dưới.
- `sequence` gồm hai chữ số, tăng riêng cho từng owner trong từng phase: `01`, `02`, `03`...
- Task ID đã phát hành không được tái sử dụng cho công việc khác.
- Checkpoint dùng mẫu riêng như `P1-A`, `P1-B`; đây không phải task của một owner.

### 2.2 Mã owner

| Ký hiệu | Owner | Phạm vi |
| --- | --- | --- |
| `T` | Đinh Đức Thuận | Toàn bộ Phase 2 local; decision/ADR/contract gate và checkpoint Phase 3 |
| `L` | Long Trần | Core/Bot Protocol Phase 1; protocol, deterministic domain và public read models Phase 3 |
| `N` | Đỗ Khôi Nguyên | Bot Python Phase 1; sandbox, worker pool, operations readiness và test-run portal API Phase 3 |
| `D` | Phạm Tất Đạt | MatchRunner Phase 1; control plane, privileged workflows và finals sync Phase 3 |

### 2.2.1 Đổi task ID ngày 2026-10-09

Đinh Đức Thuận đổi owner theo lane, sau đó đánh lại task ID để chữ cái khớp owner mới. Đây là ngoại lệ một lần của quy tắc không tái sử dụng ID; mọi tài liệu hiện hành đã dùng ID mới. Gặp ID cũ trong lịch sử chat, commit hoặc `docs/plans/`, tra bảng này:

| ID cũ | ID mới | Lane |
| --- | --- | --- |
| `P1-D01`–`P1-D08` | `P1-L01`–`P1-L08` | Core + protocol (Long) |
| `P1-L01`–`P1-L06` | `P1-N01`–`P1-N06` | Bot Python (Nguyên) |
| `P1-N01` | `P1-D01` (đã hủy) | Workspace, thay bằng `P1-T02` |
| `P1-N02`–`P1-N11` | `P1-D02`–`P1-D11` | Runner + integration (Đạt) |
| `P2-L01` | `P2-N01` | Sandbox corpus (Nguyên) |
| `P2-N01`–`P2-N13` | `P2-D01`–`P2-D13` | Platform (Đạt) |
| — (mới 2026-10-12) | `P2-D14`–`P2-D16` | Replay publication và spectator UI (Đạt) |
| — (mới 2026-10-12) | `P2-D17` | Auth HTTP contract và bootstrap config (Đạt) |
| — (mới 2026-10-12) | `P2-L02`–`P2-L03` | Web shell/login và team submission portal (Long) |
| — (mới 2026-10-12) | `P2-N14`–`P2-N15` | BTC team-account console, results/leaderboard UI (Nguyên) |
| `P2-D01`–`P2-D10`, `P2-D17`, `P2-N01` | `P2-T02`–`P2-T13` | Backend local chuyển cho Thuận; ID cũ hủy, task phát hành lại (2026-10-12) |
| `P2-L02`, `P2-L03`, `P2-N14`, `P2-N15`, `P2-D13`–`P2-D16` | `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29` | Toàn bộ scope Phase 2 còn mở chuyển cho Thuận và được tách lại theo lát nhỏ (2026-10-13) |

Mỗi task chỉ có một owner chính. Người review không sửa trực tiếp vào phạm vi của owner nếu chưa trao đổi.

### 2.3 Branch theo owner

Branch tạo từ `main` theo owner:

| Owner | Prefix | Ví dụ |
| --- | --- | --- |
| Đinh Đức Thuận | `thuandd/` | `thuandd/feat-p2-t01-decisions` |
| Long Trần | `longt/` | `longt/feat-p1-l01-game-baseline` |
| Đỗ Khôi Nguyên | `nguyendk/` | `nguyendk/feat-p1-n01-bot-sdk` |
| Phạm Tất Đạt | `datpt/` | `datpt/feat-p1-d02-ports` |

Mỗi branch chứa đúng một task, pull request target `main`; không code trực tiếp trên `main`. Checkpoint Phase 2 duyệt trên `main`; deploy cloud không nằm trong plan này. `develop` là nhánh legacy, không dùng cho development/integration/deploy. Luồng đầy đủ: [`docs/README.md` mục 3](../docs/README.md).

## 3. Baseline đã khóa

- Node.js 22, TypeScript, Vitest và npm workspaces.
- Source root là `src/`; layout chi tiết tại `src/README.md`.
- Bot dùng Python 3.12.x, entrypoint `bot.py`, spawn trực tiếp bằng argv.
- Phase 1 dùng STDIO/NDJSON, chưa có PostgreSQL, Redis, MinIO hoặc HTTP API.
- `STATE_UPDATE` gửi `legalActions`; Engine vẫn validate lại action.
- Protocol limits và fault policy được khóa tại `docs/contracts/bot-protocol-v1.md`.
- Engine API được khóa tại `docs/contracts/engine-api-v1.md`.
- Không sao chép source tham chiếu chưa có LICENSE; triển khai theo behavior contract và commit đã pin.

## 4. Dependency graph Phase 1

```text
P1-T01 Contract docs/schema đã khóa
    ├── P1-N01 → P1-N02…N05 → P1-N06
    │
    └── P1-L01 → L02 → L03 → L04
                    │       │
                    │       └── P1-L05 → L06 → L07 → L08
                    │
                    └── P1-D02 → D03…D08

Checkpoint P1-B ──► P1-T02 Workspace chung (Thuận)
P1-L08 + P1-D08 + P1-T02 ──► P1-D09 Core integration
P1-D09 + P1-N06 ──► P1-D10 Full local E2E ──► P1-D11 Local handoff
```

## 5. Phase 1 task index

### Gate 0 — Quyết định và workspace

- [x] `P1-T01` — Khóa các quyết định trước khi code — Đinh Đức Thuận.
- `P1-D01` — Đã hủy, chuyển thành `P1-T02` (Thuận, sau Checkpoint `P1-B`).
- [x] `P1-L01` — Triển khai behavior baseline Human-vs-Human — Long Trần.

### Gate 1 — Hiện thực contract đã khóa

- [x] `P1-L02` — Hiện thực Engine API và domain types đã khóa — Long Trần.
- [x] `P1-L03` — Hiện thực message types Bot Protocol v1 đã khóa — Long Trần.
- [x] `P1-L04` — Hiện thực validator và contract tests từ schema/fixtures — Long Trần.

### Lane Long — Core và protocol

- [x] `P1-L05` — API điều khiển game theo side/action.
- [x] `P1-L06` — Skip turn, maxTurns và GameResult.
- [x] `P1-L07` — Event transition và finalStateHash.
- [x] `P1-L08` — Regression test Human-vs-Human và tài liệu core.

### Lane Nguyên — Bot kiểm thử

- [x] `P1-N01` — Python Bot SDK tối thiểu.
- [x] `P1-N02` — FirstLegalBot.
- [x] `P1-N03` — CaptureFirstBot.
- [x] `P1-N04` — Bot lỗi JSON/action/turnId.
- [x] `P1-N05` — Bot timeout/crash/oversize.
- [x] `P1-N06` — Contract test và README bot.

### Lane Đạt — Runner và tích hợp local

- [x] `P1-D02` — GamePort, BotPort và fakes.
- [x] `P1-D03` — MatchRunner happy path.
- [x] `P1-D04` — MatchRunner error/skip/cleanup.
- [x] `P1-D05` — BotProcess NDJSON adapter.
- [x] `P1-D06` — BotProcess timeout và process cleanup.
- [x] `P1-D07` — Event log và replay verifier.
- [x] `P1-D08` — CLI chạy trận.
- [x] `P1-T02` — Gộp workspace chung — Đinh Đức Thuận, sau Checkpoint `P1-B`.
- [x] `P1-D09` — Tích hợp core thật với MatchRunner.
- [x] `P1-D10` — E2E hai bot và các bot lỗi.
- [x] `P1-D11` — Runbook và bàn giao local.

## 6. Checkpoint Phase 1

### Checkpoint P1-A — Executable contract baseline

Điều kiện:

- `P1-T01`, `P1-L01`–`P1-L04`, `P1-N01` và `P1-D02` hoàn tất.
- Python SDK và MatchRunner ports cùng dùng contract/schema/fixtures chính thức, không tạo bản protocol riêng.
- Sau checkpoint, thay đổi message/schema/error code phải do Long cập nhật và có review của Nguyên, Đạt.

### Checkpoint P1-B — Ba lane chạy độc lập

Điều kiện:

- Long hoàn tất `P1-L05` đến `P1-L08`.
- Nguyên hoàn tất `P1-N01` đến `P1-N06`.
- Đạt hoàn tất `P1-D02` đến `P1-D08`.
- Unit và contract tests của từng lane chạy độc lập trên localhost.

### Checkpoint P1-C — Phase 1 complete

Điều kiện:

- `P1-D09` đến `P1-D11` hoàn tất.
- Hai bot hợp lệ chơi hết một trận.
- JSON sai, illegal action, wrong turnId, timeout, crash và oversized output đều có automated evidence.
- Chạy lại cùng input cho cùng event sequence và `finalStateHash`.
- Full typecheck, test và build pass trước khi bắt đầu Phase 2.

## 7. Dependency graph Phase 2

`P2-T01` đã chốt architecture baseline, authentication, replay, rating, qualification series và OCI artifact policy tại [Solution Architecture Phase 2](../docs/architecture/solution-architecture-phase-2.md) và [SAD OCI](../docs/architecture/sad-oci-bot-submissions.md). Baseline quota đủ để code/test local; `P2-T15` là cổng benchmark bắt buộc để xác nhận quota công bố và mở nhận submission của đội thi.

```text
Phase 1 complete
    ├── P2-T01 Khóa quota/Elo/series/OCI decisions ──► P2-T14, P2-T08, P2-T09, P2-T12
    └── P2-T02 Local Docker services ──► P2-T03 Database → P2-T04 Auth/RBAC

    P2-T14 OCI contract/layout validator ──┬──► P2-T07 OCI submission
    P2-T04 Auth/RBAC ──┬──► P2-T06 Team + credential API ────────────────┘
                                         └──► P2-T05 Auth contract
    P2-T14 → P2-T08 OCI canary/security corpus ──┐
    P2-T07 → P2-T09 Worker ──────────────────────┴──► P2-T10 OCI sandbox ✅ → P2-T11 Finalization → P2-T12 Scheduling ─┬─► P2-T13A Elo ledger ✅ → P2-T13B Leaderboard API ✅ ─┐
                                                                                                                      └─► P2-T13C Results API ✅
    P2-T08 + P2-T10 ✅ ───────────────────────────────► P2-T15 Quota benchmark / registration gate

    P2-T16 Ownership/execution rebaseline
      ├──► P2-T17A…T17B Web foundation ──► P2-T18 Auth UI ─┬──► P2-T19 BTC team console
      │                                               ├──► P2-T20 Team submission
      ├──► P2-T18 + P2-T13C ──────────────────────────────► P2-T21 Results UI
      ├──► P2-T17B + P2-T13B ────────────────────────────► P2-T22 Leaderboard UI
      └──► P2-T23 Replay persistence ──► P2-T24 Replay HTTP/integrity
                                           ├──► P2-T25 BTC replay console
                                           └──► P2-T26 Spectator client ──► P2-T27 Replay player

    P2-T19…T27 + P2-T15 ──► P2-T28 E2E harness ──► P2-T29 Qualification full flow
```

## 8. Phase 2 task index

- [x] `P2-T01` — Khóa quyết định triển khai Phase 2 local.
- [x] `P2-T02` — Docker Compose PostgreSQL/Redis/SeaweedFS.
- [x] `P2-T03` — Database schema và migration foundation.
- [x] `P2-T14` — OCI submission contract và layout validator.
- [x] `P2-T04` — Authentication và RBAC foundation.
- [x] `P2-T05` — Auth HTTP contract và local bootstrap config.
- [x] `P2-T06` — Team management vertical slice.
- [x] `P2-T07` — OCI submission upload và S3-compatible storage vertical slice.
- [x] `P2-T08` — OCI canary bot và sandbox security corpus.
- [x] `P2-T09` — MatchJob và BullMQ worker.
- [x] `P2-T10` — Sandbox adapter và artifact validation; Docker API integration 13/13 pass (2026-10-13).
- [x] `P2-T15` — Benchmark quota OCI và gate mở nhận bot đa ngôn ngữ; local benchmark pass 14/14, D-08 remains internal baseline and team registration gated pending representative repeated benchmark + BTC approval (2026-10-13).
- [x] `P2-T11` — MatchResult finalization idempotent; PostgreSQL integration 5/5 and worker retry integration 4/4 pass, execution snapshot immutable and results/events/outbox commit idempotently (2026-10-13).
- [x] `P2-T12` — Deterministic round pairing, swapped BO2 matches, outbox dispatch và terminal series scoring; PostgreSQL integration + logic 11/11 pass (2026-10-13).
- [x] `P2-T13` — Nhóm Elo ledger, results và leaderboard API:
  - [x] `P2-T13A` — Elo calculation, round ledger và rebuild verification; PostgreSQL rating/scheduling integration 4/4 pass.
  - [x] `P2-T13B` — Leaderboard API; PostgreSQL integration 2/2, exact ties được giữ đồng hạng đến khi BTC xử lý (phụ thuộc T13A).
  - [x] `P2-T13C` — Match/series results API với RBAC; PostgreSQL + Redis integration 2/2 pass.
- `P2-D11` — Đã hủy, tách thành `P2-L02` và `P2-L03`.
- `P2-D12` — Đã hủy, tách thành `P2-N15`.
- `P2-L02`, `P2-L03`, `P2-N14`, `P2-N15`, `P2-D13`–`P2-D16` — Đã hủy và phát hành lại cho Thuận; không tái sử dụng.
- [x] `P2-T16` — Rebaseline ownership và execution loop Phase 2.
- [x] `P2-T17A` — React/Vite workspace package foundation; clean install, root tests/typecheck/build pass (2026-10-13).
- [x] `P2-T17B` — React/Vite app shell và component test harness; component + root checks/build and local HTTP smoke pass (2026-10-13).
- [x] `P2-T18` — Login, session restore và role authorization UI; auth suite 9/9, shell test/typecheck/build pass (2026-10-13).
- [x] `P2-T19` — BTC team-account provisioning console; component/API-client suite 10/10, workspace checks/build pass (2026-10-13).
- [x] `P2-T20` — Team OCI submission portal with paginated, session-team-scoped submission history; web 32/32, API 17 pass + 17 service-gated skips, root tests/typecheck/build pass (2026-10-13).
- [x] `P2-T21` — Team/BTC match/series results UI; fault summaries persisted MatchRunner → PostgreSQL → API and rendered with server-scoped filters; root checks and isolated PostgreSQL/Redis integration 7/7 pass (2026-10-13).
- [x] `P2-T22` — Anonymous responsive leaderboard UI; presents server rank/tie-break unchanged, stage/page filtering and accessible loading/empty/error states; focused 4/4, root 44 web tests, typecheck/build pass (2026-10-13).
- [x] `P2-T23` — Replay publication persistence và catalog repository; isolated PostgreSQL integration 5/5, migration 0006, immutable state/identity/audit and idempotency verified (2026-10-13).
- [x] `P2-T24` — BTC catalog/stage/publish and anonymous seed-free public replay API; isolated PostgreSQL/Redis/SeaweedFS integration 1/1, root tests/typecheck/build pass (2026-10-13).
- [x] `P2-T25` — BTC replay catalog và publication console; replay-admin UI 5/5, web suite 49/49, typecheck/build pass (2026-10-13).
- [x] `P2-T26` — Spectator replay client và integrity verification; 10 focused tests, full web 59/59, root tests/typecheck/build pass (2026-10-13).
- [x] `P2-T27` — Spectator replay player và presentation page; verified public route, read-only event projection, accessible controls/board, web 64/64 và root tests/typecheck/build pass; Vite route smoke HTTP 200 (2026-10-13).
- [x] `P2-T28` — Qualification E2E harness và deterministic fixtures; isolated Compose PostgreSQL/Redis/SeaweedFS, migrations + 2 canary submissions, hai lượt liên tiếp 4/4 và teardown sạch (2026-10-13).
- [x] `P2-T29` — Qualification full-flow E2E/local handoff; BTC provisioning → team auth/upload → real OCI sandbox preflight → BullMQ/worker/finalization → series/Elo/results → replay publish/tamper rejection/client timeline, retry idempotency verified (2026-10-13).

## 9. Phase 2 local và demo runtime extension

Thuận là owner của `P2-T01`–`P2-T37`. Phạm vi `P2-T01`–`P2-T29` và Checkpoint `P2-B` đã hoàn tất sau qualification, root gates và detached clean-worktree verification pass (`404195f`, 2026-10-13). Extension `P2-T30`–`P2-T37`/`P2-C` vẫn mở; source `main` đã có runtime/Compose/demo nhưng cần đối chiếu acceptance và clean-checkout browser verification. Deploy cloud không nằm trong Definition of Done. Không mở nhiều branch chạm chung `src/platform/web` hoặc replay schema trong cùng lúc.

1. Hạ tầng local và database.
2. Authentication/RBAC, team và submission.
3. Queue/worker/sandbox.
4. Result finalization, scheduling và Elo.
5. Web shell/login, team portal, BTC credential console, results UI và replay UI.
6. Qualification E2E.

Baseline Phase 2 local kết thúc tại qualification E2E và runbook; extension demo runtime có gate riêng `P2-C`. Không thêm CI/CD, cloud infrastructure, production credential hoặc deploy stage vào các task `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29`.

### Extension `P2-T30`–`P2-T37` — còn mở tại `main` ngày 2026-10-20

```text
P2-T29 ──► P2-T30 API host ─────┐
       └─► P2-T31 worker host ──┼─► P2-T32 coordinator
                                └─► P2-T33 Docker images
P2-T32 + P2-T33 ──► P2-T34 Compose ──► P2-T35 demo accounts
P2-T34 + P2-T35 ──► P2-T36 demo commands ──► P2-T37 clean-checkout browser flow ──► P2-C
```

Các entrypoint, Dockerfiles, Compose và `scripts/demo.sh` đã có trên `main`; trạng thái tám task vẫn `[ ]` trong `tasks/todo.md` vì chưa có đối chiếu acceptance theo từng card và clean-checkout browser/restart gate. Root `npm test` ngày 2026-10-20 bị chặn ở worker BullMQ integration do Redis `127.0.0.1:16379` không chạy.

### Giao diện bàn cờ replay OTTv2

`P2-T27` tạo replay player; `P2-T39` kiểm tra trình chiếu fullscreen, còn `P2-T41` đồng bộ riêng bàn cờ/quân cờ với giao diện [OTTv2 mẫu tại commit `2956f16`](https://github.com/sock1000kg/rock-paper-scissor/tree/2956f1601365274eb34d623a9c908900bf43baab). `P2-T41` dùng frame/map replay đã xác minh, không phụ thuộc dữ liệu mẫu `P2-T38` hoặc cổng runtime `P2-C`. Thứ tự và điểm review được viết trong [plan triển khai P2-T41](../docs/plans/2026-10-22-replay-board-visual-parity.md). Task ID, dependency và trạng thái ở [`tasks/todo.md`](todo.md); phạm vi đợt này là bàn cờ/quân cờ.

### Làm lại frontend và hai mode sáng/tối

Theo yêu cầu mới, `P2-T42`–`P2-T53` làm lại giao diện React/Vite cho khách, đội và BTC. `P2-T54` tiếp tục tinh chỉnh bàn cờ replay để màu nền đi theo theme. Kế hoạch kỹ thuật, ma trận Chrome DevTools MCP và checkpoint ở [plan frontend dual theme](../docs/plans/2026-10-22-frontend-redesign-dual-theme.md); trạng thái task duy nhất ở [`tasks/todo.md`](todo.md). Không đổi API, quyền hay dữ liệu trong đợt giao diện này.

```text
P2-T42 baseline/thiết kế → P2-T43 theme core → P2-T44 toggle → P2-T45 shell/login/home → CP-UI-A
                                                                  ├→ P2-T46 public/leaderboard → P2-T47 finals
                                                                  ├→ P2-T48 replay → CP-UI-B
                                                                  ├→ P2-T49 team ─────────────────────────────┐
                                                                  ├→ P2-T50 BTC teams/replays                  ├→ P2-T53 browser gate
                                                                  ├→ P2-T51 BTC rounds                        │
                                                                  └→ P2-T52 BTC operations/results ◄─────────┘
                                                                                   CP-UI-C trước T53
```

Chrome DevTools MCP chưa có trong phiên lập plan; T42 kiểm tra/cấu hình trước khi chụp baseline, T53 chỉ đạt khi ma trận browser thực chạy được. Các task đang mở khác và checkpoint cũ giữ nguyên trạng thái. Mỗi task code dùng branch riêng từ `main`; `P2-T49` và `P2-T52` sửa `results.css` tuần tự.

### Đổi mật khẩu đội, reset account demo và login routing

`P2-T55` cập nhật auth requirement/ADR/contracts cho đổi password đã xác thực và chốt chính sách reset demo. `P2-T56`–`P2-T57` triển khai API/UI đổi password; `P2-T58`–`P2-T59` tạo lệnh và lịch reset account demo, sau dependency `P2-T35`; `P2-T60` sửa route sau login theo principal. Job chỉ local/test, opt-in, username allowlist tường minh, mặc định 03:00 `Asia/Ho_Chi_Minh`, public mode bị từ chối. `P2-T55`–`P2-T60` có checkpoint auth và browser/E2E cuối trong checklist. Đây là thay đổi auth độc lập, không thuộc redesign UI `P2-T42`–`P2-T54`.

### Demo snapshot đầy đủ và cron khôi phục mỗi giờ

`P2-T61`–`P2-T64` mở rộng demo reset từ đổi mật khẩu thành khôi phục một baseline hoàn chỉnh. Baseline là bundle bất biến gồm PostgreSQL, SeaweedFS (OCI/replay), public snapshots và manifest SHA-256; Redis không được coi là nguồn dữ liệu và phải được làm sạch sau restore. Snapshot chứa dữ liệu lịch sử mẫu đã xác minh cho `btc`, `team01`, `team02`, `team03`, `team04`; file credential plaintext không nằm trong bundle hoặc Git.

```text
P2-T35 + P2-T38 + P2-T58
             │
             └──► P2-T61 tạo/kiểm định baseline bundle
                           │
                           └──► P2-T62 demo.sh restore-demo
                                         │
                                         └──► P2-T63 OS crontab mỗi giờ
                                                       │
                                                       └──► P2-T64 deploy + browser/restore drill ──► P2-F
```

Restore dừng các process ghi dữ liệu, kiểm checksum trước khi thay đổi state, khôi phục sạch DB/storage/snapshot, reset đúng bốn mật khẩu đội qua command `P2-T58`, xóa session/queue Redis rồi mới mở lại stack. Cron chạy trên OS bằng user vận hành riêng, dùng `flock`, đường dẫn tuyệt đối, timeout và log không chứa secret; scheduler container của `P2-T59` giữ disabled để tránh hai lịch chạy đồng thời. Chỉ bật crontab sau khi một restore drill thủ công pass và snapshot nguồn được giữ nguyên để rollback.

Mỗi task dùng branch riêng từ `main`. Bundle baseline và credential là artifact root-only trên server, không commit. `P2-T64` lưu evidence không nhạy cảm gồm checksum ID, row/object counts, health, login và browser flow trước/sau hai chu kỳ; không lưu dump, token, password hoặc nội dung replay private trong repo.

### Gói tài nguyên bot tải công khai

`P2-T65` bổ sung static ZIP có version vào trang public, lấy nội dung từ protocol/schema/fixture và bot mẫu đã khóa; giới hạn theo round tiếp tục đọc từ bộ luật hiện hành. Gói được kiểm tra độc lập, không phụ thuộc public snapshot hoặc session. Manual browser smoke và trạng thái task nằm tại [`tasks/todo.md`](todo.md).

## 10. Rủi ro

| Rủi ro | Mức độ | Giảm thiểu |
| --- | --- | --- |
| Source tham chiếu chưa có LICENSE | Cao | Chỉ đối chiếu behavior; không copy/submodule/package source |
| Protocol đổi khi ba lane đang code | Cao | Contract docs/schema khóa tại `P1-T01`; executable baseline tại `P1-L04`; Long là owner duy nhất |
| Nguyên hoặc Đạt phải chờ implementation của Long | Trung bình | Dùng JSON fixtures, `FakeGame` và `ScriptedBot` |
| Child process treo/rò rỉ | Cao | Cleanup trong `finally`, timeout monotonic, test còn PID/open handle |
| Một owner xử lý toàn bộ Phase 2 còn lại | Cao | Task S/M, một branch/task, checkpoint sau từng cụm và full gate tại `P2-T29` |
| Task vượt 5 file | Trung bình | Tách task trước khi bắt đầu; không mở rộng scope trong cùng PR |
| Snapshot chỉ có DB nên replay bị thiếu | Cao | Bundle PostgreSQL + SeaweedFS + public snapshots; manifest ghi checksum/count và restore drill kiểm replay |
| Cron chạy khi restore trước chưa xong | Cao | OS `flock` + timeout; duplicate trigger thoát an toàn và ghi trạng thái không chứa secret |
| Restore lỗi giữa chừng làm demo không nhất quán | Cao | Verify bundle trước, dừng writer, backup recovery trước lần deploy đầu, post-restore invariants trước khi mở gateway |
| Hai scheduler cùng reset dữ liệu | Cao | Không bật profile scheduler `P2-T59`; OS crontab là scheduler duy nhất cho full snapshot restore |

## 11. Open questions chuyển sang Gate P3-0

- Qualification seed/tie-break và eligibility đã khóa tại `P3-T01`; UI không tự đặt luật phụ.
- Finals không được vá vào task Phase 2 đã đóng; triển khai theo Finals Format v1 trong Wave 7–8.

## 12. Plan verification và approval status

- [x] Mỗi task có owner.
- [x] Task chi tiết có acceptance criteria, verification, dependency và file dự kiến trong `tasks/todo.md`.
- [x] Mỗi implementation task Phase 3 dự kiến là một lát S/M và có tối đa khoảng 5 file chính; task rehearsal có thể kèm external evidence.
- [x] Có gate quyết định, checkpoint sau từng wave, gate qualification và hai checkpoint finals.
- [x] Phase 3 được tích hợp vào plan hiện hành nhưng giữ trạng thái riêng, không làm sai lịch sử hoàn tất Phase 1–2.
- [x] Gate `P3-0`/`P3-T01` đã duyệt requirement/ADR/contract. Tại `main` ngày 2026-10-20, 25/25 task Phase 3 đã tick trong checklist; 8 checkpoint vẫn mở và chỉ Thuận quyết định nghiệm thu.

## 13. Review coverage sau Phase 2

Review ngày 14/10/2026 đối chiếu đặc tả v0.5, `tasks/todo.md`, source/test và Checkpoint `P2-B` cho kết luận:

| Nhóm requirement | Trạng thái sau Phase 2 | Bằng chứng/thiếu hụt | Xử lý trong Phase 3 |
| --- | --- | --- | --- |
| Baseline Phase 2 tại mục 19: auth/RBAC, team/submission OCI, sandbox, BullMQ worker, scheduling/BO2, Elo, leaderboard, replay stage/publish và spectator UI local | Hoàn tất theo phạm vi đã duyệt | `P2-T01`–`P2-T29` và `P2-B` đã có test/E2E local; chưa phải hosted PoC | Giữ artifact v1 cho regression; triển khai version mới ở Phase 3 |
| Vòng đời tournament/round và công cụ vận hành tại mục 5, 14 | Một phần | Có scheduling/finalization theo `tournament_stage`, nhưng chưa có `Tournament`, `RoundRuleSet`, state machine tuần, start/pause/resume/publish, queue console và audit workflow đầy đủ | `P3-D01`, `P3-D02`, `P3-N02` |
| Test match trước cutoff tại mục 8.4 | Chưa làm | Không có model/API/worker flow `TestRun`; qualification E2E hiện chỉ kiểm tra official flow | `P3-N03` |
| Hosted PoC: metrics/cảnh báo, backup/restore, adaptive worker admission và smoke/load trên server lab | Chưa đủ | P2 có local benchmark và retry/idempotency; chưa có `memory.peak`, hosted security gate, backup ngoài server hoặc evidence AC-13/14/19 | `P3-N01`, `P3-N02`, `P3-N05`, `P3-N06` |
| Replay vòng loại | Chưa làm policy mới | Dự án chưa public/deploy nên không có replay cũ cần migration; Phase 3 phải áp dụng team-private từ dữ liệu đầu tiên | `P3-D05`, `P3-L04`, `P3-L05` |
| Nội dung v0.5 của Giai đoạn 2B | Requirement đã duyệt, implementation chưa làm | D-14–D-30 và ADR/contract baseline đã khóa tại `P3-T01` ngày 14/10/2026 | Các Wave 1–6 |
| Chung kết cũ: seed lock, bracket/BO3/map pool và AC-09 | Chưa làm | Mục 19 đặt ở Giai đoạn 3; không có model/API/UI finals trong source | `P3-L06`, `P3-D08`–`P3-D10` |
| Chung kết v0.5: bracket 8 đội qua LAN và signed ResultBundle/AC-20 | Chưa làm | Finals Format v1 và ResultBundle v1 đã khóa; chưa có domain/API/UI/LAN implementation | `P3-L06`, `P3-D08`–`P3-D10`, `P3-N07`–`P3-N08` |

Không coi các requirement v0.5 là lỗi của Checkpoint `P2-B`: chúng được thêm sau khi Phase 2 local đã đóng và tài liệu tự ghi rõ “chưa được triển khai”. Phase 3 trong plan này gộp **Phase 2B carry-over** với **finals mới**, nhưng vẫn giữ hai checkpoint nghiệm thu độc lập.

## 14. Mục tiêu và ranh giới Phase 3

Phase 3 được chia thành hai release gate:

1. **P3-2B — Qualification hosted PoC-ready:** đưa luồng Phase 2 local lên mô hình round theo tuần có luật version hóa, Protocol v2, ưu tiên hàng đợi, test run, upload chống dồn, public snapshot, hardening, observability và bằng chứng trên một server lab.
2. **P3-F — Finals offline-ready:** triển khai bracket 8 đội qua LAN, pin submission finals, xuất/nhập gói kết quả có chữ ký và công bố bracket/replay sau đồng bộ.

Đinh Đức Thuận chỉ sở hữu quyết định, review và checkpoint. Implementation được giao cho ba thành viên còn lại:

| Owner | Lane Phase 3 | Số task implementation |
| --- | --- | ---: |
| Long Trần (`P3-L*`) | Protocol/runtime timing, rating eligibility, replay/public site và finals domain | 6 |
| Đỗ Khôi Nguyên (`P3-N*`) | Sandbox/worker, test run, OCI lifecycle, observability/load, LAN rehearsal và portal API | 9 |
| Phạm Tất Đạt (`P3-D*`) | Control plane/API/admin/auth, privileged operations, upload, result bundle và finals UI | 10 |

## 15. Gate P3-0 — đã duyệt

`P3-T01` là task tài liệu/quyết định do Đinh Đức Thuận duyệt ngày 14/10/2026, không phải task implementation. Gate đã:

- duyệt hoặc loại khỏi scope từng D-14–D-30;
- giải quyết đúng cặp nguồn mâu thuẫn đã ghi ở mục 20.1, đặc biệt Protocol v1/ADR-0002 với D-15/D-27, D-03 với D-22, D-13/Platform Auth v1 với D-20/D-28, và bracket cũ với D-23;
- chốt 8 đội/no-group/single-elimination BO3, unique seed/tie-break, game adapter scoring, finals cap và bronze match;
- xác nhận qualification replay private từ dữ liệu đầu tiên; dự án chưa public nên không có migration hồi tố;
- cập nhật ADR/contract trước khi các task implementation phụ thuộc được phép bắt đầu.

## 16. Dependency graph Phase 3

```text
P3-T01 Decision/contract gate
   ├── P3-L01 Protocol v2 ──► P3-L02 timing runtime
   ├── P3-D01 RoundRuleSet/lifecycle ──► P3-D02 admin UI
   └── P3-N01 resource metrics ────────► P3-N02 single-host admission/priority

P3-D01 + P3-N02 ──► P3-D03 upload reservation ──► P3-N04 OCI lifecycle
P3-D01 + P3-N02 + P3-L02 ──► P3-N03 test run
P3-N03 + P3-N02 + P3-L02 ──► P3-N09 test-run portal API contract/atomic quota/replay integrity
P3-T01 ──► P3-D04 bulk accounts

P3-D01 ──► P3-L03 eligibility/Elo
P3-T01 ──► P3-D05 replay authorization ──► P3-L04 move-list player
P3-D01 + P3-N02 + P3-L03 + P3-D05 ──► P3-L05 static public site
P3-D04 ──► P3-D06 auth hardening
P3-N01 + P3-N02 + P3-D06 ──► P3-N05 operations hardening
P3-D01 + P3-N02 + P3-N04 ──► P3-D07 privileged operations/incident cases
all P3-2B slices ──► P3-N06 single-server smoke/load pilot ──► Checkpoint P3-2B

Checkpoint P3-2B + P3-T01 ──► P3-L06 finals domain
P3-L06 + P3-D01 + P3-D03 ──► P3-D08 finals control/LAN submission
P3-D08 + P3-N05 ──► P3-N07 LAN deployment/recovery
P3-D08 + P3-N07 ──► P3-D09 signed ResultBundle
P3-D09 + P3-L05 + P3-L06 ──► P3-D10 finals public UI
P3-D09 + P3-D10 + P3-N07 ──► P3-N08 event rehearsal ──► Checkpoint P3-F
P3-N09 test-run API contract ──► P3-D11 team test-run portal and replay
P3-D01 + P3-D03 + migration 0021 round cancel ──► P3-T02 round recovery reconciliation ──► Checkpoint P3-C
```

## 17. Phase 3 task index và checkpoint

### Gate P3-0 — Approval

- [x] `P3-T01` — Khóa quyết định, ADR và contract Phase 3 — Đinh Đức Thuận (14/10/2026).

### Wave 1 — Contract và foundation

- [x] `P3-L01` — Bot Protocol v2: time budget và private seed — Long Trần.
- [x] `P3-D01` — `RoundRuleSet` và lifecycle round version hóa — Phạm Tất Đạt.
- [x] `P3-N01` — Resource profile, cgroup peak và Prometheus metrics — Đỗ Khôi Nguyên.

### Checkpoint P3-A — Contract foundation

- [ ] Contract/ADR đã duyệt; migrations, protocol fixtures và resource metrics focused tests pass.

### Wave 2 — Runtime và vận hành round

- [x] `P3-L02` — Chess-clock/dynamic timing trong MatchRunner và replay — Long Trần.
- [x] `P3-N02` — Priority queue, worker heartbeat/capacity và pause/resume — Đỗ Khôi Nguyên.
- [x] `P3-D02` — Admin round-rule và operations console — Phạm Tất Đạt.

### Checkpoint P3-B — Round có thể khóa và chạy

- [ ] Round chỉ start sau khi submission đóng; pause/resume không mất hoặc duplicate job; rule đang chạy bất biến.

### Wave 3 — Submission và test run ở quy mô lớn

- [ ] `P3-T02` — Đồng bộ round recovery, submission cancellation race và demo submission window — Đinh Đức Thuận.
- [x] `P3-D03` — Hash reservation, upload throttling và preflight queue visibility — Phạm Tất Đạt.
- [x] `P3-D04` — CSV team provisioning và credential file tải một lần — Phạm Tất Đạt.
- [x] `P3-N03` — Test-run quota, opponent policy và private artifacts — Đỗ Khôi Nguyên.
- [ ] `P3-N09` — Team portal test-run policy, admission atomicity và verified replay — Đỗ Khôi Nguyên.

### Checkpoint P3-C — Participant workflows

- [ ] AC-15/21 focused tests pass; credential plaintext không tồn tại sau response/download và không vào log/audit.

### Wave 4 — OCI lifecycle, ranking và replay privacy

- [x] `P3-N04` — OCI layer dedup, retention, base image và duplicate flag — Đỗ Khôi Nguyên.
- [x] `P3-L03` — Qualification gate, adaptive K và minimum-series eligibility — Long Trần.
- [x] `P3-D05` — Qualification replay authorization từ dữ liệu đầu tiên — Phạm Tất Đạt.

### Checkpoint P3-D — Fairness/data policy

- [ ] Duplicate digest được flag; rating rebuild deterministic; anonymous không đọc replay vòng loại.

### Wave 5 — Public experience và authentication hardening

- [x] `P3-L04` — Replay move list, seek và historical-version compatibility — Long Trần.
- [x] `P3-L05` — Static public snapshots, queue/results/rules/status site — Long Trần.
- [x] `P3-D06` — TOTP, admin network allowlist, rate/security headers và hosted startup guard — Phạm Tất Đạt.

### Checkpoint P3-E — Public/security boundary

- [ ] AC-14/17/18/22/23 focused evidence pass; public traffic không chạm execution plane.

### Wave 6 — Operations readiness

- [x] `P3-N05` — Metrics/alerts, backup-restore và incident runbooks — Đỗ Khôi Nguyên.
- [x] `P3-D07` — Privileged operations, audit và round results hash (D27: appeals ngoài nền tảng) — Phạm Tất Đạt.
- [x] `P3-N06` — Single-server smoke/load và pilot qualification round — Đỗ Khôi Nguyên.

### Checkpoint P3-2B — Qualification hosted PoC-ready

- [ ] AC-13–AC-19 và AC-21–AC-23 pass hoặc có biên bản BTC duyệt; report ghi số đo server lab, không suy rộng production.
- [ ] Pilot round hoàn tất; backup/restore và worker/server restart recovery đã diễn tập.
- [ ] Đinh Đức Thuận duyệt checkpoint trước khi bắt đầu finals implementation.

### Wave 7 — Finals domain và LAN control plane

- [x] `P3-L06` — Finals 8-team bracket/BO3/game-adapter scoring — Long Trần.
- [x] `P3-D08` — Finals control plane, seeding và LAN submission cutoff — Phạm Tất Đạt.
- [x] `P3-N07` — Isolated LAN deployment và single-server local recovery — Đỗ Khôi Nguyên.

### Checkpoint P3-F1 — Finals chạy hoàn toàn trong LAN

- [ ] Submission finals được pin; schedule/scoring deterministic; restore/retry lỗi hạ tầng không làm sai kết quả.

### Wave 8 — Result sync và trình diễn

- [x] `P3-D09` — Signed `ResultBundle` export/import idempotent — Phạm Tất Đạt.
- [x] `P3-D10` — Finals bracket, schedule/results và verified replay public UI — Phạm Tất Đạt.
- [x] `P3-N08` — Full event rehearsal, tamper/recovery và handoff — Đỗ Khôi Nguyên.

### Checkpoint P3-F — Phase 3 hoàn tất

- [ ] AC-09 và AC-20 pass; full event rehearsal và rollback/recovery evidence được lưu.
- [ ] Root test/typecheck/build, security scan và docs sync pass từ clean checkout.
- [ ] Đinh Đức Thuận duyệt; deploy chỉ thực hiện khi có yêu cầu riêng.

### Integration follow-up P3-T02 — port hai commit demo về `main`

Mục tiêu là tái hiện behavior đã chạy trên `jump-jits` từ `96082f3` và `ee9b1f4` trên nền `main` hiện tại. Không cherry-pick nguyên commit cũ: `main` đã có migration `0021_round_cancel.sql`, API/UI cancel và nhiều thay đổi demo mới hơn. Implementation phải giữ migration và round state machine hiện tại, chỉ port phần còn thiếu.

#### Quyết định tích hợp

- Không tạo migration `0021` thứ hai và không thay thế `cancel_reason`, validation hoặc UI cancel đang có trên `main`.
- Upload chỉ được commit khi round vẫn `SUBMISSION_OPEN`; transaction giữ shared row lock để serialize với cancel/close đang giữ row lock độc quyền.
- `round open` không tái sử dụng ruleset đã hết deadline. Nó tạo version immutable mới, chỉ thay `schedule`, giữ nguyên map, resource, time control và `testRun.opponents` hiện hành.
- Giữ các thay đổi public demo, account sync, editorial/finals seed và sample bot hiện có trên `main`; không lấy diff xóa/revert từ branch cũ.

#### Thứ tự thực hiện

1. **Slice A — API submission commit atomically với lifecycle round (M, 2–3 files).** Viết regression test tái hiện cancel/close sau object upload nhưng trước DB insert; thêm kiểm tra `SUBMISSION_OPEN ... FOR SHARE` trong transaction; trả `409 SUBMISSION_NOT_OPEN`, dọn object mới và không hoàn tất reservation. Đồng bộ `createdAt` cho response upload mới/idempotent theo client contract.
2. **Slice B — BTC CLI hủy round theo API hiện tại (M, 3–4 files).** Bổ sung `demo.sh round cancel`, selector chỉ nhận `DRAFT_RULES`/`SUBMISSION_OPEN`/`SUBMISSION_CLOSED`, confirmation và error/recovery text; dùng endpoint/reason validation đã có trên `main`. Không đổi migration/service/UI cancel.
3. **Checkpoint A/B.** API focused tests, demo guard tests, Bash syntax và PostgreSQL integration pass; xác nhận cancel giữ submissions/audit và tạo được round thay thế.
4. **Slice C — ruleset version mới cho submission window hết hạn (M, 3–4 files).** Sửa default schedule thành đang mở với deadline tương lai; parse timezone fail-closed; khi ruleset mới nhất hết hạn, clone rules immutable và chỉ refresh schedule. Round đang `SUBMISSION_OPEN` nhưng deadline cũ phải báo recovery rõ, không báo thành công giả.
5. **Checkpoint C.** Clock-fixed Python tests phủ current/expired/invalid schedule và bảo toàn toàn bộ rules ngoài schedule; demo guard/live flow mở round mới có `opensAt < now < deadlineAt < graceEndsAt`.
6. **Integration và handoff.** Chạy API/web/root tests, typecheck, build, `git diff --check`, GitNexus `detect-changes` không partial/truncated; browser/manual check trang nộp bot; review hai commit rồi mở PR target `main`. Chỉ deploy lại từ `main` sau merge và khi có yêu cầu deploy riêng.

#### Hai commit dự kiến

1. `fix(api): serialize submission commit with round cancellation` — Slice A, API contract và PostgreSQL lock regression.
2. `fix(demo): recover unstarted rounds and expired submission windows` — Slice B + C. Hai slice cùng sửa `demo.sh`, `demo_json.py` và canned shell harness nên được review cùng nhau; commit chứa cancel CLI, immutable ruleset refresh, tests và runbook.

#### Rủi ro và giảm thiểu

| Rủi ro | Mức độ | Giảm thiểu |
| --- | --- | --- |
| Migration `0021` trùng tên/schema | Cao | Không port migration cũ; test registry và fresh PostgreSQL migrations từ `main` |
| Cherry-pick làm mất thay đổi demo mới | Cao | Port theo behavior/file hunk; review `main...branch`, cấm diff xóa account/editorial/finals/sample bot ngoài scope |
| Deadlock cancel/upload | Cao | Khóa cùng row theo thứ tự xác định; concurrency integration test có timeout |
| Clone ruleset làm mất `OWN_SUBMISSION` hoặc policy mới | Cao | Deep-copy toàn bộ rules, thay đúng `schedule`; equality assertion cho mọi field còn lại |
| Main và server demo khác release | Trung bình | Sau merge mới build/deploy từ commit `main`; kiểm migration, container health, deadline DB và route domain |

## 18. Parallelization và ownership coordination

- Sau `P3-T01`, `P3-L01`, `P3-D01`, `P3-N01` chạy song song vì contract, control plane và sandbox tách module.
- Trong mỗi wave, task có dependency đã hoàn tất có thể chạy song song; không mở đồng thời hai PR sửa cùng migration, `app.ts`, shared routing hoặc protocol schema.
- Mọi API contract phải merge trước consumer UI. Owner API cung cấp fixture/contract để owner UI không phải chờ service chạy thật.
- Thuận review tại từng checkpoint, không sửa trực tiếp branch của owner; thay đổi requirement quay lại Gate P3-0 hoặc một decision amendment riêng.

## 19. Rủi ro Phase 3

| Rủi ro | Mức độ | Giảm thiểu |
| --- | --- | --- |
| Protocol v2 làm hỏng bot/replay v1 | Cao | Version negotiation, fixtures v1/v2 và replay compatibility task riêng |
| Qualification replay vô tình public | Cao | Server-side stage authorization từ dữ liệu đầu tiên; không dựa vào ẩn route UI |
| Một server lab quá tải hoặc mất dữ liệu | Cao | Adaptive admission, queue/backpressure, backup ngoài server, restore/retry smoke và AC-13/19 |
| Credential CSV chứa plaintext | Cao | Streaming one-time response, không persist/log, forced reset workflow và operational deletion checklist |
| Static public site stale | Trung bình | Snapshot timestamp, last-known-good fallback, signed/checksummed payload và cảnh báo stale |
| Task vượt 5 file | Trung bình | Owner phải tách child task trước code; task ID mới không tái sử dụng |

## 20. Quyết định productionization hoãn ngoài PoC

- Provider static hosting/CDN/tunnel, domain và TLS operations cụ thể được chọn khi có yêu cầu deploy.
- Scale vượt 200 đội/1.000 public viewers, multi-host worker, HA/DR SLA và 24/7 monitoring cần evidence + ADR mới.
- HSM, automated key rotation và tự động đồng bộ LAN→online nằm ngoài Phase 3 PoC.

## 21. Plan verification Phase 3

- [x] Review phân biệt rõ Phase 2 đã duyệt, carry-over tổng thể và v0.5 mới.
- [x] Mỗi task có owner, dependency, acceptance criteria, verification và file dự kiến trong `tasks/todo.md`.
- [x] Implementation được giao cho Long, Nguyên và Đạt; Thuận giữ decision/checkpoint.
- [x] Task được chia S/M và có checkpoint sau mỗi 2–3 task.
- [x] Kế hoạch cũ không bị ghi đè; Phase 3 được nối tiếp tại cùng nguồn plan/todo.
- [x] Đinh Đức Thuận duyệt Gate `P3-0` ngày 14/10/2026; Wave 1 có thể bắt đầu trên branch task riêng.
