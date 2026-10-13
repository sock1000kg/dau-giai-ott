# Implementation Plan: Phase 1–2 theo phân công nhóm Dev

**Trạng thái:** Đã tự động duyệt — sẵn sàng triển khai
**Mức khuyến nghị:** Cao (`HIGH RECOMMEND`)
**Người duyệt:** Đinh Đức Thuận, theo quy tắc tự động duyệt tài liệu mức cao
**Nguồn:** `docs/team-assignment-phase-1-2.md`, `docs/tai-lieu-yeu-cau.md`
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
| `T` | Đinh Đức Thuận | Toàn bộ Phase 2 local: architecture, backend, frontend, replay, E2E và checkpoint |
| `L` | Long Trần | Core Game API và Bot Protocol v1 |
| `N` | Đỗ Khôi Nguyên | Bot Python hợp lệ, bot lỗi và contract test phía bot |
| `D` | Phạm Tất Đạt | MatchRunner, BotProcess, CLI/E2E Phase 1 |

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
- [ ] `P2-T28` — Qualification E2E harness và deterministic fixtures.
- [ ] `P2-T29` — Qualification full-flow E2E và local handoff.

## 9. Cảnh báo tải Phase 2

Thuận là owner duy nhất của `P2-T01`–`P2-T29`. `P2-T01`–`P2-T16` đã hoàn tất; vòng lặp AI tiếp tục từ `P2-T17A`, mỗi lần chọn đúng một task có dependency đã xanh, tạo branch riêng, test, cập nhật docs/status, commit và merge vào `main` trước task kế tiếp. Không mở nhiều branch chạm chung `src/platform/web` hoặc replay schema trong cùng lúc.

1. Hạ tầng local và database.
2. Authentication/RBAC, team và submission.
3. Queue/worker/sandbox.
4. Result finalization, scheduling và Elo.
5. Web shell/login, team portal, BTC credential console, results UI và replay UI.
6. Qualification E2E.

Phase 2 kết thúc tại local qualification E2E và runbook. Không thêm CI/CD, cloud infrastructure, production credential hoặc deploy stage vào các task `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29`.

## 10. Rủi ro

| Rủi ro | Mức độ | Giảm thiểu |
| --- | --- | --- |
| Source tham chiếu chưa có LICENSE | Cao | Chỉ đối chiếu behavior; không copy/submodule/package source |
| Protocol đổi khi ba lane đang code | Cao | Contract docs/schema khóa tại `P1-T01`; executable baseline tại `P1-L04`; Long là owner duy nhất |
| Nguyên hoặc Đạt phải chờ implementation của Long | Trung bình | Dùng JSON fixtures, `FakeGame` và `ScriptedBot` |
| Child process treo/rò rỉ | Cao | Cleanup trong `finally`, timeout monotonic, test còn PID/open handle |
| Một owner xử lý toàn bộ Phase 2 còn lại | Cao | Task S/M, một branch/task, checkpoint sau từng cụm và full gate tại `P2-T29` |
| Task vượt 5 file | Trung bình | Tách task trước khi bắt đầu; không mở rộng scope trong cùng PR |

## 11. Open questions không chặn Phase 1

- Exact leaderboard tie vẫn cần BTC ra quyết định nghiệp vụ; UI chỉ hiển thị `BTC_REQUIRED`, không tự đặt luật phụ.
- Bracket/finals ngoài qualification flow phải được đặc tả riêng; không tự thêm vào `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29`.

## 12. Plan verification

- [x] Mỗi task có owner.
- [x] Task chi tiết có acceptance criteria, verification, dependency và file dự kiến trong `tasks/todo.md`.
- [x] Mỗi implementation task còn mở dự kiến là một lát S/M; package/workspace bootstrap có thể vượt 5 file vì phải cập nhật root lock/workspace, hai TypeScript configs và smoke test cùng nhau.
- [x] Có checkpoint sau contract, sau ba lane và sau E2E.
- [x] Plan cũ và plan mới là cùng phạm vi nên được cập nhật tại chỗ.
- [x] Plan đạt `HIGH RECOMMEND` và được Đinh Đức Thuận tự động duyệt.
