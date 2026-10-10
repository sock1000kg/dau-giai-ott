# Task Checklist: Phase 1–2

**Trạng thái:** Đã tự động duyệt — có thể bắt đầu theo dependency
**Mức khuyến nghị:** Cao (`HIGH RECOMMEND`)
**Plan:** `tasks/plan.md`
**Nguồn:** `docs/team-assignment-phase-1-2.md`

> Chỉ bắt đầu khi dependency đã xong. Mỗi task là một PR nhỏ; nếu dự kiến vượt 5 file thì tách task trước khi code.
>
> Trạng thái/dependency trong file này là nguồn duy nhất để AI chọn task. Branch phải tạo từ `develop` với prefix owner quy định tại `docs/README.md`.
>
> Module TypeScript tạo và dùng `package.json` theo [convention package module](../docs/conventions/module-package.md). Trước `P1-T02`, verification chạy trong thư mục module bằng `npm --prefix src/<module> ...`.
>
> Mỗi task phải cập nhật tài liệu liên quan cùng branch với code. Chỉ tick `[x]` sau khi acceptance criteria, verification và docs sync đều hoàn tất; sau đó cập nhật diagram nếu task/checkpoint có node.

## Phase 1 — Gate 0: quyết định và workspace

### [x] P1-T01 — Khóa quyết định trước khi code

**Owner:** Đinh Đức Thuận
**Mô tả:** Chốt các lựa chọn còn mở để ba dev không tự tạo contract khác nhau.
**Acceptance criteria:** (1) Chốt source/layout, package manager, Python/entrypoint; (2) chốt Engine API, protocol/schema/fixtures, limits và fault policy; (3) project lead duyệt, consumers review tại checkpoint `P1-A`.
**Verification:** Parse JSON Schema/fixtures, đối chiếu ADR-0002 và xác nhận không còn quyết định Phase 1 chưa có đáp án.
**Dependencies:** Không.
**Files dự kiến:** `docs/decisions/0002-phase-1-engine-and-bot-protocol-v1.md`, `docs/contracts/engine-api-v1.md`, `docs/contracts/bot-protocol-v1.md`, `docs/contracts/bot-protocol-v1.schema.json`, `docs/contracts/fixtures/`
**Ước lượng:** M (5 logical paths)
**Hoàn tất:** 2026-10-09 — `HIGH RECOMMEND`, tự động duyệt bởi Đinh Đức Thuận.

### P1-D01 — Đã hủy, chuyển thành `P1-T02`

Không triển khai ID này. Workspace chung chuyển cho Đinh Đức Thuận dưới ID `P1-T02` (2026-10-09); ID `P1-D01` không được tái sử dụng.

### [ ] P1-L01 — Triển khai behavior baseline Human-vs-Human

**Owner:** Long Trần
**Mô tả:** Triển khai lại behavior baseline theo đặc tả và commit tham chiếu, không sao chép source chưa có LICENSE.
**Acceptance criteria:** (1) Ghi nguồn/commit hành vi; module không khởi động UI/process; (2) baseline test khóa spawn, move, combat, win; (3) không copy/submodule/package source tham chiếu.
**Verification:** `npm --prefix src/game-core test -- tests/baseline.test.ts && npm --prefix src/game-core run typecheck`.
**Dependencies:** `P1-T01`.
**Files dự kiến:** `src/game-core/package.json`, `src/game-core/src/index.ts`, `src/game-core/src/engine.ts`, `src/game-core/tests/baseline.test.ts`, `src/game-core/README.md`
**Ước lượng:** M (5 file)

## Phase 1 — Gate 1: hiện thực contract đã khóa

### [ ] P1-L02 — Hiện thực Engine API và domain types đã khóa

**Owner:** Long Trần
**Mô tả:** Hiện thực domain types, map types, `createGame` và public exports nền tảng từ `docs/contracts/engine-api-v1.md`; movement/lifecycle được hoàn thiện ở `P1-L05`–`P1-L07`.
**Acceptance criteria:** (1) Có đúng tên `GameState`, `PlayerSide`, `GameAction`, `GameResult`, error/reason types theo contract; (2) `createGame` tạo initial state deterministic và deep-copy spawn; (3) module không import process, timer, DB, network hoặc UI.
**Verification:** `npm --prefix src/game-core test -- tests/contract.test.ts && npm --prefix src/game-core run typecheck`.
**Dependencies:** `P1-L01`.
**Files dự kiến:** `src/game-core/src/types.ts`, `src/game-core/src/engine.ts`, `src/game-core/src/index.ts`, `src/game-core/tests/contract.test.ts`
**Ước lượng:** M (4 file)

### [ ] P1-L03 — Hiện thực Bot Protocol v1 types

**Owner:** Long Trần
**Mô tả:** Hiện thực types/error codes đúng contract v1 đã khóa để Nguyên và Đạt import qua public package entrypoint.
**Acceptance criteria:** (1) Đủ `INIT`, `STATE_UPDATE`, `ACTION`, `TURN_RESULT`, `MATCH_RESULT`, error code; (2) field/version, `matchId`, `turnId`, ordering, stdout/stderr đúng contract; (3) types phản ánh chính xác timeout, size, stale/illegal action và skip/forfeit đã khóa.
**Verification:** `npm --prefix src/bot-protocol run typecheck`; đối chiếu types với `docs/contracts/bot-protocol-v1.md` và schema.
**Dependencies:** `P1-L02`.
**Files dự kiến:** `src/bot-protocol/package.json`, `src/bot-protocol/src/messages.ts`, `src/bot-protocol/src/errors.ts`, `src/bot-protocol/src/index.ts`
**Ước lượng:** M (4 file)

### [ ] P1-L04 — Validator và contract tests từ schema/fixtures

**Owner:** Long Trần
**Mô tả:** Dùng schema/fixtures đã khóa để hiện thực runtime validator và contract tests.
**Acceptance criteria:** (1) Validator từ chối version/type/field/value sai và unknown field theo contract; (2) tests đọc trực tiếp schema/fixtures chuẩn trong `docs/contracts/`, không tạo bản sao thứ hai; (3) types, schema, fixtures không mâu thuẫn và không phụ thuộc core implementation.
**Verification:** `npm --prefix src/bot-protocol test -- tests/schema.test.ts && npm --prefix src/bot-protocol run typecheck`.
**Dependencies:** `P1-L03`.
**Files dự kiến:** `src/bot-protocol/src/validate.ts`, `src/bot-protocol/src/index.ts`, `src/bot-protocol/tests/schema.test.ts`
**Ước lượng:** M (3 file)

## Checkpoint P1-A — Executable contract baseline

- [ ] `P1-T01`, `P1-L01`–`P1-L04`, `P1-N01` và `P1-D02` hoàn tất.
- [ ] Python SDK và MatchRunner ports cùng dùng contract/schema/fixtures chuẩn, không tạo protocol/type semantics riêng.
- [ ] Thay đổi protocol sau gate phải do Long cập nhật và Nguyên, Đạt review.
- [ ] Chạy `node .gitnexus/run.cjs detect-changes --scope all --repo .` và xử lý cảnh báo HIGH/CRITICAL.

## Phase 1 — Lane Long: core và protocol

### [ ] P1-L05 — API điều khiển game theo side/action

**Owner:** Long Trần
**Mô tả:** Cho phép caller chọn action theo side mà không phụ thuộc input Human-vs-Human.
**Acceptance criteria:** (1) `listLegalActions` đúng side/state và deterministic; (2) `applyAction` không mutate và từ chối sai side/action bằng mã ổn định; (3) move/combat/win khớp baseline.
**Verification:** `npm --prefix src/game-core test -- tests/actions.test.ts && npm --prefix src/game-core run test:coverage`.
**Dependencies:** `P1-L04`.
**Files dự kiến:** `src/game-core/src/engine.ts`, `src/game-core/src/types.ts`, `src/game-core/tests/actions.test.ts`
**Ước lượng:** M (3 file)

### [ ] P1-L06 — Skip turn, maxTurns và GameResult

**Owner:** Long Trần
**Mô tả:** Bổ sung lifecycle runner cần khi bot lỗi hoặc trận chạm giới hạn lượt.
**Acceptance criteria:** (1) Skip chuyển turn/revision đúng contract; (2) trận dừng một lần khi thắng hoặc `maxTurns`, action sau kết thúc bị từ chối; (3) result có winner/draw và reason ổn định.
**Verification:** `npm --prefix src/game-core test -- tests/lifecycle.test.ts`.
**Dependencies:** `P1-L05`.
**Files dự kiến:** `src/game-core/src/engine.ts`, `src/game-core/src/types.ts`, `src/game-core/tests/lifecycle.test.ts`
**Ước lượng:** M (3 file)

### [ ] P1-L07 — Event transition và finalStateHash

**Owner:** Long Trần
**Mô tả:** Xuất transition deterministic để runner ghi log và replay.
**Acceptance criteria:** (1) Move/skip/end trả event đủ dữ liệu replay, không chứa timestamp ngẫu nhiên; (2) canonical serialization cho hash ổn định; (3) cùng input cho cùng event sequence/hash.
**Verification:** `npm --prefix src/game-core test -- tests/replay.test.ts`.
**Dependencies:** `P1-L06`.
**Files dự kiến:** `src/game-core/src/events.ts`, `src/game-core/src/hash.ts`, `src/game-core/src/engine.ts`, `src/game-core/tests/replay.test.ts`
**Ước lượng:** M (4 file)

### [ ] P1-L08 — Regression test và tài liệu core

**Owner:** Long Trần
**Mô tả:** Khóa tương thích Human-vs-Human và hướng dẫn dùng API công khai.
**Acceptance criteria:** (1) Regression phủ spawn, movement, combat, win, skip, turn limit; (2) branch coverage rule engine tối thiểu 90%; (3) README nêu API, invariant và phần core không chịu trách nhiệm.
**Verification:** `npm --prefix src/game-core test && npm --prefix src/game-core run test:coverage && npm --prefix src/game-core run typecheck`.
**Dependencies:** `P1-L07`.
**Files dự kiến:** `src/game-core/tests/regression.test.ts`, `src/game-core/tests/invariants.test.ts`, `src/game-core/README.md`
**Ước lượng:** M (3 file)

## Phase 1 — Lane Nguyên: bot Python kiểm thử

### [x] P1-N01 — Python Bot SDK tối thiểu

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo loop stdin/stdout xử lý protocol v1.
**Acceptance criteria:** (1) Xử lý đủ message server theo fixtures; (2) log chỉ stderr, stdout chỉ NDJSON và flush; (3) không phụ thuộc code TypeScript của core/runner.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_sdk.py'`.
**Dependencies:** `P1-T01`.
**Files dự kiến:** `src/bots/python/sdk.py`, `src/bots/python/tests/test_sdk.py`, `src/bots/python/__init__.py`
**Ước lượng:** M (3 file)

### [x] P1-N02 — FirstLegalBot

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Bot deterministic chọn action đầu tiên từ `legalActions`.
**Acceptance criteria:** (1) Mỗi state đúng lượt sinh một action đúng IDs; (2) lựa chọn deterministic, thoát sạch khi kết thúc/EOF; (3) chạy bằng entrypoint đã chốt.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_first_legal_bot.py'`.
**Dependencies:** `P1-N01`.
**Files dự kiến:** `src/bots/python/first_legal_bot.py`, `src/bots/python/tests/test_first_legal_bot.py`
**Ước lượng:** S (2 file)

### [x] P1-N03 — CaptureFirstBot

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Bot ưu tiên action bắt quân, fallback deterministic.
**Acceptance criteria:** (1) Ưu tiên capture hợp lệ; (2) không tự tính luật ngoài dữ liệu protocol; (3) test có cả nhánh có/không capture.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_capture_first_bot.py'`.
**Dependencies:** `P1-N01`.
**Files dự kiến:** `src/bots/python/capture_first_bot.py`, `src/bots/python/tests/test_capture_first_bot.py`
**Ước lượng:** S (2 file)

### [ ] P1-N04 — Bot malformed JSON, illegal action và stale turnId

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo bot cố ý vi phạm protocol cho error-path tests.
**Acceptance criteria:** (1) Có mode malformed, illegal và stale; (2) từng mode tái hiện độc lập qua argv; (3) mỗi mode chỉ gây lỗi mục tiêu.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_invalid_bots.py'`.
**Dependencies:** `P1-N01`.
**Files dự kiến:** `src/bots/python/invalid_bot.py`, `src/bots/python/tests/test_invalid_bots.py`
**Ước lượng:** S (2 file)

### [ ] P1-N05 — Bot timeout, crash và oversized output

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo process fixtures cho lifecycle/error handling.
**Acceptance criteria:** (1) Có mode không phản hồi, exit non-zero, output vượt limit; (2) không fork process ngoài kiểm soát và có thể terminate; (3) exit/delay/size deterministic.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_process_fault_bots.py'`.
**Dependencies:** `P1-N01`.
**Files dự kiến:** `src/bots/python/process_fault_bot.py`, `src/bots/python/tests/test_process_fault_bots.py`
**Ước lượng:** S (2 file)

### [ ] P1-N06 — Contract test và README bot

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Chứng minh bots tương thích fixtures mà không cần runner thật.
**Acceptance criteria:** (1) Test transcript và validate mọi stdout line; (2) README có lệnh chạy, I/O, example và fault modes; (3) toàn bộ Python tests chạy bằng một command.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests`.
**Dependencies:** `P1-N02`, `P1-N03`, `P1-N04`, `P1-N05`.
**Files dự kiến:** `src/bots/python/tests/test_contract.py`, `src/bots/python/tests/fixtures.py`, `src/bots/python/README.md`
**Ước lượng:** M (3 file)

## Phase 1 — Lane Đạt: MatchRunner và local integration

### [x] P1-D02 — GamePort, BotPort và fakes

**Owner:** Phạm Tất Đạt
**Mô tả:** Định nghĩa ranh giới runner và doubles để code không chờ core/bot thật.
**Acceptance criteria:** (1) `GamePort`/`BotPort` chỉ phơi contract cần thiết; (2) `FakeGame`/`ScriptedBot` deterministic; (3) runner tests không import concrete core/child process.
**Verification:** `npm --prefix src/match-runner test -- tests/ports.test.ts && npm --prefix src/match-runner run typecheck`.
**Dependencies:** `P1-L02`, `P1-L03`.
**Files dự kiến:** `src/match-runner/package.json`, `src/match-runner/src/ports.ts`, `src/match-runner/src/fakes.ts`, `src/match-runner/tests/ports.test.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** 2026-10-10 — `GamePort`/`BotPort` + `FakeGame`/`ScriptedBot` deterministic, 18 test pass, typecheck và build pass. Thêm `src/index.ts` (bắt buộc theo convention §1) và `README.md` (docs-as-code) nên 6 logical paths thay vì 4; thiếu `viewFor` so với sketch §8.2 và bổ sung `listLegalActions`/`forfeit`/`hash` theo Engine API §5/§8.

### [x] P1-D03 — MatchRunner happy path

**Owner:** Phạm Tất Đạt
**Mô tả:** Orchestrate hai BotPort theo lượt bằng FakeGame.
**Acceptance criteria:** (1) INIT một lần và chỉ hỏi bot đúng side/turn; (2) action hợp lệ được apply/broadcast đúng thứ tự; (3) kết thúc gửi một result nhất quán cho hai bot.
**Verification:** `npm --prefix src/match-runner test -- tests/happy-path.test.ts`.
**Dependencies:** `P1-D02`.
**Files dự kiến:** `src/match-runner/src/match-runner.ts`, `src/match-runner/src/types.ts`, `src/match-runner/tests/happy-path.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** 2026-10-10 — `runMatch(config, ports)` chạy vòng lặp happy path theo Bot Protocol §8: INIT một lần mỗi bot, chỉ hỏi bot của `state.turn` với `turnId = turnNumber`, `TURN_RESULT` broadcast cho X rồi O, một `MATCH_RESULT` nhất quán, `stop()` X rồi O trong `finally`; `legalActions` rỗng thì bot vẫn nhận `STATE_UPDATE` send-only qua `notifyStateUpdate` rồi runner skip `NO_LEGAL_ACTION` không chờ `ACTION` (§5.2/§8). Message outbound không chia sẻ reference mutable. 14 test mới + 21 test `ports.test.ts` pass, typecheck và build pass. Lỗi bot tạm throw `UNHANDLED_BOT_FAILURE` cho tới `P1-D04`.

### [ ] P1-D04 — MatchRunner error, skip và cleanup

**Owner:** Phạm Tất Đạt
**Mô tả:** Xử lý lỗi bot thành skip/forfeit và luôn cleanup.
**Acceptance criteria:** (1) Mọi lỗi tạo đúng event và skip/forfeit; (2) action lỗi không được apply, result không gửi trùng; (3) hai BotPort luôn close trong `finally`.
**Verification:** `npm --prefix src/match-runner test -- tests/error-paths.test.ts`.
**Dependencies:** `P1-D03`.
**Files dự kiến:** `src/match-runner/src/match-runner.ts`, `src/match-runner/src/errors.ts`, `src/match-runner/tests/error-paths.test.ts`
**Ước lượng:** M (3 file)

### [ ] P1-D05 — BotProcess NDJSON adapter

**Owner:** Phạm Tất Đạt
**Mô tả:** Spawn executable bằng argv và chuyển message qua stdin/stdout theo dòng.
**Acceptance criteria:** (1) Không dùng shell string, xử lý chunking đúng; (2) giới hạn/validate từng line; (3) stderr được tách khỏi protocol.
**Verification:** `npm --prefix src/match-runner test -- tests/bot-process-ndjson.test.ts`.
**Dependencies:** `P1-D02`, `P1-L04`.
**Files dự kiến:** `src/match-runner/src/bot-process.ts`, `src/match-runner/src/line-buffer.ts`, `src/match-runner/tests/bot-process-ndjson.test.ts`
**Ước lượng:** M (3 file)

### [ ] P1-D06 — BotProcess timeout và process cleanup

**Owner:** Phạm Tất Đạt
**Mô tả:** Timeout bằng server clock và đóng process an toàn.
**Acceptance criteria:** (1) Pending request settle một lần, không tin bot timestamp; (2) EOF/exit/abort có error code ổn định, close idempotent; (3) không còn PID/timer/listener sau mọi nhánh.
**Verification:** `npm --prefix src/match-runner test -- tests/bot-process-lifecycle.test.ts`; không có open handle/PID còn sống.
**Dependencies:** `P1-D05`.
**Files dự kiến:** `src/match-runner/src/bot-process.ts`, `src/match-runner/src/process-errors.ts`, `src/match-runner/tests/bot-process-lifecycle.test.ts`
**Ước lượng:** M (3 file)

### [ ] P1-D07 — Event log và replay verifier

**Owner:** Phạm Tất Đạt
**Mô tả:** Ghi event ổn định và xác minh replay qua GamePort.
**Acceptance criteria:** (1) Sequence liên tục, metadata/outcome/final hash đầy đủ; (2) không để artifact nửa vời, format có version; (3) verifier bắt thiếu/thừa/sai thứ tự/hash.
**Verification:** `npm --prefix src/match-runner test -- tests/event-log.test.ts tests/replay.test.ts`.
**Dependencies:** `P1-D04`.
**Files dự kiến:** `src/match-runner/src/event-log.ts`, `src/match-runner/src/replay.ts`, `src/match-runner/tests/event-log.test.ts`, `src/match-runner/tests/replay.test.ts`
**Ước lượng:** M (4 file)

### [ ] P1-D08 — CLI chạy trận local

**Owner:** Phạm Tất Đạt
**Mô tả:** Composition root nhận hai bot, timeout, maxTurns và output path.
**Acceptance criteria:** (1) Validate config và nhận executable/argv tách biệt; (2) stdout chỉ result JSON, stderr diagnostics, exit code rõ; (3) CLI inject ports/adapters, không chứa game rule.
**Verification:** `npm --prefix src/match-runner test -- tests/cli.test.ts && npm --prefix src/match-runner run match -- --help`.
**Dependencies:** `P1-D06`, `P1-D07`.
**Files dự kiến:** `src/match-runner/src/cli.ts`, `src/match-runner/src/config.ts`, `src/match-runner/src/index.ts`, `src/match-runner/tests/cli.test.ts`, `src/match-runner/package.json` (script `match`)
**Ước lượng:** M (5 file)

## Checkpoint P1-B — Ba lane độc lập hoàn tất

- [ ] Long xong `P1-L05`–`P1-L08`; Nguyên xong `P1-N01`–`P1-N06`; Đạt xong `P1-D02`–`P1-D08`.
- [ ] Unit/contract tests từng lane chạy độc lập trên localhost.
- [ ] Không có thay đổi protocol chưa được ba owner review.
- [ ] Chạy GitNexus `detect-changes` trước integration.

## Phase 1 — Integration

### [ ] P1-T02 — Gộp Node.js/TypeScript/Vitest workspace chung

**Owner:** Đinh Đức Thuận (thay `P1-D01` đã hủy)
**Mô tả:** Gộp các module đã chạy độc lập thành một npm workspace ở root. Trước task này mỗi module tự có `package.json` và chạy trên localhost; task này không triển khai luật game hoặc protocol.
**Acceptance criteria:** (1) Pin Node.js 22 và npm; root có scripts `typecheck`, `test`, `build`; (2) npm workspace globs bao phủ các module Phase 1, giữ nguyên `package.json` và scripts do owner module tạo, chuyển dependency `file:` theo mục 8 của `docs/conventions/module-package.md`; (3) Vitest chạy smoke test và test của mọi module từ root, build không chứa test.
**Verification:** `npm ci && npm run typecheck && npm test && npm run build`.
**Dependencies:** Checkpoint `P1-B`.
**Files dự kiến:** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `tests/smoke.test.ts`
**Ước lượng:** M (5 file)

### [ ] P1-D09 — Tích hợp core thật với MatchRunner

**Owner:** Phạm Tất Đạt
**Mô tả:** Viết GamePort adapter cho core của Long và thay FakeGame tại composition root.
**Acceptance criteria:** (1) Map state/action/result/error không đổi semantics; (2) có integration test core thật + ScriptedBot; (3) chỉ import public package API.
**Verification:** `npm test -- src/match-runner/tests/core-adapter.integration.test.ts && npm run typecheck`.
**Dependencies:** `P1-L08`, `P1-D08`, `P1-T02`.
**Files dự kiến:** `src/match-runner/src/core-adapter.ts`, `src/match-runner/src/index.ts`, `src/match-runner/tests/core-adapter.integration.test.ts`
**Ước lượng:** M (3 file)

### [ ] P1-D10 — E2E hai bot và bot lỗi

**Owner:** Phạm Tất Đạt
**Mô tả:** Chạy CLI với Python process thật cho happy path và fault matrix.
**Acceptance criteria:** (1) Hai bot hợp lệ hoàn tất trận, process thoát sạch; (2) phủ malformed, illegal, stale, timeout, crash, oversized; (3) hai lần cùng input cho cùng event/hash.
**Verification:** `npm test -- src/match-runner/tests/e2e && python3 -m unittest discover -s src/bots/python/tests`.
**Dependencies:** `P1-D09`, `P1-N06`.
**Files dự kiến:** `src/match-runner/tests/e2e/happy-path.test.ts`, `src/match-runner/tests/e2e/faults.test.ts`, `src/match-runner/tests/e2e/determinism.test.ts`, `src/match-runner/tests/e2e/helpers.ts`
**Ước lượng:** M (4 file)

### [ ] P1-D11 — Runbook và bàn giao local

**Owner:** Phạm Tất Đạt
**Mô tả:** Để Thuận chạy lại toàn bộ Phase 1 từ clean checkout.
**Acceptance criteria:** (1) Có prerequisites/install/test/run/artifact/troubleshooting; (2) ghi config, protocol limits và ranh giới Phase 2; (3) Thuận chạy theo tài liệu và ký P1-C.
**Verification:** `npm ci && npm run typecheck && npm test && npm run build`; chạy command mẫu từ clean checkout.
**Dependencies:** `P1-D10`.
**Files dự kiến:** `README.md`, `docs/runbooks/phase-1-local.md`, `.env.example`
**Ước lượng:** S (3 file)

## Checkpoint P1-C — Phase 1 hoàn tất

- [ ] Full typecheck, unit, contract, integration, E2E và build pass.
- [ ] Happy path và fault matrix có automated evidence; replay/determinism pass.
- [ ] Không còn child process/open handle; Thuận duyệt bàn giao local.

## Phase 2 — Local platform

### [ ] P2-T01 — Khóa quyết định triển khai Phase 2 local

**Owner:** Đinh Đức Thuận
**Mô tả:** Chốt các giá trị còn mở ảnh hưởng trực tiếp database, API, sandbox, scheduling và Elo trước khi các module đó được triển khai.
**Acceptance criteria:** (1) Chốt auth/RBAC local, K-factor/rating khởi tạo và series đổi phía; (2) chốt artifact/image policy cùng CPU/RAM/PID quota sau benchmark; (3) cập nhật mục 20 của yêu cầu và ADR mới nếu quyết định mang tính kiến trúc.
**Verification:** Không còn quyết định Phase 2 liên quan trong trạng thái `OPEN/PARTIAL` mà task `P2-D02`–`P2-D10` cần để code; owner bị ảnh hưởng review.
**Dependencies:** `P1-D11`.
**Files dự kiến:** `docs/tai-lieu-yeu-cau.md`, `docs/decisions/0003-phase-2-runtime-and-access-policy.md`, `tasks/plan.md`, `tasks/todo.md`
**Ước lượng:** M (4 file)

### [ ] P2-D01 — Docker Compose PostgreSQL, Redis và MinIO

**Owner:** Phạm Tất Đạt
**Mô tả:** Môi trường dependency local có healthcheck và version pin.
**Acceptance criteria:** (1) Ba service chạy localhost; (2) có healthcheck, volume, port/env, bucket init idempotent; (3) không commit secret, có hướng dẫn reset/start/stop.
**Verification:** `docker compose -f infra/local/compose.yaml up -d --wait && docker compose -f infra/local/compose.yaml ps`.
**Dependencies:** `P1-D11`.
**Files dự kiến:** `infra/local/compose.yaml`, `infra/local/minio-init.sh`, `.env.example`, `docs/runbooks/local-services.md`
**Ước lượng:** M (4 file)

### [ ] P2-D02 — Database schema và migration foundation

**Owner:** Phạm Tất Đạt
**Mô tả:** Schema cho team, submission, match, event/result và rating ledger.
**Acceptance criteria:** (1) PK/FK/unique/index và trạng thái đầy đủ; (2) migrate được từ DB rỗng, có reset strategy; (3) integration test dùng PostgreSQL thật.
**Verification:** `npm run db:migrate && npm test -- src/platform/api/tests/db`.
**Dependencies:** `P2-D01`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/db/schema.ts`, `src/platform/api/src/db/client.ts`, `src/platform/api/migrations/0001_initial.sql`, `src/platform/api/tests/db/schema.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D03 — Authentication và RBAC foundation

**Owner:** Phạm Tất Đạt
**Mô tả:** Thiết lập identity/authentication local và authorization server-side cho các vai trò BTC, đội trưởng và thành viên theo policy đã khóa tại `P2-T01`.
**Acceptance criteria:** (1) Request có principal xác thực và role/membership rõ; (2) Fastify guard từ chối unauthenticated/forbidden bằng error ổn định; (3) integration tests chứng minh quyền được kiểm tra ở server, không dựa vào UI.
**Verification:** `npm test -- src/platform/api/tests/auth.integration.test.ts` với PostgreSQL local.
**Dependencies:** `P2-D02`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/modules/auth/plugin.ts`, `src/platform/api/src/modules/auth/authorize.ts`, `src/platform/api/src/modules/auth/types.ts`, `src/platform/api/tests/auth.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D04 — Team management vertical slice

**Owner:** Phạm Tất Đạt
**Mô tả:** Fastify API tạo, đọc, cập nhật team trên PostgreSQL.
**Acceptance criteria:** (1) Validate request/response và error ổn định; (2) uniqueness enforce ở DB/API; (3) test success, duplicate, not found, invalid.
**Verification:** `npm test -- src/platform/api/tests/teams.integration.test.ts`.
**Dependencies:** `P2-D03`.
**Files dự kiến:** `src/platform/api/src/modules/teams/routes.ts`, `src/platform/api/src/modules/teams/service.ts`, `src/platform/api/src/modules/teams/repository.ts`, `src/platform/api/tests/teams.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D05 — Submission upload và MinIO vertical slice

**Owner:** Phạm Tất Đạt
**Mô tả:** Nhận artifact, lưu S3-compatible storage và metadata/checksum.
**Acceptance criteria:** (1) Enforce owner/type/size/checksum và server-generated key; (2) metadata commit sau object hợp lệ, lỗi có cleanup; (3) download nội bộ chống traversal/overwrite và verify checksum.
**Verification:** `npm test -- src/platform/api/tests/submissions.integration.test.ts` với PostgreSQL/MinIO local.
**Dependencies:** `P2-D04`.
**Files dự kiến:** `src/platform/api/src/modules/submissions/routes.ts`, `src/platform/api/src/modules/submissions/service.ts`, `src/platform/api/src/storage/s3.ts`, `src/platform/api/tests/submissions.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-N01 — Canary bot và sandbox security corpus

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Artifact bot tốt/xấu để kiểm thử sandbox/worker.
**Acceptance criteria:** (1) Có canary và timeout/fork/write/network/output/memory/CPU cases; (2) mỗi artifact có expected outcome, chỉ chạy qua harness giới hạn; (3) manifest/version/checksum deterministic.
**Verification:** `python3 -m unittest discover -s src/bots/sandbox-corpus/tests`.
**Dependencies:** `P1-D11`, `P2-T01`.
**Files dự kiến:** `src/bots/sandbox-corpus/manifest.json`, `src/bots/sandbox-corpus/canary_bot.py`, `src/bots/sandbox-corpus/fault_bot.py`, `src/bots/sandbox-corpus/tests/test_manifest.py`, `src/bots/sandbox-corpus/README.md`
**Ước lượng:** M (5 file)

### [ ] P2-D06 — MatchJob contract và BullMQ worker

**Owner:** Phạm Tất Đạt
**Mô tả:** Queue yêu cầu chạy trận và worker nhận job version hóa.
**Acceptance criteria:** (1) Job schema/version/idempotency key và artifact reference hợp lệ; (2) retry/backoff/dead-letter, duplicate không tạo hai match; (3) structured log và graceful shutdown.
**Verification:** `npm test -- src/platform/worker/tests/match-job.integration.test.ts` với Redis local.
**Dependencies:** `P2-D01`, `P2-T01`, `P1-D11`.
**Files dự kiến:** `src/platform/job-contract/src/match-job.ts`, `src/platform/api/src/queue/match-queue.ts`, `src/platform/worker/src/worker.ts`, `src/platform/worker/src/config.ts`, `src/platform/worker/tests/match-job.integration.test.ts`
**Ước lượng:** M (5 file)

### [ ] P2-D07 — Sandbox adapter và artifact validation

**Owner:** Phạm Tất Đạt
**Mô tả:** Xác minh artifact và chạy bot trong giới hạn tài nguyên/network.
**Acceptance criteria:** (1) Check permission/checksum/entrypoint, workdir cô lập; (2) enforce time/CPU/memory/process/output/network/filesystem; (3) canary pass, corpus xấu bị chặn với reason ổn định.
**Verification:** `npm test -- src/platform/worker/tests/sandbox.integration.test.ts` trên Docker local.
**Dependencies:** `P2-D05`, `P2-D06`, `P2-N01`.
**Files dự kiến:** `src/platform/worker/src/sandbox/adapter.ts`, `src/platform/worker/src/sandbox/policy.ts`, `src/platform/worker/src/artifacts.ts`, `src/platform/worker/tests/sandbox.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D08 — MatchResult finalization idempotent

**Owner:** Phạm Tất Đạt
**Mô tả:** Chạy MatchRunner trong worker và ghi result/event đúng một lần.
**Acceptance criteria:** (1) Map output sang result/error chuẩn; (2) retry không nhân đôi result/event/rating trigger; (3) DB result và artifact có checksum/final hash.
**Verification:** `npm test -- src/platform/worker/tests/finalization.integration.test.ts`.
**Dependencies:** `P2-D07`, `P2-D02`.
**Files dự kiến:** `src/platform/worker/src/run-match-job.ts`, `src/platform/worker/src/finalize-result.ts`, `src/platform/worker/src/result-repository.ts`, `src/platform/worker/tests/finalization.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D09 — Scheduling và series scoring

**Owner:** Phạm Tất Đạt
**Mô tả:** Tạo series/match schedule và tổng hợp điểm Phase 2.
**Acceptance criteria:** (1) Pairings deterministic, không trùng và có idempotency key; (2) finalize khi đủ terminal matches, tie/forfeit/cancel rõ; (3) retry không đổi số match/điểm.
**Verification:** `npm test -- src/platform/api/tests/scheduling.integration.test.ts`.
**Dependencies:** `P2-D08`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/modules/scheduling/service.ts`, `src/platform/api/src/modules/scheduling/repository.ts`, `src/platform/api/src/modules/series/scoring.ts`, `src/platform/api/tests/scheduling.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D10 — Match results, Elo ledger và leaderboard API

**Owner:** Phạm Tất Đạt
**Mô tả:** Ghi biến động Elo dạng ledger và cung cấp API đọc match/series results cùng leaderboard.
**Acceptance criteria:** (1) Mỗi series terminal tạo một ledger entry; (2) results/leaderboard có authorization, ordering, tie-break và pagination ổn định; (3) rebuild ledger cho cùng rating hiện tại.
**Verification:** `npm test -- src/platform/api/tests/leaderboard.integration.test.ts`.
**Dependencies:** `P2-D09`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/modules/ratings/elo.ts`, `src/platform/api/src/modules/ratings/service.ts`, `src/platform/api/src/modules/ratings/routes.ts`, `src/platform/api/src/modules/results/routes.ts`, `src/platform/api/tests/leaderboard.integration.test.ts`
**Ước lượng:** M (5 file)

### [ ] P2-D11 — React/Vite submission UI

**Owner:** Phạm Tất Đạt
**Mô tả:** UI chọn team, upload bot và theo dõi submission.
**Acceptance criteria:** (1) Client validate file/size nhưng hiển thị lỗi server chuẩn; (2) loading/progress/success/error và chống double-submit; (3) component tests phủ happy/invalid/API failure.
**Verification:** `npm test -- src/platform/web/src/features/submissions && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-D05`.
**Files dự kiến:** `src/platform/web/src/features/submissions/SubmissionForm.tsx`, `src/platform/web/src/features/submissions/api.ts`, `src/platform/web/src/features/submissions/SubmissionStatus.tsx`, `src/platform/web/src/features/submissions/SubmissionForm.test.tsx`
**Ước lượng:** M (4 file)

### [ ] P2-D12 — React/Vite results và leaderboard UI

**Owner:** Phạm Tất Đạt
**Mô tả:** Hiển thị match/series results, error reason và leaderboard.
**Acceptance criteria:** (1) Hiển thị outcome và liên kết team/submission; (2) leaderboard có tie-break/pagination/loading/empty/error; (3) component tests kiểm tra mapping và states chính.
**Verification:** `npm test -- src/platform/web/src/features/results src/platform/web/src/features/leaderboard && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-D10`.
**Files dự kiến:** `src/platform/web/src/features/results/MatchResult.tsx`, `src/platform/web/src/features/leaderboard/Leaderboard.tsx`, `src/platform/web/src/features/results/api.ts`, `src/platform/web/src/features/results/MatchResult.test.tsx`, `src/platform/web/src/features/leaderboard/Leaderboard.test.tsx`
**Ước lượng:** M (5 file)

### [ ] P2-D13 — Qualification E2E local

**Owner:** Phạm Tất Đạt
**Mô tả:** Chứng minh flow từ team/submission đến worker, result, Elo và UI.
**Acceptance criteria:** (1) Một command dựng service/migrate/chạy flow bằng canary; (2) verify submission → queued → running → terminal → series → rating; (3) retry/restart không duplicate và artifact audit được.
**Verification:** `npm run test:e2e:qualification`; sau test không còn job active ngoài fixture.
**Dependencies:** `P2-D08`, `P2-D09`, `P2-D10`, `P2-D11`, `P2-D12`.
**Files dự kiến:** `tests/e2e/qualification.test.ts`, `tests/e2e/helpers.ts`, `scripts/run-local-qualification.sh`, `docs/runbooks/phase-2-local.md`, `package.json`
**Ước lượng:** M (5 file)

## Checkpoint P2-A — Backend local

- [ ] `P2-T01`, `P2-D01`–`P2-D10` và `P2-N01` hoàn tất; API/worker tests pass với Docker services.
- [ ] Queue retry, sandbox, finalization idempotency và rating rebuild có automated evidence.
- [ ] Chạy GitNexus `detect-changes` và xử lý mọi HIGH/CRITICAL risk.

## Checkpoint P2-B — Phase 2 local hoàn tất

- [ ] `P2-D11`–`P2-D13` hoàn tất; qualification E2E pass.
- [ ] `npm run typecheck && npm test && npm run build` pass từ clean checkout.
- [ ] Thuận nhận runbook, env contract, artifact format để lập kế hoạch local → cloud riêng.
