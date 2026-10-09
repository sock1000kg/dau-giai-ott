# SUPERSEDED — GitNexus Plan ngày 08/10/2026

> Trạng thái: **ARCHIVED / KHÔNG ĐƯỢC DÙNG ĐỂ TRIỂN KHAI**
>
> Tài liệu này giữ lại dấu vết phân tích ban đầu và dùng mã `TV1…TV4`, `P1-A1…P2-G4` đã lỗi thời. Nguồn plan duy nhất đang hiệu lực là `tasks/plan.md`; task ID, owner, dependency và trạng thái duy nhất nằm tại `tasks/todo.md`. AI không được chọn task, suy ra owner hoặc thay đổi scope từ phần nội dung lưu trữ bên dưới.

# GitNexus Engineering Plan — nội dung lưu trữ

> Task: Lập kế hoạch triển khai Phase 1–2 cho bốn thành viên, bao phủ toàn bộ vòng đời phát triển và kiểm thử.
> Evidence verified at commit `ccd310ce44b7f09b81a8bac33713267c1175648e`; GitNexus index refreshed this session with `node .gitnexus/run.cjs analyze --index-only --pdg` (225 nodes, 221 edges, 0 execution flows).
> Evidence provenance schema 2; global dirty digest `e9d9ee5a8e5b14286b6047165a2523c407dae93bf9633e1d5e4a7d71100b7978`; cited-path manifest 6 sorted entries; exact generated plan path excluded.

## 1. Objective

Xây dựng lộ trình thực thi Phase 1 và Phase 2 trong `docs/tai-lieu-yeu-cau.md` cho nhóm bốn người, sao cho:

- Phase 1 bàn giao được Game Engine authoritative, Bot Protocol v1, bot process adapter, match runner, CLI và kiểm thử E2E cục bộ.
- Phase 2 bàn giao được đăng ký đội/submission, artifact storage, sandbox, queue/worker, map động, scheduling, Elo, leaderboard và cổng vận hành tối thiểu.
- Mỗi người có ranh giới sở hữu rõ, nhưng không có “người QA riêng”: chủ task phải viết test; thành viên tích hợp chỉ sở hữu test xuyên hệ thống.
- Mỗi lát công việc có dependency, acceptance criteria, verification và checkpoint tích hợp.
- Việc triển khai dừng ở cuối Phase 2; bracket chung kết và Replay/Spectator UI thuộc Phase 3, không được kéo vào plan này.

### Success criteria của plan

1. Bốn luồng sở hữu có thể chạy song song sau khi contract được khóa.
2. Không task triển khai nào dự kiến chạm quá năm file; task lớn phải tách tiếp trước khi bắt đầu.
3. Phase 1 đáp ứng AC-01 đến AC-03 và determinism; Phase 2 đáp ứng AC-04 đến AC-08, AC-11, AC-12.
4. Mỗi checkpoint chỉ được qua khi CI xanh, contract không drift và demo dọc chạy được.
5. Có lịch tích hợp, ma trận test, risk owner và Definition of Done đủ để người quản lý giao việc.

## 2. Current Behaviour

- [verified] Repository hiện là greenfield: không có `package.json`, source code hoặc CI workflow; chỉ có tài liệu yêu cầu và plan/todo cũ. Evidence: `package.json` và `.github/workflows/ci.yml` absent trong provenance; `tasks/plan.md:9-11`.
- [verified] Yêu cầu đã định nghĩa thứ tự module `game-rules → bot-protocol → bot-submission → sandbox-execution → match-orchestration → ranking-scheduling` tại `docs/tai-lieu-yeu-cau.md:71-95`.
- [verified] Phase 1 được giới hạn ở engine, protocol, timeout, bot mẫu và local E2E; Phase 2 mở rộng sang submission, sandbox, queue/worker, scheduling, Elo và leaderboard tại `docs/tai-lieu-yeu-cau.md:590-601`.
- [verified] Plan cũ chỉ bao phủ Phase 1 bằng tám task, chưa phân công bốn người và chưa có Phase 2 tại `tasks/plan.md:116-153` và `tasks/todo.md:1-244`.
- [verified] Plan cũ coi crash là skip lượt (`tasks/plan.md:43-49`), trong khi spec mới đề xuất crash/EOF/quota violation là lỗi nghiêm trọng dẫn đến forfeit (`docs/tai-lieu-yeu-cau.md:247-255`). Contract freeze phải giải quyết khác biệt này trước khi code.
- [verified] Hệ thống phải phân biệt lỗi bot và lỗi hạ tầng; lỗi hạ tầng không được tính kết quả/Elo tại `docs/tai-lieu-yeu-cau.md:293-316`.
- [verified] Queue có thể at-least-once nhưng finalize/rating phải cho hiệu ứng exactly-once tại `docs/tai-lieu-yeu-cau.md:320-341` và `docs/tai-lieu-yeu-cau.md:523-526`.

Không có execution path hiện hữu. Execution path mục tiêu sau Phase 2 là:

```text
Đội nộp bot
  → kiểm tra archive + smoke protocol
  → lưu artifact bất biến + kích hoạt submission
  → scheduler pin submission/map/seed và tạo series
  → queue giao match attempt
  → worker khởi tạo hai sandbox + MatchRunner
  → Engine sinh result/event log
  → finalizer chấp nhận duy nhất một result
  → rating ledger cập nhật một lần
  → leaderboard/API/UI đọc projection đã finalize
```

## 3. Relevant Architecture

### 3.1 Ranh giới kiến trúc

[verified] Spec yêu cầu Control Plane tách khỏi Execution Plane, artifact lớn nằm ở object storage, metadata/transaction nằm ở database, Engine không phụ thuộc HTTP/queue/database/UI (`docs/tai-lieu-yeu-cau.md:470-500`, `docs/tai-lieu-yeu-cau.md:544-547`).

Kiến trúc triển khai đề xuất:

```text
Web portal / Admin client
            │
            ▼
Modular Control Plane API ──► PostgreSQL
     │          │
     │          ├────────────► S3-compatible artifact store
     │          └────────────► Redis/BullMQ queue
     │                              │
     │                              ▼
     └──────────────────────── Match Worker
                                      │
                            Authoritative MatchRunner
                               │                  │
                         Bot A sandbox       Bot B sandbox
```

- [confirmed 2026-10-08] Backend: Node.js 22, TypeScript và Vitest. npm là package manager đang được plan đề xuất, chưa phải quyết định người dùng vừa chốt.
- [confirmed 2026-10-08] HTTP adapter Phase 2: Fastify; validation schema dùng cùng nguồn type với runtime validator.
- [confirmed 2026-10-08] Persistence: PostgreSQL; queue: Redis/BullMQ; artifact: S3-compatible storage, dùng MinIO ở local.
- [confirmed 2026-10-08] Portal tối thiểu Phase 2: React/Vite cho submission status và public leaderboard; Replay UI không thuộc scope.
- [confirmed 2026-10-08] PostgreSQL, Redis và MinIO chạy bằng Docker Compose, publish trên `localhost` trong môi trường phát triển.
- [inferred] Bắt đầu bằng modular monolith cho Control Plane, một worker process riêng và package game core thuần. Chưa tách microservice nếu chưa có số liệu tải.

### 3.2 Quy tắc phụ thuộc

- `game` và `protocol` không import HTTP, database, queue, Docker hoặc UI.
- `match` chỉ phụ thuộc các port `BotClient`, clock, event sink và game/protocol.
- `submissions`, `rankings`, `tournaments` chứa domain/service; adapter DB/HTTP nằm ngoài domain.
- Worker gọi `MatchService` qua interface ổn định; finalizer sở hữu transaction kết quả + idempotency.
- UI chỉ gọi API; không truy cập database, queue, worker hoặc artifact private trực tiếp.
- Mỗi artifact chính thức phải pin hash/version; không truyền “bot đang active” động vào job đã schedule.

### 3.3 Phân công bốn người

| Thành viên | Vai trò sở hữu | Phase 1 | Phase 2 | Reviewer bắt buộc |
| --- | --- | --- | --- | --- |
| TV1 — Domain Lead | Luật và thuật toán thuần | Types/fixtures, engine | Phase 2 contract, map, scheduler/series, Elo | TV4 review integration; TV2 review protocol boundary |
| TV2 — Runtime/Security Lead | Process và sandbox | Protocol, STDIO BotClient | Local infra, runtime image, sandbox runner, security/observability | TV1 review contract; TV3 review artifact boundary |
| TV3 — Control Plane/Data Lead | State bền vững và API | Event/result model, MatchRunner | DB, RBAC/team, submission, artifact API, portal | TV4 review transaction/idempotency |
| TV4 — Integration/Quality Lead | Toolchain và hệ thống dọc | Toolchain, CLI, E2E, CI/runbook | Queue/worker/finalize và E2E | Mỗi domain owner review phần tương ứng |

TV4 không phải người “test hộ” cả nhóm. Mỗi owner phải giao unit/contract/integration test trong cùng task; TV4 chỉ sở hữu test xuyên module, CI và release evidence.

## 4. GitNexus Findings

- [graph] `list_repos(repo=dau-giai-ott)`: index pin cùng HEAD `ccd310ce44b7f09b81a8bac33713267c1175648e`; trước refresh có 5 files, 22 symbols, 0 processes.
- [graph] Post-write verification refresh `node .gitnexus/run.cjs analyze --index-only --pdg` thành công: “225 nodes | 221 edges | 0 clusters | 0 flows”. Index có cả plan/todo untracked nhưng vẫn không có code flow.
- [graph] `query(search_query="Phase 1 game rules ... Elo leaderboard")`: chỉ trả ba File definitions: `docs/tai-lieu-yeu-cau.md`, `tasks/plan.md`, `tasks/todo.md`; không có process symbol.
- [graph] `context(kind=File)` cho ba file trên: incoming/outgoing rỗng, processes rỗng.
- [graph] `impact(target_uid="File:docs/tai-lieu-yeu-cau.md", direction="upstream", maxDepth=3)`: impactedCount 0 nhưng `risk: UNKNOWN`; không được diễn giải là tài liệu không có phụ thuộc.
- [graph] `detect_changes(scope=all)`: 10 changed symbols trong 2 file, 0 affected process; kết quả chỉ phản ánh graph tài liệu, không phải blast radius của hệ thống chưa tồn tại.
- [graph] Deepen 08/10/2026: refresh strict ban đầu trả `199 nodes | 195 edges | 0 clusters | 0 flows`; post-write refresh trả 225 nodes/221 edges; query parallel workstreams chỉ trả file definitions, không có process symbol.
- [graph] `impact` cho generated plan và `tasks/todo.md` đều `risk: UNKNOWN`, impactedCount 0; text search xác nhận phụ thuộc chỉ là liên kết tài liệu, không được coi là all-clear cho code tương lai.
- [verified] Text search cho thấy yêu cầu Phase 1/2 hiện nằm ở spec và plan/todo cũ; repo không có implementation khác để tái sử dụng.

Hệ quả lập kế hoạch: source/spec là bằng chứng chính; graph chỉ xác nhận trạng thái greenfield. Không có symbol/caller hiện hữu để thực hiện impact theo code.

## 5. Statement-Level PDG Findings

- [graph] PDG đã được bật bằng refresh strict.
- [graph] `pdg_query(mode=controls, target="docs/tai-lieu-yeu-cau.md")` trả 0 results.
- [verified] Repo chưa có function thực thi, nên không thể xây PDG slice hợp lệ mà không bịa symbol hoặc statement.
- [inferred] Các constraint về transaction, retry, timeout và cleanup trong plan đến từ spec, không phải PDG hiện hữu. Khi Task P1-C3 và P2-E4 tạo các function trung tâm, executor phải chạy lại analysis/PDG trước khi thay đổi chúng ở task sau.

## 6. Proposed Changes

Tất cả path dưới đây là file mới dự kiến, trừ khi ghi rõ là file hiện hữu. Không có symbol hiện hữu để source-verify; vì vậy plan không đặt tên function/class chưa tồn tại.

### 6.1 Phase 1

| Khu vực | File dự kiến | Trách nhiệm |
| --- | --- | --- |
| Toolchain | `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` | Scripts build/typecheck/test, ESM entry, baseline CI |
| Contract/game | `docs/phase-1-contract.md`, `src/game/types.ts`, `src/game/fixtures.ts` | State/action/result versioned; initial board/map |
| Engine | `src/game/engine.ts` | Pure legal-move/state transition/winner logic |
| Protocol | `src/protocol/*.ts`, `docs/bot-protocol-v1.md` | NDJSON envelope, validation, size/version/turn checks |
| Bot runtime | `src/bots/*.ts` | Child process lifecycle, monotonic timeout, cleanup |
| Match | `src/match/*.ts` | Event model, authoritative turn loop, forfeit/turn limit |
| CLI/examples | `src/cli/run-match.ts`, `examples/bots/*.py` | Local composition root and deterministic fixture bots |
| Quality | `tests/**`, `.github/workflows/ci.yml`, `docs/phase-1-runbook.md` | Unit/contract/integration/E2E, CI and handoff |

### 6.2 Phase 2

| Khu vực | File dự kiến | Trách nhiệm |
| --- | --- | --- |
| Local stack/config | `compose.yaml`, `.env.example`, `src/config/*` | PostgreSQL, Redis, MinIO chạy Docker trên localhost; health check và validated configuration |
| Persistence | `src/db/*`, `migrations/*` | Team, submission, map, round, series, match, attempt, result, rating ledger, audit |
| Identity/team | `src/auth/*`, `src/teams/*`, `src/http/routes/teams.ts` | Minimal RBAC and team lifecycle |
| Submission/artifact | `src/submissions/*`, `src/storage/*`, `src/http/routes/submissions.ts` | Upload hardening, immutable artifact, validation/activation |
| Map/scheduling/rating | `src/maps/*`, `src/rankings/*` | Map checksum, deterministic pairing/side swap, Elo ledger |
| Sandbox | `docker/bot-runtime/*`, `src/sandbox/*` | Runtime image, security policy, resource/process cleanup |
| Queue/worker/finalize | `src/queue/*`, `src/workers/*`, `src/orchestration/*` | Lease, retry, attempt classification, exactly-once finalize |
| Portal/API | `src/http/*`, `web/src/*` | Submission status, leaderboard, operational status tối thiểu |
| Operations | `src/observability/*`, `tests/security/*`, `docs/phase-2-runbook.md` | Logs/metrics, canary, incident and acceptance evidence |

### 6.3 Compatibility constraints

- Protocol v1 không được đổi ngầm giữa Phase 1 và Phase 2.
- MatchResult/Event schema phải thêm version từ Phase 1 để Phase 2 pin/replay được.
- Phase 2 dùng `MatchService`/port của Phase 1; không nhúng queue/DB vào engine.
- Một match attempt lỗi hạ tầng không tạo MatchResult chính thức.
- Submission/map dùng trong job là immutable và tham chiếu bằng ID + checksum/hash.
- Rating ledger có unique idempotency key theo series/team; điều chỉnh thủ công là entry mới.
- Không sao chép code từ repo tham chiếu khi chưa có quyền/license; chỉ clean-room từ đặc tả hành vi.

## 7. Implementation Sequence

### 7.1 Decision Gate 0 — trước khi giao task

Đã chốt ngày 08/10/2026:

1. Stack Node.js 22/TypeScript/Vitest.
2. Fastify/PostgreSQL/Redis-BullMQ/S3-compatible storage/React-Vite cho Phase 2.
3. PostgreSQL, Redis và MinIO chạy bằng Docker Compose trên `localhost` trong môi trường phát triển.

Các quyết định còn phải chốt trước task phụ thuộc:

1. D-04: crash/EOF/quota violation forfeit ngay; lỗi theo lượt 3 liên tiếp hoặc 5 tổng.
2. D-06: `maxTurns=200` vòng loại.
3. D-07/D-08: Python image digest, CPU/RAM/PID/startup/log quota.
4. D-09/D-10: rating band/số series mỗi vòng và cặp hai game đổi X/O.
5. Phase 2 auth: tài khoản nội bộ tối thiểu hay tích hợp SSO có sẵn.
6. Package manager: plan dùng npm; phải xác nhận trước khi P1-A4 tạo lockfile.

### 7.2 Mô hình thực thi song song

Không thể cho toàn bộ task chạy đồng thời từ đầu đến cuối vì contract, migration và integration là dependency thật. Plan dùng **soft wave**:

- Mỗi wave có đúng bốn task độc lập: TV1–TV4 mỗi người sở hữu một task.
- Task trong cùng wave không sửa cùng file; shared contract chỉ do owner chỉ định sửa.
- Consumer phát triển với port/fake đã khóa, không chờ adapter thật.
- Người hoàn thành sớm có thể sang task wave kế tiếp khi dependency trực tiếp đã merge; không phải chờ cả wave, trừ checkpoint hard gate.
- Hard gate chỉ tồn tại tại CP1-A, CP1-D, CP2-A và CP2-G.
- Integration branch không tồn tại lâu dài; merge từng task vào trunk trong tối đa khoảng hai ngày.

```text
Gate 0
  └─ Phase 1 Wave A: [TV1 contract game | TV2 protocol | TV3 match contract | TV4 toolchain]
       └─ CP1-A contract freeze
            ├─ Wave B: 4 core implementations in parallel
            ├─ Wave C: 4 adapters/integration preparations in parallel
            └─ Wave D: 4 acceptance lanes in parallel → CP1-D

CP1-D
  └─ Phase 2 Wave A: 4 boundary contracts in parallel
       └─ CP2-A architecture/data contract freeze
            ├─ Wave B: 4 foundations
            ├─ Wave C: 4 domain/runtime cores
            ├─ Wave D: 4 adapters
            ├─ Wave E: 4 transactional/API capabilities
            ├─ Wave F: 4 user/security acceptance slices
            └─ Wave G: 4 final evidence lanes → CP2-G
```

### 7.3 Phase 1 — bốn wave song song

#### Wave P1-A — contract và toolchain (chạy đồng thời)

##### P1-A1 — Game contract và fixture specification

- **Owner:** TV1. **Review:** TV3.
- **Depends on:** Gate 0.
- **Deliverable:** luật, state/action/result, spawn/goal, skip/forfeit/maxTurns và fixture vectors có version.
- **Acceptance:** không còn cách hiểu mơ hồ về board, turn/revision, win/draw/error; clean-room, không copy code repo tham chiếu.
- **Verify:** traceability matrix với spec mục 6–7; review fixture vectors bằng tay.
- **Files (2):** `docs/contracts/game-v1.md`, `docs/contracts/game-v1-fixtures.json`.
- **Effort:** 2 points.

##### P1-A2 — Bot Protocol v1 contract

- **Owner:** TV2. **Review:** TV1.
- **Depends on:** Gate 0.
- **Deliverable:** message envelope, NDJSON framing, size/version/turn checks, stdout/stderr và error taxonomy.
- **Acceptance:** schema nêu đủ INIT/STATE_UPDATE/ACTION/TURN_RESULT/MATCH_RESULT và mọi invalid class.
- **Verify:** example matrix valid/invalid được cả TV1 và TV3 duyệt.
- **Files (2):** `docs/contracts/bot-protocol-v1.md`, `docs/contracts/bot-protocol-v1-examples.ndjson`.
- **Effort:** 2 points.

##### P1-A3 — Match lifecycle, ports và event contract

- **Owner:** TV3. **Review:** TV4.
- **Depends on:** Gate 0.
- **Deliverable:** BotClient/Game port, event/result schema, turn ordering, finalStateHash và cleanup semantics.
- **Acceptance:** runner có thể phát triển bằng fake ports; một turn/match chỉ được phân xử/finalize đúng một lần.
- **Verify:** sequence diagrams cho normal, timeout, invalid action, crash và turn limit.
- **Files (2):** `docs/contracts/match-v1.md`, `docs/contracts/match-v1-events.json`.
- **Effort:** 2 points.

##### P1-A4 — Node/TypeScript/Vitest toolchain

- **Owner:** TV4. **Review:** TV1.
- **Depends on:** Gate 0 và chốt package manager.
- **Deliverable:** skeleton với `typecheck`, `test`, `test:coverage`, `build`; test helpers tối thiểu.
- **Acceptance:** clean install/build/test chạy được; ESM build không chứa tests; smoke import không side effect.
- **Verify:** `npm ci && npm run typecheck && npm test && npm run build`.
- **Files (5):** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`.
- **Effort:** 2 points.

**CP1-A — hard contract freeze:** bốn tài liệu/toolchain cùng được review; TV1 sở hữu game types, TV2 protocol types, TV3 match ports/events, TV4 build config. Sau gate, thay đổi public contract phải có reviewer của mọi consumer bị ảnh hưởng.

#### Wave P1-B — core implementation (chạy đồng thời sau CP1-A)

##### P1-B1 — Game types, fixtures và pure engine

- **Owner:** TV1. **Review:** TV3.
- **Depends on:** CP1-A.
- **Deliverable:** type/fixture chuẩn, legal moves, capture, goal/elimination và immutable transition.
- **Acceptance:** đủ 8 hướng, boundary/obstacle/friendly block, ma trận RPS và action lỗi không mutate.
- **Verify:** focused engine/fixture tests; game branch coverage ≥90%.
- **Files (5):** `src/game/types.ts`, `src/game/fixtures.ts`, `src/game/engine.ts`, `tests/game/fixtures.test.ts`, `tests/game/engine.test.ts`.
- **Effort:** 5 points.

##### P1-B2 — Protocol messages, validation và NDJSON

- **Owner:** TV2. **Review:** TV1.
- **Depends on:** CP1-A.
- **Deliverable:** runtime schemas, serialize/parse và bounded line framing theo contract.
- **Acceptance:** từ chối version/matchId/turnId/coordinate/field/size sai; mọi docs example qua validator.
- **Verify:** table-driven unit/contract tests.
- **Files (4):** `src/protocol/messages.ts`, `src/protocol/validation.ts`, `src/protocol/ndjson.ts`, `tests/protocol/validation.test.ts`.
- **Effort:** 5 points.

##### P1-B3 — Match ports, event model và runner với fakes

- **Owner:** TV3. **Review:** TV1 và TV2.
- **Depends on:** CP1-A.
- **Deliverable:** versioned event/result, injected GamePort/BotClient, turn loop test-first bằng fakes.
- **Acceptance:** normal/timeout/invalid/crash/turn-limit cho đúng sequence; cleanup được gọi mọi exit path.
- **Verify:** fake-port matrix và golden event/hash tests.
- **Files (5):** `src/match/ports.ts`, `src/match/types.ts`, `src/match/events.ts`, `src/match/match-runner.ts`, `tests/match/match-runner.fake.test.ts`.
- **Effort:** 5 points.

##### P1-B4 — CLI/config shell và fixture bots

- **Owner:** TV4. **Review:** TV3.
- **Depends on:** CP1-A.
- **Deliverable:** typed CLI/config boundary, injectable run-match port và deterministic/fault Python bots.
- **Acceptance:** không nhận shell command string; stdout/stderr/exit-code contract ổn định; CLI test được bằng fake runner.
- **Verify:** CLI contract tests + Python fixture smoke tests.
- **Files (5):** `src/cli/config.ts`, `src/cli/run-match.ts`, `tests/cli/run-match.test.ts`, `examples/bots/protocol_bot.py`, `examples/bots/fault_bot.py`.
- **Effort:** 4 points.

**CP1-B — core compile checkpoint:** bốn task build cùng nhau, không contract drift, mỗi owner đã merge unit tests của mình.

#### Wave P1-C — adapters và integration preparation (chạy đồng thời)

##### P1-C1 — Engine adversarial và determinism coverage

- **Owner:** TV1. **Review:** TV4.
- **Depends on:** P1-B1.
- **Deliverable:** property/table tests cho edge state, repeatability và invariant.
- **Acceptance:** same state/action cho same result/hash; malformed state bị chặn tại boundary; không hidden randomness.
- **Verify:** repeated focused suite và mutation-oriented review các nhánh game.
- **Files (2):** `tests/game/engine-adversarial.test.ts`, `tests/game/determinism.test.ts`.
- **Effort:** 3 points.

##### P1-C2 — STDIO BotClient và process lifecycle

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** P1-B2.
- **Deliverable:** child-process adapter, monotonic timeout, stale response rejection và idempotent close.
- **Acceptance:** fragmented/multiple lines, timeout, oversized/malformed, EOF/non-zero exit; không rò process/listener.
- **Verify:** controlled process tests + PID/open-handle check.
- **Files (4):** `src/bots/bot-client.ts`, `src/bots/stdio-bot-client.ts`, `tests/bots/stdio-bot-client.test.ts`, `tests/bots/process-fixtures.ts`.
- **Effort:** 5 points.

##### P1-C3 — MatchRunner tích hợp engine và protocol

- **Owner:** TV3. **Review:** TV1 và TV2.
- **Depends on:** P1-B1, P1-B2, P1-B3.
- **Deliverable:** production GamePort/protocol adapters cho runner; skip/forfeit/turn-limit theo contract.
- **Acceptance:** đúng bot được hỏi, mỗi turn phân xử một lần, MATCH_FINISHED duy nhất, không phụ thuộc STDIO thật.
- **Verify:** integration matrix dùng fake BotClient nhưng engine/protocol thật.
- **Files (3):** `src/match/game-adapter.ts`, `tests/match/match-runner.integration.test.ts`, `tests/match/events.test.ts`.
- **Effort:** 5 points.

##### P1-C4 — CI lanes và CLI contract integration

- **Owner:** TV4. **Review:** TV3.
- **Depends on:** P1-B2, P1-B3, P1-B4.
- **Deliverable:** CI unit/contract lanes, CLI integration dùng fake/fixture ports và coverage aggregation.
- **Acceptance:** mỗi lane chạy độc lập; failure chỉ rõ owner; chưa phụ thuộc adapter STDIO đang phát triển.
- **Verify:** clean-checkout CI dry run và CLI integration suite.
- **Files (4):** `.github/workflows/ci.yml`, `tests/cli/run-match.integration.test.ts`, `package.json`, `vitest.config.ts`.
- **Effort:** 3 points.

**CP1-C — adapter checkpoint:** engine/protocol/match/STDIO/CLI đều có interface ổn định và merge được; từ đây chỉ còn acceptance evidence, không thêm capability mới.

#### Wave P1-D — acceptance lanes (chạy đồng thời sau CP1-C)

##### P1-D1 — Game/protocol compatibility evidence

- **Owner:** TV1. **Review:** TV2.
- **Depends on:** CP1-C.
- **Deliverable:** automated evidence AC-01/AC-03 cho rule + protocol compatibility.
- **Acceptance:** full move/capture/win matrix và invalid action immutability được trace về contract.
- **Verify:** focused compatibility suite + coverage report.
- **Files (2):** `tests/acceptance/game-protocol.test.ts`, `docs/evidence/phase-1-game.md`.
- **Effort:** 2 points.

##### P1-D2 — Runtime fault và leak evidence

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** CP1-C.
- **Deliverable:** timeout/crash/EOF/stale/oversized/process cleanup acceptance suite.
- **Acceptance:** AC-02 và fault policy đúng; không PID/open handle còn lại sau repeated runs.
- **Verify:** suite lặp ba lần với monotonic controlled timing.
- **Files (2):** `tests/acceptance/runtime-faults.test.ts`, `docs/evidence/phase-1-runtime.md`.
- **Effort:** 2 points.

##### P1-D3 — Match lifecycle và final-hash evidence

- **Owner:** TV3. **Review:** TV1.
- **Depends on:** CP1-C.
- **Deliverable:** match sequence/finalStateHash/revision/cleanup acceptance evidence.
- **Acceptance:** normal, skip, forfeit và turn-limit sinh đúng một final result; same seed/script cho same events/hash.
- **Verify:** repeated MatchRunner acceptance suite.
- **Files (2):** `tests/acceptance/match-lifecycle.test.ts`, `docs/evidence/phase-1-match.md`.
- **Effort:** 2 points.

##### P1-D4 — Real-process E2E, runbook và Phase 1 gate

- **Owner:** TV4. **Review:** cả nhóm.
- **Depends on:** CP1-C.
- **Deliverable:** CLI nối runner + STDIO thật, E2E hai bot, runbook và final CI gate.
- **Acceptance:** INIT→result/event log chạy sạch; install/typecheck/unit/integration/E2E/coverage/build pass; người mới chạy theo runbook.
- **Verify:** clean checkout walkthrough + E2E lặp ba lần.
- **Files (5):** `src/cli/composition.ts`, `tests/e2e/match.e2e.test.ts`, `tests/e2e/determinism.e2e.test.ts`, `README.md`, `docs/phase-1-runbook.md`.
- **Effort:** 5 points.

**CP1-D — hard Phase 1 gate:** P1-D1…D4 pass; AC-01…03 + determinism có evidence; không Critical/High finding; GitNexus refresh/detect-changes không partial/truncated.

### 7.4 Phase 2 — bảy wave song song

#### Wave P2-A — boundary contracts (chạy đồng thời sau CP1-D)

##### P2-A1 — Map, series, scheduling và rating contracts

- **Owner:** TV1. **Review:** TV3.
- **Depends on:** CP1-D, D-09/D-10.
- **Deliverable:** map checksum/version, round snapshot, series side swap, Elo ledger/projection ports.
- **Acceptance:** schedule/rating deterministic và không phụ thuộc worker completion order.
- **Verify:** traceability review spec mục 11 và AC-07/08.
- **Files (2):** `docs/contracts/ranking-v1.md`, `docs/decisions/0002-ranking-snapshot.md`.
- **Effort:** 2 points.

##### P2-A2 — Infrastructure, sandbox và artifact contracts

- **Owner:** TV2. **Review:** TV3.
- **Depends on:** CP1-D, D-07/D-08.
- **Deliverable:** resource profile, SandboxBotClient, artifact validation/S3 port và security error taxonomy.
- **Acceptance:** bot/infra/config/security faults không nhập nhằng; cleanup/network/filesystem constraints testable.
- **Verify:** threat-model review với spec mục 8–9 và AC-04/11/12.
- **Files (2):** `docs/contracts/execution-v1.md`, `docs/decisions/0003-sandbox-storage-boundary.md`.
- **Effort:** 2 points.

##### P2-A3 — Data, RBAC và submission contracts

- **Owner:** TV3. **Review:** TV1.
- **Depends on:** CP1-D, auth decision.
- **Deliverable:** entities, transitions, repositories, authorization rules, audit fields và migration ownership.
- **Acceptance:** unique/idempotency constraints và team/submission isolation được xác định trước schema.
- **Verify:** state-machine + permission matrix review với spec mục 4, 8 và 15.
- **Files (2):** `docs/contracts/control-plane-v1.md`, `docs/decisions/0004-control-data-boundary.md`.
- **Effort:** 2 points.

##### P2-A4 — Job, worker, finalize, API và acceptance contracts

- **Owner:** TV4. **Review:** TV2.
- **Depends on:** CP1-D.
- **Deliverable:** MatchJob/attempt/finalize interfaces, API error envelope, observability fields và E2E fixtures.
- **Acceptance:** at-least-once delivery nhưng exactly-once result/rating; correlation xuyên toàn flow.
- **Verify:** sequence review worker death, duplicate delivery, cancel và finalize race.
- **Files (2):** `docs/contracts/orchestration-v1.md`, `docs/decisions/0005-queue-finalization.md`.
- **Effort:** 2 points.

**CP2-A — hard architecture/data contract freeze:** cả bốn contract packs được ký; schema/job/API changes sau gate cần owner provider và consumer review.

#### Wave P2-B — foundations (chạy đồng thời)

##### P2-B1 — Map schema và scheduler ports

- **Owner:** TV1. **Review:** TV4.
- **Depends on:** CP2-A.
- **Deliverable:** map validator/checksum và deterministic pair/side-swap domain ports.
- **Acceptance:** chặn overlap/out-of-bounds/unreachable; no self-pair; same snapshot/seed cho same plan.
- **Verify:** table/property tests.
- **Files (5):** `src/maps/schema.ts`, `src/maps/checksum.ts`, `src/rankings/scheduler.ts`, `tests/maps/schema.test.ts`, `tests/rankings/scheduler.test.ts`.
- **Effort:** 5 points.

##### P2-B2 — Docker local stack, config và runtime policy

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** CP2-A.
- **Deliverable:** PostgreSQL/Redis/MinIO Compose, fail-fast env config và pinned Python runtime policy.
- **Acceptance:** localhost-only, health checks, reset workflow, non-root/read-only/no-network profile.
- **Verify:** Compose health + config tests + image policy assertions.
- **Files (5):** `compose.yaml`, `.env.example`, `src/config/env.ts`, `docker/bot-runtime/Dockerfile`, `tests/config/env.test.ts`.
- **Effort:** 5 points.

##### P2-B3 — Core schema, migration và repository ports

- **Owner:** TV3. **Review:** TV4.
- **Depends on:** CP2-A.
- **Deliverable:** core PostgreSQL schema, first migration, transaction boundary và typed repository ports.
- **Acceptance:** immutable IDs, result/rating uniqueness và audit metadata; clean migration/rollback strategy.
- **Verify:** PostgreSQL integration test trên database sạch.
- **Files (5):** `src/db/schema.ts`, `src/db/client.ts`, `src/db/ports.ts`, `migrations/0001_phase2_core.sql`, `tests/db/schema.integration.test.ts`.
- **Effort:** 5 points.

##### P2-B4 — MatchJob, queue port và in-memory harness

- **Owner:** TV4. **Review:** TV3.
- **Depends on:** CP2-A.
- **Deliverable:** pinned versioned MatchJob, queue port, fake/in-memory adapter và contract suite.
- **Acceptance:** payload không chứa mutable “active bot”; duplicate/retry/cancel semantics rõ.
- **Verify:** adapter contract tests chạy không cần Redis.
- **Files (4):** `src/queue/match-job.ts`, `src/queue/queue.ts`, `src/queue/in-memory-queue.ts`, `tests/queue/queue.contract.test.ts`.
- **Effort:** 4 points.

**CP2-B — foundation checkpoint:** contracts compile với bốn foundation; DB/Compose/queue fakes sẵn sàng cho các lane tiếp theo.

#### Wave P2-C — domain/runtime cores (chạy đồng thời)

##### P2-C1 — Pure series scoring và Elo calculation

- **Owner:** TV1. **Review:** TV4.
- **Depends on:** P2-B1.
- **Deliverable:** series scoring, Elo formula, rating snapshot/projection interfaces.
- **Acceptance:** side order không đổi score/delta; forfeit tính, infra/cancel không tính; pure/idempotent inputs.
- **Verify:** golden formula + property tests.
- **Files (4):** `src/rankings/series.ts`, `src/rankings/elo.ts`, `tests/rankings/series.test.ts`, `tests/rankings/elo.test.ts`.
- **Effort:** 5 points.

##### P2-C2 — Sandbox runner core

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** P2-B2, P1-C2.
- **Deliverable:** SandboxBotClient runner, quota/error classification và deterministic cleanup.
- **Acceptance:** timeout/OOM/fork/cancel cleanup toàn bộ container/process/network/temp volume.
- **Verify:** Docker integration tests success + failure cases.
- **Files (3):** `src/sandbox/runner.ts`, `src/sandbox/docker-runner.ts`, `tests/sandbox/docker-runner.integration.test.ts`.
- **Effort:** 5 points.

##### P2-C3 — Team và RBAC vertical slice

- **Owner:** TV3. **Review:** TV2.
- **Depends on:** P2-B3.
- **Deliverable:** auth adapter, server-side authorization, team service/repository và audit.
- **Acceptance:** role/team isolation đúng; unauthorized ổn định; privileged mutation có audit.
- **Verify:** service/integration permission matrix.
- **Files (5):** `src/auth/authorize.ts`, `src/teams/service.ts`, `src/teams/repository.ts`, `tests/teams/service.test.ts`, `tests/auth/authorize.test.ts`.
- **Effort:** 5 points.

##### P2-C4 — BullMQ adapter và worker shell bằng fakes

- **Owner:** TV4. **Review:** TV2.
- **Depends on:** P2-B2, P2-B4.
- **Deliverable:** Redis/BullMQ adapter, worker claim/heartbeat/cancel shell dùng fake sandbox/repository.
- **Acceptance:** lease expiry/duplicate/retry cap; bot fault không retry mù; config fault chặn trước run.
- **Verify:** Redis integration + fake-worker contract tests.
- **Files (5):** `src/queue/bullmq-queue.ts`, `src/workers/match-worker.ts`, `tests/queue/bullmq.integration.test.ts`, `tests/workers/match-worker.fake.test.ts`, `tests/workers/fixtures.ts`.
- **Effort:** 5 points.

**CP2-C — core checkpoint:** pure ranking, sandbox, RBAC và worker shell pass độc lập qua ports/fakes.

#### Wave P2-D — adapters (chạy đồng thời)

##### P2-D1 — Round/series scheduling service

- **Owner:** TV1. **Review:** TV3.
- **Depends on:** P2-B1, P2-B3, P2-C1.
- **Deliverable:** eligible snapshot, cutoff, immutable schedule, two-game side swap qua repository ports.
- **Acceptance:** late upload không đổi job; odd team/repeat opponent deterministic; map/submission/seed pinned.
- **Verify:** integration tests dùng repository test adapter.
- **Files (4):** `src/rankings/round-service.ts`, `src/rankings/series-service.ts`, `tests/rankings/round-service.test.ts`, `docs/scheduling-policy.md`.
- **Effort:** 5 points.

##### P2-D2 — Artifact validation và S3/MinIO adapter

- **Owner:** TV2. **Review:** TV3.
- **Depends on:** P2-B2, CP2-A.
- **Deliverable:** streaming upload boundary, SHA-256, immutable S3 storage và malicious archive validation.
- **Acceptance:** chặn traversal/symlink/special/oversize; không buffer toàn archive; không dùng API MinIO riêng.
- **Verify:** MinIO integration + security corpus.
- **Files (5):** `src/storage/artifact-store.ts`, `src/storage/s3-artifact-store.ts`, `src/submissions/archive-validator.ts`, `tests/storage/s3.integration.test.ts`, `tests/security/archive-upload.test.ts`.
- **Effort:** 5 points.

##### P2-D3 — Submission lifecycle và persistence

- **Owner:** TV3. **Review:** TV1.
- **Depends on:** P2-B3, P2-C3.
- **Deliverable:** submission state machine, repository adapter, activate/revoke/cutoff rules.
- **Acceptance:** mỗi team/stage tối đa một ACTIVE; transition invalid bị reject/audit; concurrent activation an toàn.
- **Verify:** unit + PostgreSQL concurrency tests.
- **Files (5):** `src/submissions/types.ts`, `src/submissions/service.ts`, `src/submissions/postgres-repository.ts`, `tests/submissions/service.test.ts`, `tests/submissions/activation.concurrent.test.ts`.
- **Effort:** 5 points.

##### P2-D4 — Worker, sandbox và attempt integration

- **Owner:** TV4. **Review:** TV2 và TV3.
- **Depends on:** P2-B3, P2-C2, P2-C4.
- **Deliverable:** real SandboxBotClient + attempt repository + worker lease/heartbeat integration.
- **Acceptance:** worker death retry được; bot/infra/config outcomes phân loại đúng; không official result tại bước này.
- **Verify:** controlled worker death, cancellation, lease expiry và sandbox fault tests.
- **Files (4):** `src/orchestration/attempt-service.ts`, `src/orchestration/attempt-repository.ts`, `tests/workers/match-worker.integration.test.ts`, `tests/workers/worker-death.integration.test.ts`.
- **Effort:** 5 points.

**CP2-D — adapter checkpoint:** upload/storage, submissions, schedule và worker attempts hoạt động trên local infrastructure; chưa bật rating/finalize side effects.

#### Wave P2-E — transaction và API capabilities (chạy đồng thời)

##### P2-E1 — Rating ledger và leaderboard backend

- **Owner:** TV1. **Review:** TV4.
- **Depends on:** P2-C1, P2-D1, P2-B3.
- **Deliverable:** append-only rating ledger, one-snapshot round application và leaderboard projection.
- **Acceptance:** order worker không đổi delta; apply lại series không tạo entry thứ hai; W-D-L/forfeit đúng.
- **Verify:** PostgreSQL round integration + idempotency tests.
- **Files (5):** `src/rankings/rating-service.ts`, `src/rankings/rating-repository.ts`, `src/rankings/leaderboard.ts`, `tests/rankings/rating.integration.test.ts`, `tests/rankings/leaderboard.integration.test.ts`.
- **Effort:** 5 points.

##### P2-E2 — Sandbox và upload security corpus

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** P2-C2, P2-D2.
- **Deliverable:** automated attack corpus cho network/host/socket/fork/quota/archive boundaries.
- **Acceptance:** mọi forbidden access bị chặn; cleanup sau attack; evidence không lộ secret/policy nhạy cảm.
- **Verify:** repeated security suite trên clean Docker state.
- **Files (4):** `tests/security/network-isolation.test.ts`, `tests/security/resource-cleanup.test.ts`, `tests/security/host-access.test.ts`, `docs/evidence/phase-2-security.md`.
- **Effort:** 4 points.

##### P2-E3 — Fastify team/submission API

- **Owner:** TV3. **Review:** TV2.
- **Depends on:** P2-C3, P2-D2, P2-D3.
- **Deliverable:** server composition, team/submission routes, streamed upload và stable error envelope.
- **Acceptance:** team isolation; status/validation errors rõ; private artifact/log không public; audit mutations.
- **Verify:** HTTP contract + RBAC integration matrix.
- **Files (5):** `src/http/server.ts`, `src/http/routes/teams.ts`, `src/http/routes/submissions.ts`, `tests/http/teams.integration.test.ts`, `tests/http/submissions.integration.test.ts`.
- **Effort:** 5 points.

##### P2-E4 — Exactly-once result finalization

- **Owner:** TV4. **Review:** TV3.
- **Depends on:** P2-B3, P2-D4.
- **Deliverable:** transactional official result/event reference, unique idempotency key và audit.
- **Acceptance:** concurrent finalize chỉ một winner; infra attempt không finalize; retry trả official result cũ.
- **Verify:** PostgreSQL concurrent transaction tests.
- **Files (4):** `src/orchestration/finalize.ts`, `src/orchestration/result-repository.ts`, `migrations/0002_result_idempotency.sql`, `tests/orchestration/finalize.concurrent.test.ts`.
- **Effort:** 5 points.

**CP2-E — transaction/API checkpoint:** one official result, secure submission API và rating backend có test độc lập; chưa coi full qualification E2E là pass.

#### Wave P2-F — user-facing và domain acceptance (chạy đồng thời)

##### P2-F1 — Ranking determinism acceptance

- **Owner:** TV1. **Review:** TV3.
- **Depends on:** P2-D1, P2-E1, P2-E4.
- **Deliverable:** AC-07/08 evidence cho side swap, cutoff snapshot, Elo order independence và duplicate apply.
- **Acceptance:** cùng snapshot/seed/results cho cùng schedule/ledger/leaderboard.
- **Verify:** repeated full-round integration suite.
- **Files (3):** `tests/acceptance/ranking-round.test.ts`, `tests/acceptance/rating-order.test.ts`, `docs/evidence/phase-2-ranking.md`.
- **Effort:** 4 points.

##### P2-F2 — Sandbox security acceptance

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** P2-E2, P2-D4.
- **Deliverable:** AC-04/11/12 evidence nối sandbox với worker outcome classification.
- **Acceptance:** attack bị stop/revoke path; infra fault không thành team loss; descendants bị dọn.
- **Verify:** worker+sandbox security integration suite.
- **Files (4):** `tests/acceptance/sandbox-worker.test.ts`, `tests/acceptance/infra-fault.test.ts`, `tests/acceptance/submission-security.test.ts`, `docs/evidence/phase-2-execution.md`.
- **Effort:** 4 points.

##### P2-F3 — API authorization và data-integrity acceptance

- **Owner:** TV3. **Review:** TV1.
- **Depends on:** P2-E3, P2-E4.
- **Deliverable:** cross-team denial, audit completeness, immutable artifact/result và public/private projection tests.
- **Acceptance:** không IDOR/source/log leak; result/submission history không mất khi account/team state đổi.
- **Verify:** adversarial API/data integration suite.
- **Files (4):** `tests/acceptance/api-authorization.test.ts`, `tests/acceptance/data-integrity.test.ts`, `tests/acceptance/audit-log.test.ts`, `docs/evidence/phase-2-control-plane.md`.
- **Effort:** 4 points.

##### P2-F4 — React/Vite submission và leaderboard portal

- **Owner:** TV4. **Review:** TV3 và TV1.
- **Depends on:** P2-E1, P2-E3.
- **Deliverable:** typed API client, submission status, public leaderboard và component tests.
- **Acceptance:** không gọi private storage/worker; loading/error/empty rõ; keyboard/basic accessibility pass.
- **Verify:** component/API contract tests + production build.
- **Files (5):** `web/src/api/client.ts`, `web/src/pages/SubmissionPage.tsx`, `web/src/pages/LeaderboardPage.tsx`, `web/src/App.tsx`, `web/src/pages/pages.test.tsx`.
- **Effort:** 5 points.

**CP2-F — acceptance checkpoint:** ba backend/security evidence lanes và portal pass độc lập; qualification E2E có đủ component để chạy.

#### Wave P2-G — final evidence và operations (chạy đồng thời)

##### P2-G1 — Ranking/load edge cases

- **Owner:** TV1. **Review:** TV4.
- **Depends on:** CP2-F, tournament scale decision.
- **Deliverable:** edge cases odd teams/repeat bands/draw/forfeit và scheduler/rating load evidence.
- **Acceptance:** target scale hoàn thành trong ngân sách; capacity không làm đổi pairing/rating.
- **Verify:** deterministic load profile + formula regression suite.
- **Files (3):** `tests/load/ranking.load.test.ts`, `tests/rankings/edge-cases.test.ts`, `docs/evidence/phase-2-load.md`.
- **Effort:** 4 points.

##### P2-G2 — Observability, canary và incident runbook

- **Owner:** TV2. **Review:** TV4.
- **Depends on:** CP2-F.
- **Deliverable:** structured logs/metrics, sandbox canary, worker/storage/queue incident procedures.
- **Acceptance:** correlation API→job→attempt→finalize; alerts queue age/worker/finalize; secret/source redacted.
- **Verify:** canary + alert assertions + tabletop worker/storage failure.
- **Files (5):** `src/observability/logging.ts`, `src/observability/metrics.ts`, `src/observability/canary.ts`, `docs/phase-2-runbook.md`, `docs/incident-runbook.md`.
- **Effort:** 5 points.

##### P2-G3 — Persistence, audit và restore drill

- **Owner:** TV3. **Review:** TV1.
- **Depends on:** CP2-F.
- **Deliverable:** migration rehearsal, DB/artifact metadata backup-restore và audit integrity evidence.
- **Acceptance:** restore giữ official result/rating/audit relations; migration repeat/rollback strategy được chứng minh.
- **Verify:** clean database restore drill + checksum comparison.
- **Files (4):** `tests/operations/restore.integration.test.ts`, `tests/operations/migration.integration.test.ts`, `docs/db-restore-runbook.md`, `docs/evidence/phase-2-restore.md`.
- **Effort:** 4 points.

##### P2-G4 — Qualification E2E, CI matrix và release gate

- **Owner:** TV4. **Review:** cả nhóm.
- **Depends on:** CP2-F.
- **Deliverable:** upload→validate→activate→schedule→sandbox→finalize→Elo→leaderboard E2E, full CI matrix và gate report.
- **Acceptance:** AC-04…08/11/12 pass; duplicate delivery/worker death không duplicate result/Elo; clean environment reproducible.
- **Verify:** full CI, repeated E2E, GitNexus refresh/detect-changes và multi-axis review.
- **Files (5):** `tests/e2e/qualification.e2e.test.ts`, `tests/e2e/duplicate-delivery.e2e.test.ts`, `tests/e2e/worker-death.e2e.test.ts`, `.github/workflows/ci.yml`, `docs/evidence/phase-2-gate.md`.
- **Effort:** 5 points.

**CP2-G — hard Phase 2 gate:** P2-G1…G4 pass; không Critical/High security finding; runbook/restore/load drills đạt target; manager chấp nhận evidence pack.

### 7.5 Lịch soft-wave đề xuất cho bốn người

Mỗi ô là task chính của người đó. Wave sau có thể bắt đầu sớm khi dependency trực tiếp đã merge; hard gate vẫn bắt buộc.

| Thời gian | TV1 | TV2 | TV3 | TV4 | Checkpoint |
| --- | --- | --- | --- | --- | --- |
| W0 | P1-A1 | P1-A2 | P1-A3 | P1-A4 | CP1-A |
| W1 | P1-B1 | P1-B2 | P1-B3 | P1-B4 | CP1-B |
| W2 đầu | P1-C1 | P1-C2 | P1-C3 | P1-C4 | CP1-C |
| W2 cuối | P1-D1 | P1-D2 | P1-D3 | P1-D4 | CP1-D |
| W3 đầu | P2-A1 | P2-A2 | P2-A3 | P2-A4 | CP2-A |
| W3 cuối | P2-B1 | P2-B2 | P2-B3 | P2-B4 | CP2-B |
| W4 đầu | P2-C1 | P2-C2 | P2-C3 | P2-C4 | CP2-C |
| W4 cuối | P2-D1 | P2-D2 | P2-D3 | P2-D4 | CP2-D |
| W5 đầu | P2-E1 | P2-E2 | P2-E3 | P2-E4 | CP2-E |
| W5 cuối | P2-F1 | P2-F2 | P2-F3 | P2-F4 | CP2-F |
| W6 | P2-G1 | P2-G2 | P2-G3 | P2-G4 | CP2-G |

### 7.6 Cân bằng khối lượng sau khi chia lại

Effort point chỉ dùng để cân tải tương đối. Review và checkpoint không cộng riêng.

| Thành viên | Phase 1 | Phase 2 | Tổng | Lệch so với trung bình 43,75 |
| --- | ---: | ---: | ---: | ---: |
| TV1 | 12 | 30 | 42 | -1,75 |
| TV2 | 14 | 30 | 44 | +0,25 |
| TV3 | 14 | 30 | 44 | +0,25 |
| TV4 | 14 | 31 | 45 | +1,25 |

Chênh lệch tối đa 3 point (~7%). Nếu một người bị block, họ ưu tiên review/fixture của wave hiện tại, không tự ý sửa file thuộc lane khác.

### 7.7 Quy tắc branch, file ownership và tích hợp

- Branch/task sống tối đa khoảng hai ngày; dùng tên `feature/<task-id>-<slug>`.
- Trong cùng wave, owner không sửa file của task khác. Shared hotspots có owner cố định: `package.json`/CI = TV4; game contract = TV1; protocol = TV2; DB schema = TV3.
- Port/fake merge trước adapter; consumer không import trực tiếp BullMQ, Docker, PostgreSQL hay MinIO.
- Mỗi PR gồm code + focused tests + contract/docs liên quan; không có PR “code trước, test sau”.
- Mỗi checkpoint chạy typecheck, focused/full tests phù hợp, `git diff --check`, GitNexus refresh khi symbols đổi và `detect-changes` không partial/truncated.
- Contract/schema migration chỉ merge khi provider owner và mọi direct consumer đã review.
- Daily 15 phút chỉ xử lý contract drift, dependency block, file collision và evidence; không báo cáo trạng thái dài.


## 8. Test Strategy

### 8.1 Test pyramid và owner

| Tầng | Owner chính | Phase 1 | Phase 2 |
| --- | --- | --- | --- |
| Unit | Chủ module | Engine, parser, event/hash | Map, lifecycle, scheduler, Elo |
| Contract | TV1+TV2; API do TV3 | Protocol v1 | API/job/map/event schemas |
| Integration | Chủ adapter | Child process, MatchRunner | PostgreSQL, Redis, MinIO, Docker |
| Concurrency | TV3+TV4 | stale response/turn | duplicate job, lease, finalization, rating |
| Security | TV2 | output/command injection boundaries | archive, network, filesystem, quotas, fork bomb |
| E2E | TV4, domain owners review | CLI two bots | submission-to-leaderboard |
| Determinism | TV1+TV4 | event/final hash | schedule/rating snapshot |
| Load/operability | TV4 | smoke only | queue capacity, sandbox concurrency, recovery |

### 8.2 Required scenario matrix

**Phase 1**

- Initial board, goal and RPS relation exact.
- 8 directions, boundary, obstacle, friendly/enemy rules.
- Invalid action leaves board unchanged; skip increments turn/revision once.
- Late/stale/wrong-turn/oversized/malformed action rejected.
- Timeout skip; fatal process fault follows approved forfeit policy.
- Match win by goal/elimination, turn limit, cleanup on every exit.
- Same artifact/config/seed returns same event sequence/final hash when no timing fault.

**Phase 2**

- Malicious archive types and cross-team access denied.
- Active submission uniqueness and cutoff pin under concurrent requests.
- Sandbox blocks Internet, host filesystem, Docker socket; kills descendants.
- Queue duplicate/lease expiry/worker crash do not duplicate official result.
- Infra error retries without team fault/Elo; bot forfeit does count.
- Two-game series swaps sides and uses pinned map/submissions.
- All series in a round use one rating snapshot; apply order does not affect rating.
- End-to-end AC-04…08/11/12 and load/capacity test.

### 8.3 Planned verification commands

Các command sau chỉ hợp lệ sau P1-A4/P2-B2 tạo toolchain; hiện chưa tồn tại và không được coi là bằng chứng hiện tại:

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:integration
npm run test:e2e
npm run test:security
npm run test:load
```

Các command hiện đã được xác minh tồn tại:

```bash
git diff --check
node .gitnexus/run.cjs analyze --index-only --pdg
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

## 9. Risk and Impact Analysis

| Risk | Mức | Owner | Giảm thiểu / gate |
| --- | --- | --- | --- |
| Greenfield nên estimate/path có thể đổi | High | Manager | Gate 0 + CP1-A/CP2-A; replan khi stack đổi |
| Crash policy giữa plan cũ và spec mới mâu thuẫn | High | TV1 | Chốt tại CP1-A; contract test, không code behavior trước |
| Repo tham chiếu không có LICENSE | High | Manager/TV1 | Clean-room spec + parity tests; không copy code |
| Shared contracts gây merge conflict bốn người | High | TV1/TV3 | CP1-A/CP2-A, designated owner, branch ngắn và file ownership theo wave |
| Song song giả làm consumer chờ implementation hoặc sửa cùng hotspot | High | Manager/TV4 | Contract + ports/fakes trước; bốn file-set riêng mỗi wave; hard gate chỉ tại contract/phase boundary |
| Timeout test flaky theo wall-clock | High | TV2 | Monotonic injected clock + controlled process |
| Sandbox Docker không đủ hardening trên host | Critical | TV2 | Non-root/read-only/no-network/seccomp/caps; security gate; cân nhắc gVisor/VM nếu risk model yêu cầu |
| Archive upload/path traversal | High | TV2/TV3 | Streaming limits, reject links/special paths, corpus tests |
| Queue at-least-once tạo result/Elo trùng | Critical | TV3/TV4 | DB unique key + transactional finalizer + concurrency tests |
| Worker chết giữa Engine và finalize | High | TV4 | Attempt/result separation, lease/retry, idempotent finalize |
| Rating phụ thuộc thứ tự worker | High | TV1 | Round snapshot + apply after finalized set |
| Artifact/map/config drift | High | TV3 | Immutable IDs + SHA-256/image digest in MatchJob |
| TV4 thành bottleneck tích hợp | Medium | Manager | Owner tự viết tests; checkpoints phân tán; TV1/2/3 review domain |
| Không đủ máy cho sandbox/load test | High | Manager | Chốt quota/capacity ở D-08; benchmark canary trước W4 |
| Untracked working tree làm mất plan/spec | High | Manager | Commit docs/plan trước implementation; không reset/delete thay đổi hiện có |

Impact graph hiện không có d=1 dependent nào để liệt kê; đây không phải all-clear vì `risk: UNKNOWN`. Downstream consumers trong bảng trên là quan hệ thiết kế dự kiến, phải được re-index và impact lại khi symbols xuất hiện.

## 10. Files Expected to Change

| File/nhóm file | Symbols | Reason |
| --- | --- | --- |
| `package.json`, toolchain config | — (new) | Build/test/workspace scripts |
| `src/game/**` | — (new) | Pure game rules/types/fixtures |
| `src/protocol/**` | — (new) | Versioned bot messages + validator |
| `src/bots/**`, `src/sandbox/**` | — (new) | Local and sandbox BotClient adapters |
| `src/match/**` | — (new) | Events/result/MatchRunner |
| `src/db/**`, `migrations/**` | — (new) | Phase 2 durable state/idempotency |
| `src/auth/**`, `src/teams/**`, `src/submissions/**` | — (new) | Control-plane lifecycle/RBAC |
| `src/maps/**`, `src/rankings/**` | — (new) | Map/schedule/Elo/leaderboard |
| `src/queue/**`, `src/workers/**`, `src/orchestration/**` | — (new) | Execution orchestration/finalization |
| `src/http/**`, `web/src/**` | — (new) | API and minimal Phase 2 portal |
| `tests/**` | — (new) | Unit/contract/integration/security/E2E/load |
| `.github/workflows/ci.yml` | — (new) | Quality gates |
| `docs/phase-*.md`, `docs/decisions/**` | — (new) | Contracts, ADRs, runbooks |

No existing implementation symbol is named because none exists. Exact exports/classes are designed at CP1-A/CP2-A and must be impact-checked before later changes.

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: "Implement Phase 1 and Phase 2 through four parallel owner-exclusive lanes, contract gates and full lifecycle testing."
  acceptance_criteria:
    - "Phase 1 passes AC-01..AC-03 plus deterministic replayable event output."
    - "Phase 2 passes AC-04..AC-08, AC-11 and AC-12."
    - "Every implementation wave exposes four owner-exclusive parallel tasks; contract and phase gates block unsafe downstream work."
    - "No implementation task exceeds five expected files or overlaps a same-wave owner file set without replanning."

  evidence_provenance:
    schema_version: 2
    head_commit: "ccd310ce44b7f09b81a8bac33713267c1175648e"
    generated_plan_path: "docs/plans/2026-10-08-gitnexus-plan-phase-one-two-delivery.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "cdce34d33c57861079eda3cdb2eac8047d7f4037e20cc1eb123cd5ace75e6f52"
    cited_path_manifest:
      - path: ".github/workflows/ci.yml"
        object_kind:
          head: "absent"
          index: "absent"
          worktree: "absent"
          untracked: "absent"
        state: "absent"
        rename_from: null
        rename_to: null
        head_digest: "absent"
        index_digest: "absent"
        worktree_digest: "absent"
        untracked_digest: "absent"
      - path: "AGENTS.md"
        object_kind:
          head: "absent"
          index: "absent"
          worktree: "absent"
          untracked: "regular"
        state: "untracked"
        rename_from: null
        rename_to: null
        head_digest: "absent"
        index_digest: "absent"
        worktree_digest: "absent"
        untracked_digest: "sha256:55ab1a4521626bd188ace0f226c3dbb6c2cd644e7d00593deb9d21909a9ad4c6"
      - path: "docs/tai-lieu-yeu-cau.md"
        object_kind:
          head: "absent"
          index: "absent"
          worktree: "absent"
          untracked: "regular"
        state: "untracked"
        rename_from: null
        rename_to: null
        head_digest: "absent"
        index_digest: "absent"
        worktree_digest: "absent"
        untracked_digest: "sha256:63c9caa0e0f402eb5db2c185101e205587b933b42cac194d030edf26cd47710b"
      - path: "package.json"
        object_kind:
          head: "absent"
          index: "absent"
          worktree: "absent"
          untracked: "absent"
        state: "absent"
        rename_from: null
        rename_to: null
        head_digest: "absent"
        index_digest: "absent"
        worktree_digest: "absent"
        untracked_digest: "absent"
      - path: "tasks/plan.md"
        object_kind:
          head: "absent"
          index: "absent"
          worktree: "absent"
          untracked: "regular"
        state: "untracked"
        rename_from: null
        rename_to: null
        head_digest: "absent"
        index_digest: "absent"
        worktree_digest: "absent"
        untracked_digest: "sha256:7cbe4b1dbae4d282f6ce2064649ade09c8fb7767dda725650824d6335a82d9ae"
      - path: "tasks/todo.md"
        object_kind:
          head: "absent"
          index: "absent"
          worktree: "absent"
          untracked: "regular"
        state: "untracked"
        rename_from: null
        rename_to: null
        head_digest: "absent"
        index_digest: "absent"
        worktree_digest: "absent"
        untracked_digest: "sha256:7fbccaa00c55154a13a04f6b097a79d4ba1deb35a6af420c7fcaeb42c8a98ed5"

  primary_symbols: []
  related_symbols: []
  execution_path:
    - "Upload and validate immutable submission artifact."
    - "Freeze round snapshot and schedule side-swapped series."
    - "Enqueue pinned match job."
    - "Worker runs MatchRunner through two isolated BotClient adapters."
    - "Finalizer accepts one official result and writes audit evidence."
    - "Rating service applies one ledger delta and updates leaderboard projection."

  pdg_constraints:
    - description: "No executable functions exist; PDG refresh/probe returned zero flows/results."
      affected_statements: []
      implementation_consequence: "Re-run analyze --pdg and impact once MatchRunner/finalizer/rating symbols exist."

  architectural_patterns:
    - pattern: "Pure domain core behind ports/adapters"
      example_location: "docs/tai-lieu-yeu-cau.md:547"
      usage_guidance: "Keep game/ranking logic independent from HTTP, DB, queue and Docker."
    - pattern: "Immutable pinned artifacts"
      example_location: "docs/tai-lieu-yeu-cau.md:329"
      usage_guidance: "Match jobs carry submission/map/image/config identities and hashes."
    - pattern: "At-least-once transport, exactly-once business effect"
      example_location: "docs/tai-lieu-yeu-cau.md:526"
      usage_guidance: "Enforce with DB uniqueness and transactional finalization."

  files_to_modify:
    - file: "package.json"
      symbols: []
      intended_change: "Create verified build/test scripts in P1-A4."
    - file: "src/game/**"
      symbols: []
      intended_change: "Create Phase 1 pure engine."
    - file: "src/protocol/**"
      symbols: []
      intended_change: "Create Bot Protocol v1."
    - file: "src/bots/**"
      symbols: []
      intended_change: "Create local process adapter and later sandbox adapter."
    - file: "src/match/**"
      symbols: []
      intended_change: "Create event/result model and MatchRunner."
    - file: "src/submissions/**"
      symbols: []
      intended_change: "Create Phase 2 submission lifecycle."
    - file: "src/sandbox/**"
      symbols: []
      intended_change: "Create Phase 2 sandbox execution."
    - file: "src/queue/**"
      symbols: []
      intended_change: "Create Phase 2 match job queue."
    - file: "src/rankings/**"
      symbols: []
      intended_change: "Create deterministic scheduling, Elo and leaderboard."

  tests:
    - file: "tests/game/engine.test.ts"
      scenarios: ["8-direction movement", "RPS capture matrix", "goal/elimination", "invalid action immutability"]
    - file: "tests/protocol/validation.test.ts"
      scenarios: ["valid messages", "version/match/turn mismatch", "malformed/oversized NDJSON"]
    - file: "tests/match/match-runner.test.ts"
      scenarios: ["normal win", "timeout skip", "fatal forfeit", "turn limit", "cleanup"]
    - file: "tests/orchestration/finalize.concurrent.test.ts"
      scenarios: ["duplicate worker finalization produces one official result"]
    - file: "tests/e2e/qualification.e2e.test.ts"
      scenarios: ["upload → validate → schedule → sandbox → finalize → Elo → leaderboard"]
    - file: "tests/security/network-isolation.test.ts"
      scenarios: ["Internet, host filesystem and opponent access are denied"]

  verification_commands:
    - "git diff --check"
    - "node .gitnexus/run.cjs analyze --index-only --pdg"
    - "node .gitnexus/run.cjs detect-changes --scope all --repo ."

  risks:
    - "Greenfield paths remain provisional until CP1-A/CP2-A; the technology stack is confirmed."
    - "Sandbox and exactly-once finalization are critical-risk boundaries."
    - "The source requirement and plans are untracked in the current working tree."

  assumptions:
    - "Confirm D-04/D-06 before CP1-A; re-open the gate if the contract changes."
    - "Confirm D-07..D-10 before CP2-A; re-open the gate if execution/ranking contracts change."
    - "Re-verify exact file layout after P1-A4 because no source tree exists yet."

  open_questions:
    - "Minimal local auth or existing SSO for Phase 2?"
    - "Exact runtime resource limits and sandbox technology beyond Docker?"
    - "Quantitative throughput/latency/load-test targets?"
    - "Should the minimal Phase 2 portal ship in the same repository/workspace?"

  avoid:
    - "Do not copy code from the unlicensed reference repository."
    - "Do not let engine import HTTP, database, queue, Docker or UI."
    - "Do not treat infrastructure failure as a team loss."
    - "Do not update Elo outside the idempotent finalization/ledger boundary."
    - "Do not allow bot network egress or Docker socket access."
    - "Do not overwrite or delete the existing untracked spec/plan files."
    - "Do not start a same-wave task by editing another owner’s file set; use the frozen port/fake or route through the checkpoint."
```

## 12. Assumptions and Open Questions

### Confirmed decisions

- [confirmed 2026-10-08] Node.js 22 + TypeScript + Vitest là baseline chung.
- [confirmed 2026-10-08] Phase 2 dùng Fastify/PostgreSQL/Redis-BullMQ/S3-compatible storage/React-Vite.
- [confirmed 2026-10-08] Local PostgreSQL, Redis và MinIO chạy bằng Docker Compose, chỉ publish trên `localhost`; MinIO là S3-compatible implementation ở môi trường phát triển.

### Assumptions used to make the plan actionable

- [assumed] npm là package manager cho workspace; xác nhận khi thực hiện P1-01 trước khi tạo lockfile.
- [assumed] One repository contains backend, worker and minimal portal; deployment units remain separable.
- [assumed] The spec proposals for D-04, D-06 and D-10 are accepted unless Gate 0 overrides them.
- [assumed] Docker is the initial sandbox mechanism; security review may require gVisor/VM before production.
- [assumed] Four people are available throughout W0–W6 and can review each other daily.

### Blocking questions

1. Phase 2 dùng tài khoản nội bộ tối thiểu hay tích hợp SSO/OIDC có sẵn?
2. Resource profile chính thức: CPU, RAM, PID, disk, startup timeout, log size?
3. Quy mô dự kiến: số đội, số series/vòng, thời gian phải hoàn tất một vòng?
4. Docker hardening có đủ theo threat model, hay bắt buộc gVisor/Firecracker/VM?
5. Minimal portal có nằm cùng repo/workspace không?

Các câu hỏi 1 và 5 phải chốt trước CP2-A; câu 2 và 4 trước P2-A2/P2-B2; câu 3 trước P2-A1/P2-G1.

### Explicitly deferred

- Phase 3: finals bracket, Replay/Spectator UI, caster staging/publishing.
- Multi-game platform abstraction ngoài các port cần cho Phase 1/2.
- Plagiarism detection, billing, chat và public live streaming.
- Tách Control Plane thành nhiều microservice khi chưa có số liệu.

### Evidence limitations

- Requirements, AGENTS và task files hiện là untracked; provenance pin theo exact untracked digest, không theo HEAD blob.
- GitNexus graph không có execution flow và `impact` cho requirement file là `UNKNOWN`; mọi graph claim phải re-evaluate sau khi code xuất hiện.
- Planning skill tham chiếu `definition-of-done.md` nhưng file này không tồn tại trong các skill roots đã kiểm tra; plan dùng Definition of Done của spec và các gate ở đây.

## 13. Definition of Done

### Plan ready

- [x] User chọn depth Deep.
- [x] GitNexus index refreshed with PDG and limitations recorded.
- [x] Phase 1–2 soft-wave graph gives each of four people one conflict-free task per wave; hard gates are explicit.
- [x] Every task has owner, dependency, acceptance, verification and ≤5 expected files.
- [x] Test matrix covers required Phase 1/2 acceptance scenarios.
- [ ] Manager approves the remaining Gate 0 blocking decisions; technology stack and local infrastructure are already confirmed.

### Phase 1 complete

- [ ] P1-A1…P1-D4 merged; CP1-A…CP1-D pass.
- [ ] AC-01, AC-02, AC-03 and determinism have automated evidence.
- [ ] Game branch coverage ≥90%; protocol/process/match error paths covered.
- [ ] Two Python bots run end-to-end through STDIO with parseable result/event log.
- [ ] No process/open-handle leak; timeout uses server monotonic clock.
- [ ] `npm ci`, typecheck, test, coverage and build pass on clean CI.
- [ ] GitNexus refreshed; detect-changes is neither partial nor truncated; Critical/High review findings resolved.
- [ ] Phase 1 contract/runbook reviewed before Phase 2 begins.

### Phase 2 complete

- [ ] P2-A1…P2-G4 merged; CP2-A…CP2-G pass.
- [ ] AC-04…AC-08, AC-11, AC-12 have automated or approved operational evidence.
- [ ] One full qualification round runs upload→leaderboard with pinned artifacts.
- [ ] Duplicate delivery/concurrent finalize cannot duplicate result or Elo.
- [ ] Sandbox network/filesystem/process/resource isolation tests pass; no Critical/High security finding remains.
- [ ] Infra failure retries without penalizing a team; bot forfeit follows the approved policy.
- [ ] Logs/metrics/correlation, canary, backup/restore and incident runbooks are exercised.
- [ ] Load test meets targets set from actual tournament scale.
- [ ] Public/team data authorization and secret/source redaction pass review.
- [ ] GitNexus graph refresh + detect-changes + multi-axis code review completed before handoff.
