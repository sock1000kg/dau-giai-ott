# Task Checklist: Phase 1–2

**Trạng thái:** Đã tự động duyệt — có thể bắt đầu theo dependency
**Mức khuyến nghị:** Cao (`HIGH RECOMMEND`)
**Plan:** `tasks/plan.md`
**Nguồn:** `docs/team-assignment-phase-1-2.md`

> Chỉ bắt đầu khi dependency đã xong. Mỗi task là một PR nhỏ; nếu dự kiến vượt 5 file thì tách task trước khi code.
>
> Trạng thái/dependency trong file này là nguồn duy nhất để AI chọn task. Branch phải tạo từ `main` với prefix owner quy định tại `docs/README.md`.
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

### [x] P1-L01 — Triển khai behavior baseline Human-vs-Human

**Owner:** Long Trần
**Mô tả:** Triển khai lại behavior baseline theo đặc tả và commit tham chiếu, không sao chép source chưa có LICENSE.
**Acceptance criteria:** (1) Ghi nguồn/commit hành vi; module không khởi động UI/process; (2) baseline test khóa spawn, move, combat, win; (3) không copy/submodule/package source tham chiếu.
**Verification:** `npm --prefix src/game-core test && npm --prefix src/game-core run typecheck`.
**Dependencies:** `P1-T01`.
**Files dự kiến:** `src/game-core/package.json`, `src/game-core/src/index.ts`, `src/game-core/src/engine.ts`, `src/game-core/tests/regression.test.ts`, `src/game-core/README.md`
**Ước lượng:** M (5 file)
**Hoàn tất:** Feature `f728703` đã merge vào `main`; verification hiện tại: 46 game-core tests, typecheck và build pass.

## Phase 1 — Gate 1: hiện thực contract đã khóa

### [x] P1-L02 — Hiện thực Engine API và domain types đã khóa

**Owner:** Long Trần
**Mô tả:** Hiện thực domain types, map types, `createGame` và public exports nền tảng từ `docs/contracts/engine-api-v1.md`; movement/lifecycle được hoàn thiện ở `P1-L05`–`P1-L07`.
**Acceptance criteria:** (1) Có đúng tên `GameState`, `PlayerSide`, `GameAction`, `GameResult`, error/reason types theo contract; (2) `createGame` tạo initial state deterministic và deep-copy spawn; (3) module không import process, timer, DB, network hoặc UI.
**Verification:** `npm --prefix src/game-core test -- tests/contract.test.ts && npm --prefix src/game-core run typecheck`.
**Dependencies:** `P1-L01`.
**Files dự kiến:** `src/game-core/src/types.ts`, `src/game-core/src/engine.ts`, `src/game-core/src/index.ts`, `src/game-core/tests/contract.test.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** Feature `3023be4` đã merge vào `main`; Engine API public types và `createGame` được cover bởi contract tests hiện tại.

### [x] P1-L03 — Hiện thực Bot Protocol v1 types

**Owner:** Long Trần
**Mô tả:** Hiện thực types/error codes đúng contract v1 đã khóa để Nguyên và Đạt import qua public package entrypoint.
**Acceptance criteria:** (1) Đủ `INIT`, `STATE_UPDATE`, `ACTION`, `TURN_RESULT`, `MATCH_RESULT`, error code; (2) field/version, `matchId`, `turnId`, ordering, stdout/stderr đúng contract; (3) types phản ánh chính xác timeout, size, stale/illegal action và skip/forfeit đã khóa.
**Verification:** `npm --prefix src/bot-protocol run typecheck`; đối chiếu types với `docs/contracts/bot-protocol-v1.md` và schema.
**Dependencies:** `P1-L02`.
**Files dự kiến:** `src/bot-protocol/package.json`, `src/bot-protocol/src/messages.ts`, `src/bot-protocol/src/errors.ts`, `src/bot-protocol/src/index.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** Feature `776dcbe` đã merge vào `main`; bot-protocol typecheck và 16 tests pass.

### [x] P1-L04 — Validator và contract tests từ schema/fixtures

**Owner:** Long Trần
**Mô tả:** Dùng schema/fixtures đã khóa để hiện thực runtime validator và contract tests.
**Acceptance criteria:** (1) Validator từ chối version/type/field/value sai và unknown field theo contract; (2) tests đọc trực tiếp schema/fixtures chuẩn trong `docs/contracts/`, không tạo bản sao thứ hai; (3) types, schema, fixtures không mâu thuẫn và không phụ thuộc core implementation.
**Verification:** `npm --prefix src/bot-protocol test -- tests/schema.test.ts && npm --prefix src/bot-protocol run typecheck`.
**Dependencies:** `P1-L03`.
**Files dự kiến:** `src/bot-protocol/src/validate.ts`, `src/bot-protocol/src/index.ts`, `src/bot-protocol/tests/schema.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** Feature `6d61b9f` đã merge vào `main`; validator và schema tests pass.

## [x] Checkpoint P1-A — Executable contract baseline

- [x] `P1-T01`, `P1-L01`–`P1-L04`, `P1-N01` và `P1-D02` hoàn tất.
- [x] Python SDK và MatchRunner ports cùng dùng contract/schema/fixtures chuẩn, không tạo protocol/type semantics riêng.
- [x] Contract/schema vẫn khóa; thay đổi protocol sau gate tiếp tục phải do Long cập nhật và Nguyên, Đạt review.
- [x] Chạy `node .gitnexus/run.cjs detect-changes --scope all --repo .`: không có thay đổi cần xử lý.

## Phase 1 — Lane Long: core và protocol

### [x] P1-L05 — API điều khiển game theo side/action

**Owner:** Long Trần
**Mô tả:** Cho phép caller chọn action theo side mà không phụ thuộc input Human-vs-Human.
**Acceptance criteria:** (1) `listLegalActions` đúng side/state và deterministic; (2) `applyAction` không mutate và từ chối sai side/action bằng mã ổn định; (3) move/combat/win khớp baseline.
**Verification:** `npm --prefix src/game-core test -- tests/actions.test.ts && npm --prefix src/game-core run test:coverage`.
**Dependencies:** `P1-L04`.
**Files dự kiến:** `src/game-core/src/engine.ts`, `src/game-core/src/types.ts`, `src/game-core/tests/actions.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** Feature `3647880` đã merge vào `main`; action tests nằm trong 46 game-core tests và coverage tổng branch đạt 96.07%.

### [x] P1-L06 — Skip turn, maxTurns và GameResult

**Owner:** Long Trần
**Mô tả:** Bổ sung lifecycle runner cần khi bot lỗi hoặc trận chạm giới hạn lượt.
**Acceptance criteria:** (1) Skip chuyển turn/revision đúng contract; (2) trận dừng một lần khi thắng hoặc `maxTurns`, action sau kết thúc bị từ chối; (3) result có winner/draw và reason ổn định.
**Verification:** `npm --prefix src/game-core test -- tests/lifecycle.test.ts`.
**Dependencies:** `P1-L05`.
**Files dự kiến:** `src/game-core/src/engine.ts`, `src/game-core/src/types.ts`, `src/game-core/tests/lifecycle.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** Feature `9e302da` đã merge vào `main`; lifecycle tests pass.

### [x] P1-L07 — Event transition và finalStateHash

**Owner:** Long Trần
**Mô tả:** Xuất transition deterministic để runner ghi log và replay.
**Acceptance criteria:** (1) Move/skip/end trả event đủ dữ liệu replay, không chứa timestamp ngẫu nhiên; (2) canonical serialization cho hash ổn định; (3) cùng input cho cùng event sequence/hash.
**Verification:** `npm --prefix src/game-core test -- tests/replay.test.ts`.
**Dependencies:** `P1-L06`.
**Files dự kiến:** `src/game-core/src/events.ts`, `src/game-core/src/hash.ts`, `src/game-core/src/engine.ts`, `src/game-core/tests/replay.test.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** Feature `f569684` đã merge vào `main`; replay/determinism tests pass.

### [x] P1-L08 — Regression test và tài liệu core

**Owner:** Long Trần
**Mô tả:** Khóa tương thích Human-vs-Human và hướng dẫn dùng API công khai.
**Acceptance criteria:** (1) Regression phủ spawn, movement, combat, win, skip, turn limit; (2) branch coverage rule engine tối thiểu 90%; (3) README nêu API, invariant và phần core không chịu trách nhiệm.
**Verification:** `npm --prefix src/game-core test && npm --prefix src/game-core run test:coverage && npm --prefix src/game-core run typecheck`.
**Dependencies:** `P1-L07`.
**Files dự kiến:** `src/game-core/tests/regression.test.ts`, `src/game-core/tests/invariants.test.ts`, `src/game-core/README.md`
**Ước lượng:** M (3 file)
**Hoàn tất:** Feature `84e194b` đã merge vào `main`; 46 game-core tests, 96.07% branch coverage, typecheck và build pass.

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

### [x] P1-N04 — Bot malformed JSON, illegal action và stale turnId

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo bot cố ý vi phạm protocol cho error-path tests.
**Acceptance criteria:** (1) Có mode malformed, illegal và stale; (2) từng mode tái hiện độc lập qua argv; (3) mỗi mode chỉ gây lỗi mục tiêu.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_invalid_bots.py'`.
**Dependencies:** `P1-N01`.
**Files dự kiến:** `src/bots/python/invalid_bot.py`, `src/bots/python/tests/test_invalid_bots.py`
**Ước lượng:** S (2 file)

### [x] P1-N05 — Bot timeout, crash và oversized output

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo process fixtures cho lifecycle/error handling.
**Acceptance criteria:** (1) Có mode không phản hồi, exit non-zero, output vượt limit; (2) không fork process ngoài kiểm soát và có thể terminate; (3) exit/delay/size deterministic.
**Verification:** `python3 -m unittest discover -s src/bots/python/tests -p 'test_process_fault_bots.py'`.
**Dependencies:** `P1-N01`.
**Files dự kiến:** `src/bots/python/process_fault_bot.py`, `src/bots/python/tests/test_process_fault_bots.py`
**Ước lượng:** S (2 file)

### [x] P1-N06 — Contract test và README bot

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
**Hoàn tất:** 2026-10-10 — `runMatch(config, ports)` chạy vòng lặp happy path theo Bot Protocol §8: INIT một lần mỗi bot, chỉ hỏi bot của `state.turn` với `turnId = turnNumber`, `TURN_RESULT` broadcast cho X rồi O, một `MATCH_RESULT` nhất quán, `stop()` X rồi O trong `finally`; `legalActions` rỗng thì bot vẫn nhận `STATE_UPDATE` send-only qua `notifyStateUpdate` rồi runner skip `NO_LEGAL_ACTION` không chờ `ACTION` (§5.2/§8). Message outbound không chia sẻ reference mutable. 14 test mới + 21 test `ports.test.ts` pass, typecheck và build pass. Throw tạm `UNHANDLED_BOT_FAILURE` đã được thay bằng policy thật trong `P1-D04`.

### [x] P1-D04 — MatchRunner error, skip và cleanup

**Owner:** Phạm Tất Đạt
**Mô tả:** Xử lý lỗi bot thành skip/forfeit và luôn cleanup.
**Acceptance criteria:** (1) Mọi lỗi tạo đúng event và skip/forfeit; (2) action lỗi không được apply, result không gửi trùng; (3) hai BotPort luôn close trong `finally`.
**Verification:** `npm --prefix src/match-runner test -- tests/error-paths.test.ts`.
**Dependencies:** `P1-D03`.
**Files dự kiến:** `src/match-runner/src/match-runner.ts`, `src/match-runner/src/errors.ts`, `src/match-runner/tests/error-paths.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** 2026-10-10 — policy lỗi Bot Protocol §6 hiện thực trong `errors.ts` (helper thuần) và `match-runner.ts`: 7 mã lỗi lượt phục hồi skip đúng một lần và đếm bộ đếm, `NO_LEGAL_ACTION` không tính lỗi, action hợp lệ reset `consecutive`, ngưỡng 3 liên tiếp / 5 tổng thì forfeit, 6 process fault forfeit ngay và bot chết không nhận thêm message, `start` thất bại thì forfeit side đầu tiên theo X, O, `MATCH_RESULT` đúng một lần cho mỗi bot còn sống với bộ đếm thật, `stop()` X rồi O luôn chạy trong `finally`, exception lạ ném ra nguyên vẹn. Bỏ mã `UNHANDLED_BOT_FAILURE`. 26 test mới; tổng 61 test pass, typecheck và build pass.

### [x] P1-D05 — BotProcess NDJSON adapter

**Owner:** Phạm Tất Đạt
**Mô tả:** Spawn executable bằng argv và chuyển message qua stdin/stdout theo dòng.
**Acceptance criteria:** (1) Không dùng shell string, xử lý chunking đúng; (2) giới hạn/validate từng line; (3) stderr được tách khỏi protocol.
**Verification:** `npm --prefix src/match-runner test -- tests/bot-process-ndjson.test.ts`.
**Dependencies:** `P1-D02`, `P1-L04`.
**Files dự kiến:** `src/match-runner/src/bot-process.ts`, `src/match-runner/src/line-buffer.ts`, `src/match-runner/tests/bot-process-ndjson.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** 2026-10-11 — `BotProcess` và `LineBuffer` hoàn thành: spawn trực tiếp bằng argv với `shell: false`, framing LF chuẩn và xử lý chunking/split multi-byte UTF-8 chính xác, giới hạn `maxMessageBytes` được LineBuffer chặn ngay lập tức không giữ bộ nhớ dư thừa, validate JSON và schema injected trong request window, discard và đếm stdout ngoài window, tách bạch hoàn toàn stderr khỏi luồng giao thức. Adapter không kiểm tra matchId/turnId/legal (để runner kiểm tra). 18 test mới (5 line-buffer + 13 bot-process); tổng 89 test pass, typecheck và build pass.

### [x] P1-D06 — BotProcess timeout và process cleanup

**Owner:** Phạm Tất Đạt
**Mô tả:** Timeout bằng server clock và đóng process an toàn.
**Acceptance criteria:** (1) Pending request settle một lần, không tin bot timestamp; (2) EOF/exit/abort có error code ổn định, close idempotent; (3) không còn PID/timer/listener sau mọi nhánh.
**Verification:** `npm --prefix src/match-runner test -- tests/bot-process-lifecycle.test.ts`; không có open handle/PID còn sống.
**Dependencies:** `P1-D05`.
**Files dự kiến:** `src/match-runner/src/bot-process.ts`, `src/match-runner/src/process-errors.ts`, `src/match-runner/tests/bot-process-lifecycle.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** 2026-10-11 — Hoàn thành lifecycle, timeout và process cleanup cho BotProcess: monotonic timeout (startup/turn) được kích hoạt nghiêm ngặt sau write callback, settle đúng một lần, không phụ thuộc clock bot; late reply của các lượt đã timeout được discard an toàn không gây mismatch lượt sau; sticky fault bảo đảm các phương thức send-only không bao giờ throw; classifyExit phân loại đầy đủ BOT_SPAWN_FAILED/BOT_CRASHED/BOT_EOF; quản lý quota stderr (STDERR_LIMIT_EXCEEDED); stop() idempotent với chuỗi leo thang stdin.end -> SIGTERM -> SIGKILL; gỡ bỏ hoàn toàn listener, timer và tiêu hủy stream stdio, không để lại PID sống hay rò rỉ tài nguyên sau mọi nhánh. 24 test mới trong bot-process-lifecycle.test.ts; tổng 113 test pass, typecheck và build pass.

### [x] P1-D07 — Event log và replay verifier

**Owner:** Phạm Tất Đạt
**Mô tả:** Ghi event ổn định và xác minh replay qua GamePort.
**Acceptance criteria:** (1) Sequence liên tục, metadata/outcome/final hash đầy đủ; (2) không để artifact nửa vời, format có version; (3) verifier bắt thiếu/thừa/sai thứ tự/hash.
**Verification:** `npm --prefix src/match-runner test -- tests/event-log.test.ts tests/replay.test.ts`.
**Dependencies:** `P1-D04`.
**Files dự kiến:** `src/match-runner/src/event-log.ts`, `src/match-runner/src/replay.ts`, `src/match-runner/tests/event-log.test.ts`, `src/match-runner/tests/replay.test.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** 2026-10-10 — EventLogV1 (`ott.match-event-log` v1) được sinh trong bộ nhớ từ `runMatch` với `index` liên tục 1..n theo từng transition, header/footer đầy đủ config/limits/outcome/finalStateHash và bộ đếm lỗi thật, không lưu bot source/argv/env/stdout/stderr; ghi file atomic qua `.partial` và rename an toàn; `verifyReplay` xác minh thuần túy qua `GamePort` bắt đủ 9 mã lỗi thiếu/thừa/sai thứ tự/hash. 10 test mới (7 event-log + 3 replay); tổng 71 test pass, typecheck và build pass.

### [x] P1-D08 — CLI chạy trận local

**Owner:** Phạm Tất Đạt
**Mô tả:** Composition root nhận hai bot, timeout, maxTurns và output path.
**Acceptance criteria:** (1) Validate config và nhận executable/argv tách biệt; (2) stdout chỉ result JSON, stderr diagnostics, exit code rõ; (3) CLI inject ports/adapters, không chứa game rule.
**Verification:** `npm --prefix src/match-runner test -- tests/cli.test.ts && npm --prefix src/match-runner run match -- --help`.
**Dependencies:** `P1-D06`, `P1-D07`.
**Files dự kiến:** `src/match-runner/src/cli.ts`, `src/match-runner/src/config.ts`, `src/match-runner/src/index.ts`, `src/match-runner/tests/cli.test.ts`, `src/match-runner/package.json` (script `match`)
**Ước lượng:** M (5 file)
**Hoàn tất:** 2026-10-11 — Hoàn thành CLI chạy trận local và composition root (`src/config.ts`, `src/cli.ts`): nhận và validate nghiêm ngặt config qua `node:util` `parseArgs` (`strict: true`), nhận executable và argv tách bạch truyền nguyên văn không qua shell; stdout chỉ chứa đúng một dòng JSON kết quả trận đấu với thứ tự khóa cố định (hoặc usage khi --help), stderr dành riêng cho diagnostics, bot stderr (`[bot X]`/`[bot O]`) và tóm tắt; phân loại rõ ràng exit code (0 thành công kể cả bot forfeit/fault, 1 lỗi hạ tầng/runtime, 2 lỗi cú pháp/config); CLI inject ports/adapters (`createGame`, `createBot`, `readFile`, `writeEventLog`), sử dụng FakeGame tối thiểu 2-spawn chờ core P1-D09 và không chứa luật game, không import child_process trực tiếp. Thêm devDependency `tsx` (pin 4.23.15) và script `match`. 21 test mới trong `tests/cli.test.ts`; tổng 134 test pass (3x flakiness check đạt 100%), typecheck và build pass.

## [x] Checkpoint P1-B — Ba lane độc lập hoàn tất

- [x] Long xong `P1-L05`–`P1-L08`; Nguyên xong `P1-N01`–`P1-N06`; Đạt xong `P1-D02`–`P1-D08`.
- [x] Unit/contract tests từng lane chạy độc lập trên localhost: game-core 46, bot-protocol 16, MatchRunner 134 và Python bots 27 tests pass.
- [x] Không có thay đổi contract/schema/ADR-0002 sau khi khóa tại `P1-T01`.
- [x] Chạy GitNexus `detect-changes` trước integration: không có thay đổi cần xử lý.

## Phase 1 — Integration

### [x] P1-T02 — Gộp Node.js/TypeScript/Vitest workspace chung

**Owner:** Đinh Đức Thuận (thay `P1-D01` đã hủy)
**Mô tả:** Gộp các module đã chạy độc lập thành một npm workspace ở root. Trước task này mỗi module tự có `package.json` và chạy trên localhost; task này không triển khai luật game hoặc protocol.
**Acceptance criteria:** (1) Pin Node.js 22 và npm; root có scripts `typecheck`, `test`, `build`; (2) npm workspace globs bao phủ các module Phase 1, giữ nguyên `package.json` và scripts do owner module tạo, chuyển dependency `file:` theo mục 8 của `docs/conventions/module-package.md`; (3) Vitest chạy smoke test và test của mọi module từ root, build không chứa test.
**Verification:** `npm ci && npm run typecheck && npm test && npm run build`.
**Dependencies:** Checkpoint `P1-B`.
**Files dự kiến:** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `tests/smoke.test.ts`
**Ước lượng:** M (5 file)
**Hoàn tất:** Root npm workspace, lockfile chung và smoke import đã được thêm; `npm ci && npm run typecheck && npm test && npm run build` pass (197 TypeScript tests).

### [x] P1-D09 — Tích hợp core thật với MatchRunner

**Owner:** Phạm Tất Đạt
**Mô tả:** Viết GamePort adapter cho core của Long và thay FakeGame tại composition root.
**Acceptance criteria:** (1) Map state/action/result/error không đổi semantics; (2) có integration test core thật + ScriptedBot; (3) chỉ import public package API.
**Verification:** `npm --workspace @ott/match-runner test -- tests/core-adapter.integration.test.ts && npm run typecheck`.
**Dependencies:** `P1-L08`, `P1-D08`, `P1-T02`.
**Files dự kiến:** `src/match-runner/src/core-adapter.ts`, `src/match-runner/src/index.ts`, `src/match-runner/tests/core-adapter.integration.test.ts`
**Ước lượng:** M (3 file)
**Hoàn tất:** `CoreGameAdapter` forward nguyên vẹn các API công khai của `@ott/game-core`; CLI dùng map chuẩn 18 quân và adapter này thay vì `FakeGame`. Integration test chạy core thật với `ScriptedBot`, kiểm tra `TURN_LIMIT`, event log và final hash; typecheck/build pass.

### [x] P1-D10 — E2E hai bot và bot lỗi

**Owner:** Phạm Tất Đạt
**Mô tả:** Chạy CLI với Python process thật cho happy path và fault matrix.
**Acceptance criteria:** (1) Hai bot hợp lệ hoàn tất trận, process thoát sạch; (2) phủ malformed, illegal, stale, timeout, crash, oversized; (3) hai lần cùng input cho cùng event/hash.
**Verification:** `npm --workspace @ott/match-runner test -- tests/e2e && python3 -m unittest discover -s src/bots/python/tests`.
**Dependencies:** `P1-D09`, `P1-N06`.
**Files dự kiến:** `src/match-runner/tests/e2e/happy-path.test.ts`, `src/match-runner/tests/e2e/faults.test.ts`, `src/match-runner/tests/e2e/determinism.test.ts`, `src/match-runner/tests/e2e/helpers.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** 8 E2E test chạy production CLI với Python process thật: happy path (`first_legal_bot`/`capture_first_bot`), `MALFORMED_JSON`, `ILLEGAL_ACTION`, `TURN_ID_MISMATCH`, `BOT_TIMEOUT`, `MESSAGE_TOO_LARGE`, `BOT_CRASHED` và determinism. Mọi event log đều replay được qua core thật; PID của cả hai bot đã dừng sau mỗi trận. Python bot suite: 27 test pass.

### [x] P1-D11 — Runbook và bàn giao local

**Owner:** Phạm Tất Đạt
**Mô tả:** Để Thuận chạy lại toàn bộ Phase 1 từ clean checkout.
**Acceptance criteria:** (1) Có prerequisites/install/test/run/artifact/troubleshooting; (2) ghi config, protocol limits và ranh giới Phase 2; (3) Thuận chạy theo tài liệu và ký P1-C.
**Verification:** `npm ci && npm run typecheck && npm test && npm run build`; chạy command mẫu từ clean checkout.
**Dependencies:** `P1-D10`.
**Files dự kiến:** `README.md`, `docs/runbooks/phase-1-local.md`, `.env.example`
**Ước lượng:** S (3 file)
**Hoàn tất:** Đã thêm root README, `.env.example` không-secret và runbook clean-checkout gồm prerequisites/install/test/run/artifact/troubleshooting/Phase-2 boundary. Đã chạy `npm ci && npm run typecheck && npm test && npm run build`, Python 27 test và command trận mẫu với hai Python bot; artifact `/tmp/ott-phase-1-match.json` được tạo thành công.

## Checkpoint P1-C — Phase 1 hoàn tất

- [x] Full typecheck, unit, contract, integration, E2E và build pass.
- [x] Happy path và fault matrix có automated evidence; replay/determinism pass.
- [x] Không còn child process/open handle; Thuận đã duyệt bàn giao local sau clean-checkout verification ngày 2026-10-12.

## Phase 2 — Local platform

### [x] P2-T01 — Khóa quyết định triển khai Phase 2 local

**Owner:** Đinh Đức Thuận
**Mô tả:** Chốt các giá trị còn mở ảnh hưởng trực tiếp database, API, sandbox, scheduling và Elo trước khi các module đó được triển khai.
**Acceptance criteria:** (1) Chốt auth/RBAC local, K-factor/rating khởi tạo và series đổi phía; (2) chốt OCI artifact/image policy và baseline CPU/RAM/PID để implementation có thể bắt đầu; profile công bố chính thức được khóa riêng ở `P2-T15` sau benchmark; (3) chốt replay chỉ phát sau terminal/integrity check, với BTC stage/publish và không live stream; (4) cập nhật mục 20 của yêu cầu và ADR mới nếu quyết định mang tính kiến trúc.
**Verification:** Không còn quyết định `OPEN/PARTIAL` cản trở implementation `P2-T03`–`P2-T14`; baseline quota, tiêu chí benchmark và cổng mở nhận submission được ghi rõ tại `P2-T15`; owner bị ảnh hưởng review.
**Dependencies:** `P1-D11`.
**Hoàn tất:** 2026-10-12. D-03 (rating 1000/K=32), D-07 (OCI image submission), D-08 (baseline quota), D-09 (1 series/team/round, dải Elo 200 mở rộng +100), D-10 (2 game đổi X/O), D-11 (replay sau terminal) và D-13 (team-account username/password, không self-register) đã được khóa tại Solution Architecture, SAD OCI và ADR-0003 đến ADR-0006. `P2-T15` là evidence gate riêng trước khi đăng ký bot đa ngôn ngữ.
**Files dự kiến:** `docs/architecture/solution-architecture-phase-2.md`, `docs/architecture/sad-oci-bot-submissions.md`, `docs/decisions/0003-replay-publication-after-match.md`, `docs/decisions/0004-phase-2-team-account-authentication.md`, `docs/decisions/0005-phase-2-modular-monolith-and-execution-boundary.md`, `docs/decisions/0006-oci-image-submissions-for-language-neutral-bots.md`, `docs/tai-lieu-yeu-cau.md`, `tasks/plan.md`, `tasks/todo.md`
**Ước lượng:** M (5 file)

### Điều chỉnh owner ngày 2026-10-12 — ID cũ không tái sử dụng

`P2-D01` → `P2-T02`, `P2-D02` → `P2-T03`, `P2-D03` → `P2-T04`, `P2-D17` → `P2-T05`, `P2-D04` → `P2-T06`, `P2-D05` → `P2-T07`, `P2-N01` → `P2-T08`, `P2-D06` → `P2-T09`, `P2-D07` → `P2-T10`, `P2-D08` → `P2-T11`, `P2-D09` → `P2-T12`, `P2-D10` → `P2-T13`.

Các ID cũ bị hủy trước khi triển khai và không được tái sử dụng. Công việc tương ứng được phát hành lại với ID `P2-Txx` để khớp owner Đinh Đức Thuận. Các UI/replay/E2E `P2-D13`–`P2-D16`, `P2-L02`–`P2-L03`, `P2-N14`–`P2-N15` không đổi owner.

### [x] P2-T02 — Docker Compose PostgreSQL, Redis và SeaweedFS

**Owner:** Đinh Đức Thuận
**Mô tả:** Môi trường dependency local có healthcheck và version pin.
**Acceptance criteria:** (1) Ba service chạy localhost; (2) có healthcheck, volume, port/env, bucket init idempotent; (3) SeaweedFS chỉ được dùng qua S3 endpoint/key-secret local, không commit secret; (4) có hướng dẫn reset/start/stop và config AWS S3 migration boundary.
**Verification:** `docker compose -f infra/local/compose.yaml up -d --wait && docker compose -f infra/local/compose.yaml ps`.
**Dependencies:** `P1-D11`.
**Files dự kiến:** `infra/local/compose.yaml`, `.env.example`, `docs/runbooks/local-services.md`, `docs/decisions/0007-seaweedfs-local-s3-compatible-storage.md`
**Ước lượng:** M (4 file)
**Hoàn tất:** 2026-10-12 — Docker Compose xác nhận PostgreSQL, Redis và SeaweedFS đều healthy trên loopback; S3 `HeadBucket`, put/head/delete object dùng credential đúng pass và credential sai bị từ chối `403`.

### [x] P2-T03 — Database schema và migration foundation

**Owner:** Đinh Đức Thuận
**Mô tả:** Schema cho account/session/team, OCI submission identity, match, event/result và rating ledger.
**Acceptance criteria:** (1) PK/FK/unique/index và trạng thái đầy đủ, gồm invariant một `TEAM_ACCOUNT`/team, immutable OCI manifest/config digest và một official result/match; (2) migrate được từ DB rỗng, có reset strategy; (3) integration test dùng PostgreSQL thật.
**Verification:** `npm run db:migrate && npm test -- src/platform/api/tests/db`.
**Dependencies:** `P2-T02`.
**Files:** `src/platform/api/src/db/schema.ts`, `src/platform/api/src/db/client.ts`, `src/platform/api/src/db/migrate.ts`, `src/platform/api/migrations/0001_initial.sql`, `src/platform/api/tests/db/schema.test.ts`, `src/platform/api/README.md`, `src/platform/api/package.json`
**Ước lượng:** M (4 file)
**Hoàn tất:** 2026-10-12 — migration `0001_initial` chạy trên PostgreSQL local từ schema rỗng và idempotent khi chạy lại. Integration test xác nhận invariant một `TEAM_ACCOUNT`/team, OCI manifest/config identity bất biến, một `MatchResult`/match và một `RatingLedger`/team/series; full workspace test/typecheck/build và audit pass trên `main`.

### [x] P2-T14 — OCI submission contract và layout validator

**Owner:** Đinh Đức Thuận
**Mô tả:** Khóa contract `OCI Image Layout v1.1` cho bot đa ngôn ngữ, cùng parser/validator thuần không chạy Docker hoặc build source từ upload.
**Acceptance criteria:** (1) Contract chỉ nhận một archive OCI không nén `linux/amd64`, derive manifest/config digest và OCI Entrypoint; không có language/runtime/tag/command/Dockerfile/registry URL do client khai báo; (2) validator chặn path traversal, link/device file, digest/layout sai, multi-platform/foreign layer, image quá quota và entrypoint rỗng bằng stable error code; (3) fixture gồm OCI image từ Python bot hiện có và fixture invalid, cùng test deterministic không cần Docker daemon.
**Verification:** `npm test --workspace @ott/job-contract -- oci-submission`.
**Dependencies:** `P2-T01`, `P1-D11`.
**Files dự kiến:** `docs/contracts/oci-submission-v1.md`, `src/platform/job-contract/package.json`, `src/platform/job-contract/src/oci-submission.ts`, `src/platform/job-contract/tests/oci-submission.test.ts`, `src/bots/oci-fixtures/README.md`
**Ước lượng:** M (5 file)
**Hoàn tất:** 2026-10-12 — validator thuần kiểm tra tar/path/link/duplicate, OCI layout/index/sha256/platform/Entrypoint và layer foreign; 4 test không cần Docker daemon, typecheck/build module và full workspace suite pass.

### [x] P2-T04 — Authentication và RBAC foundation

**Owner:** Đinh Đức Thuận
**Mô tả:** Thiết lập username/password nội bộ, Redis session và authorization server-side cho `BTC_ADMIN` và `TEAM_ACCOUNT` theo ADR-0004.
**Acceptance criteria:** (1) Login/logout/session dùng opaque session cookie, password Argon2id và bootstrap BTC bằng env local không commit; (2) không có self-register/reset endpoint, login generic failure + rate limit, guard server từ chối unauthenticated/forbidden ổn định; (3) integration tests chứng minh `TEAM_ACCOUNT` chỉ truy cập đúng `teamId`, UI không là ranh giới quyền.
**Verification:** `npm test -- src/platform/api/tests/auth.integration.test.ts` với PostgreSQL local.
**Dependencies:** `P2-T03`.
**Files:** `src/platform/api/src/app.ts`, `src/platform/api/src/modules/auth/{plugin,sessions,authorize,bootstrap,passwords,audit,types}.ts`, `src/platform/api/tests/auth.integration.test.ts`
**Ước lượng:** M (5 file)
**Hoàn tất:** 2026-10-12 — Fastify auth/RBAC foundation dùng Argon2id, Redis opaque session/rate-limit, cookie `HttpOnly`/`SameSite=Lax` (`Secure` mặc định), local BTC bootstrap idempotent và audit không chứa plaintext. Integration PostgreSQL + Redis xác minh generic failure, rate-limit, revoke, stable 401/403 và cross-team server guard; clean install, full workspace 216 tests, typecheck, build và audit pass trên `main`.

### [x] P2-T05 — Auth HTTP contract và local bootstrap config

**Owner:** Đinh Đức Thuận
**Mô tả:** Công bố contract v1 cho login/logout/current-session cùng error semantics và biến môi trường bootstrap BTC để các frontend tích hợp mà không tự suy đoán auth behavior.
**Acceptance criteria:** (1) Contract có typed request/response, cookie/session behavior, role/team principal và error generic; (2) `.env.example` chỉ có tên/format biến bootstrap, không chứa secret thật; (3) không công bố register/self-reset endpoint hoặc password plaintext ngoài response create/reset one-time của team API.
**Verification:** `npm test -- src/platform/api/tests/auth.integration.test.ts && git diff --check`.
**Dependencies:** `P2-T04`.
**Files dự kiến:** `docs/contracts/platform-auth-v1.md`, `.env.example`, `docs/runbooks/local-services.md`
**Ước lượng:** S (3 file)
**Hoàn tất:** 2026-10-12 — Contract v1 công bố login/logout/current-session, opaque cookie/session, role/team principal, stable 401/403/429 semantics và API cố ý vắng mặt; `.env.example` chỉ dùng placeholder bootstrap, runbook cảnh báo test reset local DB/Redis. Auth integration PostgreSQL + Redis pass trên `main` cùng `git diff --check`.

### [ ] P2-L02 — Web shell và team portal login

**Owner:** Long Trần
**Mô tả:** Khởi tạo React/Vite web shell và màn hình đăng nhập duy nhất cho team portal; dùng session API của `P2-T04`, không tạo trang đăng ký.
**Acceptance criteria:** (1) Có login/logout/session restore và route guard, chỉ mở portal sau authentication; (2) không có component, route hay API client self-register/self-reset; (3) generic login failure, loading/accessibility cơ bản và component tests phủ authenticated/unauthenticated/error.
**Verification:** `npm test -- src/platform/web/src/features/auth && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-T05`.
**Files dự kiến:** `src/platform/web/package.json`, `src/platform/web/vite.config.ts`, `src/platform/web/src/app/App.tsx`, `src/platform/web/src/features/auth/LoginPage.tsx`, `src/platform/web/src/features/auth/LoginPage.test.tsx`
**Ước lượng:** M (5 file)

### [x] P2-T06 — Team management vertical slice

**Owner:** Đinh Đức Thuận
**Mô tả:** Fastify API để BTC tạo/đọc/cập nhật team và provision/reset `TEAM_ACCOUNT` trên PostgreSQL.
**Acceptance criteria:** (1) `BTC_ADMIN` chỉ nhập tên đội; server atomically tạo team, username duy nhất và password ngẫu nhiên/hashing; (2) plaintext credential chỉ trả một lần ở create/reset, reset thu hồi session cũ và audit không chứa secret; (3) validate/unique/error ổn định, test success/duplicate/not found/invalid/cross-role.
**Verification:** `npm test -- src/platform/api/tests/teams.integration.test.ts`.
**Dependencies:** `P2-T04`.
**Files dự kiến:** `src/platform/api/src/modules/teams/routes.ts`, `src/platform/api/src/modules/teams/service.ts`, `src/platform/api/src/modules/teams/repository.ts`, `src/platform/api/src/modules/teams/credentials.ts`, `src/platform/api/tests/teams.integration.test.ts`
**Ước lượng:** M (5 file)
**Hoàn tất:** 2026-10-12 — BTC-only API tạo/list/đổi tên/reset credential team; credential plaintext chỉ trong response, password hash Argon2id, audit không chứa secret và reset revoke toàn bộ Redis session account. Integration PostgreSQL+Redis pass 3 test; API suite 9 test pass trên main.

### [x] P2-T07 — OCI submission upload và S3-compatible storage vertical slice

**Owner:** Đinh Đức Thuận
**Mô tả:** Nhận OCI image archive, quarantine/promote object storage và ghi metadata identity bất biến.
**Acceptance criteria:** (1) Chỉ `TEAM_ACCOUNT` sở hữu team được upload đúng contract `P2-T14`; API không nhận language, command, tag, registry URL hoặc Dockerfile; (2) stream sang quarantine, verify archive SHA-256 + OCI manifest/config digest rồi promote bằng server-generated key, lỗi cleanup đúng; (3) submission `PREFLIGHT` pin identity OCI/policy version; P2-T10 mới chuyển `VALID`/`ACTIVE` sau sandbox preflight, download nội bộ verify checksum và không traversal/overwrite.
**Verification:** `npm test -- src/platform/api/tests/submissions.integration.test.ts` với PostgreSQL/SeaweedFS local.
**Dependencies:** `P2-T06`, `P2-T14`.
**Files dự kiến:** `src/platform/api/src/modules/submissions/routes.ts`, `src/platform/api/src/modules/submissions/service.ts`, `src/platform/api/src/storage/s3.ts`, `src/platform/api/tests/submissions.integration.test.ts`, `docs/contracts/oci-submission-v1.md`
**Ước lượng:** M (4 file)
**Hoàn tất:** 2026-10-13 — TEAM_ACCOUNT upload OCI archive qua quarantine/promote SeaweedFS, identity immutable `PREFLIGHT` và internal checksum verification; PostgreSQL+Redis+SeaweedFS integration pass.

### [ ] P2-N14 — BTC team-account provisioning console

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo màn hình BTC tạo team từ tên đội và xem/copy credential sinh từ server đúng một lần; không gửi credential qua hệ thống.
**Acceptance criteria:** (1) Form chỉ có team name, chỉ principal BTC truy cập; (2) sau create/reset hiển thị username/password một lần để BTC copy gửi qua chat ngoài hệ thống, refresh/rerender không thể lấy lại plaintext; (3) confirm reset, loading/success/error/accessibility và component tests đầy đủ.
**Verification:** `npm test -- src/platform/web/src/features/admin-teams && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-L02`, `P2-T06`.
**Files dự kiến:** `src/platform/web/src/features/admin-teams/TeamProvisionPage.tsx`, `src/platform/web/src/features/admin-teams/api.ts`, `src/platform/web/src/features/admin-teams/CredentialOnce.tsx`, `src/platform/web/src/features/admin-teams/TeamProvisionPage.test.tsx`
**Ước lượng:** M (4 file)

### [ ] P2-L03 — Team portal submission UI

**Owner:** Long Trần
**Mô tả:** Tạo frontend để `TEAM_ACCOUNT` đã đăng nhập nộp bot và xem trạng thái submission của chính team; không chọn hoặc giả teamId ở client.
**Acceptance criteria:** (1) Team identity lấy từ session, không có team selector hay trusted client-supplied teamId; (2) client validate file/size, loading/progress/success/error và chống double-submit; (3) component tests phủ happy/invalid/API failure/cross-team denial.
**Verification:** `npm test -- src/platform/web/src/features/submissions && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-L02`, `P2-T07`.
**Files dự kiến:** `src/platform/web/src/features/submissions/SubmissionForm.tsx`, `src/platform/web/src/features/submissions/api.ts`, `src/platform/web/src/features/submissions/SubmissionStatus.tsx`, `src/platform/web/src/features/submissions/SubmissionForm.test.tsx`
**Ước lượng:** M (4 file)

### [ ] P2-T08 — OCI canary bot và sandbox security corpus

**Owner:** Đinh Đức Thuận
**Mô tả:** OCI images tốt/xấu để kiểm thử worker/sandbox; bắt đầu bằng các Python bot Phase 1 được đóng image, sau đó thêm fixture đa ngôn ngữ.
**Acceptance criteria:** (1) Có OCI canary từ FirstLegal/CaptureFirst và timeout/fork/write/network/output/memory/CPU cases; (2) mỗi image có expected outcome, manifest/config digest và chỉ chạy qua harness giới hạn; (3) có ít nhất một fixture Node.js và một native fixture trước khi mở nhận bot đa ngôn ngữ.
**Verification:** `npm test --workspace @ott/sandbox-corpus`.
**Dependencies:** `P1-D11`, `P2-T14`.
**Files dự kiến:** `src/bots/oci-fixtures/first-legal/`, `src/bots/oci-fixtures/capture-first/`, `src/bots/sandbox-corpus/package.json`, `src/bots/sandbox-corpus/manifest.json`, `src/bots/sandbox-corpus/tests/oci-corpus.test.ts`, `src/bots/sandbox-corpus/README.md`
**Ước lượng:** M (5 file)

### [ ] P2-T09 — MatchJob contract và BullMQ worker

**Owner:** Đinh Đức Thuận
**Mô tả:** Queue yêu cầu chạy trận và worker nhận job version hóa.
**Acceptance criteria:** (1) Job schema/version/idempotency key và pinned OCI submission/manifest/config/policy reference hợp lệ, không có tag/command mutable; (2) retry/backoff/dead-letter, duplicate không tạo hai match hoặc thay image; (3) structured log và graceful shutdown.
**Verification:** `npm test -- src/platform/worker/tests/match-job.integration.test.ts` với Redis local.
**Dependencies:** `P2-T02`, `P2-T07`, `P2-T14`, `P2-T01`, `P1-D11`.
**Files dự kiến:** `src/platform/job-contract/src/match-job.ts`, `src/platform/job-contract/src/oci-reference.ts`, `src/platform/api/src/queue/match-queue.ts`, `src/platform/worker/src/worker.ts`, `src/platform/worker/tests/match-job.integration.test.ts`
**Ước lượng:** M (5 file)

### [ ] P2-T10 — Sandbox adapter và artifact validation

**Owner:** Đinh Đức Thuận
**Mô tả:** Dùng Docker Engine local qua `SandboxOciBotPort` để xác minh OCI artifact và chạy bot qua BotPort trong giới hạn tài nguyên/network.
**Acceptance criteria:** (1) Check pinned OCI manifest/config digest và derived entrypoint; không shell-string, không Dockerfile/build/tag/client command; (2) worker override non-root, no-network, read-only rootfs, no Docker socket/mount/capability, CPU/RAM/PID/tmp/output/time limit và cleanup container idempotent; (3) Python fixture Phase 1 chạy qua MatchRunner không đổi protocol, corpus xấu và fixture Node/native bị chặn/chạy đúng expected reason.
**Verification:** `npm test -- src/platform/worker/tests/sandbox.integration.test.ts` trên Docker local.
**Dependencies:** `P2-T07`, `P2-T09`, `P2-T08`.
**Files dự kiến:** `src/platform/worker/src/sandbox/oci-runtime.ts`, `src/platform/worker/src/sandbox/oci-bot-port.ts`, `src/platform/worker/src/sandbox/policy.ts`, `src/platform/worker/src/artifacts.ts`, `src/platform/worker/tests/sandbox.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-T15 — Benchmark quota OCI và gate mở nhận bot đa ngôn ngữ

**Owner:** Đinh Đức Thuận
**Mô tả:** Đo sandbox thực trên Docker local bằng corpus OCI, xác nhận hoặc điều chỉnh profile tài nguyên công bố; đây là cổng bắt buộc trước khi BTC nhận submission từ đội thi ngoài các fixture nội bộ.
**Acceptance criteria:** (1) Chạy có bằng chứng FirstLegal/CaptureFirst, Node.js, native và các case timeout/fork/write/network/output/memory/CPU qua `SandboxOciBotPort`; (2) ghi kết quả benchmark, host specification, policy version và lý do mọi thay đổi quota; (3) cập nhật D-08/SAD/runbook với profile phát hành, hoặc dừng mở đăng ký nếu không có profile thỏa fairness và isolation.
**Verification:** `npm test --workspace @ott/sandbox-corpus && npm test -- src/platform/worker/tests/sandbox.integration.test.ts`; report benchmark được version-control cùng policy.
**Dependencies:** `P2-T08`, `P2-T10`.
**Files dự kiến:** `src/bots/sandbox-corpus/results/`, `src/platform/worker/tests/sandbox.integration.test.ts`, `docs/architecture/sad-oci-bot-submissions.md`, `docs/tai-lieu-yeu-cau.md`, `docs/runbooks/phase-2-local.md`
**Ước lượng:** S (3 file)

### [ ] P2-T11 — MatchResult finalization idempotent

**Owner:** Đinh Đức Thuận
**Mô tả:** Chạy MatchRunner trong worker và ghi result/event đúng một lần.
**Acceptance criteria:** (1) Map output sang result/error chuẩn; (2) retry không nhân đôi result/event/rating trigger; (3) DB result và artifact có checksum/final hash.
**Verification:** `npm test -- src/platform/worker/tests/finalization.integration.test.ts`.
**Dependencies:** `P2-T10`, `P2-T03`.
**Files dự kiến:** `src/platform/worker/src/run-match-job.ts`, `src/platform/worker/src/finalize-result.ts`, `src/platform/worker/src/result-repository.ts`, `src/platform/worker/tests/finalization.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-T12 — Scheduling và series scoring

**Owner:** Đinh Đức Thuận
**Mô tả:** Tạo series/match schedule và tổng hợp điểm Phase 2.
**Acceptance criteria:** (1) Pairings deterministic, không trùng và có idempotency key; (2) finalize khi đủ terminal matches, tie/forfeit/cancel rõ; (3) retry không đổi số match/điểm.
**Verification:** `npm test -- src/platform/api/tests/scheduling.integration.test.ts`.
**Dependencies:** `P2-T11`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/modules/scheduling/service.ts`, `src/platform/api/src/modules/scheduling/repository.ts`, `src/platform/api/src/modules/series/scoring.ts`, `src/platform/api/tests/scheduling.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-T13 — Match results, Elo ledger và leaderboard API

**Owner:** Đinh Đức Thuận
**Mô tả:** Ghi biến động Elo dạng ledger và cung cấp API đọc match/series results cùng leaderboard.
**Acceptance criteria:** (1) Mỗi series terminal tạo một ledger entry; (2) results/leaderboard có authorization, ordering, tie-break và pagination ổn định; (3) rebuild ledger cho cùng rating hiện tại.
**Verification:** `npm test -- src/platform/api/tests/leaderboard.integration.test.ts`.
**Dependencies:** `P2-T12`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/modules/ratings/elo.ts`, `src/platform/api/src/modules/ratings/service.ts`, `src/platform/api/src/modules/ratings/routes.ts`, `src/platform/api/src/modules/results/routes.ts`, `src/platform/api/tests/leaderboard.integration.test.ts`
**Ước lượng:** M (5 file)

### P2-D11 — Đã hủy, tách thành `P2-L02` và `P2-L03`

Không triển khai ID này. Web shell/login và team submission portal được chuyển cho Long để mã owner khớp task ID; `P2-D11` không được tái sử dụng.

### P2-D12 — Đã hủy, tách thành `P2-N15`

Không triển khai ID này. Results/leaderboard UI được chuyển cho Nguyên để chia feature code Phase 2; `P2-D12` không được tái sử dụng.

### [ ] P2-N15 — Results và leaderboard UI

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Hiển thị match/series results, error reason và leaderboard từ API của `P2-T13` trong web shell chung.
**Acceptance criteria:** (1) Hiển thị outcome và liên kết team/submission theo quyền API trả về; (2) leaderboard có tie-break/pagination/loading/empty/error; (3) component tests kiểm tra mapping và states chính, không tự tính Elo ở UI.
**Verification:** `npm test -- src/platform/web/src/features/results src/platform/web/src/features/leaderboard && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-L02`, `P2-T13`.
**Files dự kiến:** `src/platform/web/src/features/results/MatchResult.tsx`, `src/platform/web/src/features/leaderboard/Leaderboard.tsx`, `src/platform/web/src/features/results/api.ts`, `src/platform/web/src/features/results/MatchResult.test.tsx`, `src/platform/web/src/features/leaderboard/Leaderboard.test.tsx`
**Ước lượng:** M (5 file)

### [ ] P2-D14 — Replay catalog và publication API

**Owner:** Phạm Tất Đạt
**Mô tả:** Cung cấp API server-side để BTC liệt kê các trận terminal, stage/publish replay integrity-checked và để spectator chỉ đọc replay đã publish.
**Acceptance criteria:** (1) Chỉ terminal match có event log/checksum hợp lệ mới chuyển `STAGED`/`PUBLISHED`; transition idempotent và audit được actor/lý do; (2) endpoint public theo `matchId` từ chối replay chưa publish và loại dữ liệu nhạy cảm; (3) API trả schema/version/checksum đủ để client kiểm tra artifact và từ chối artifact bị sửa một byte.
**Verification:** `npm test -- src/platform/api/tests/replays.integration.test.ts` với PostgreSQL/SeaweedFS local.
**Dependencies:** `P2-T04`, `P2-T11`.
**Files dự kiến:** `src/platform/api/src/modules/replays/routes.ts`, `src/platform/api/src/modules/replays/service.ts`, `src/platform/api/src/modules/replays/repository.ts`, `src/platform/api/tests/replays.integration.test.ts`
**Ước lượng:** M (4 file)

### [ ] P2-D15 — BTC replay catalog và publication console

**Owner:** Phạm Tất Đạt
**Mô tả:** Tạo GUI chỉ cho BTC để tìm trận terminal, xem metadata/kết quả và chọn stage/publish replay; đây không phải điều khiển trận đang chạy.
**Acceptance criteria:** (1) Hiển thị terminal match, publication state và integrity status; (2) chỉ principal BTC được stage/publish và UI hiển thị lỗi server chuẩn; (3) loading/empty/error/success và component tests phủ state transition.
**Verification:** `npm test -- src/platform/web/src/features/replay-admin && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-L02`, `P2-D14`.
**Files dự kiến:** `src/platform/web/src/features/replay-admin/ReplayCatalog.tsx`, `src/platform/web/src/features/replay-admin/api.ts`, `src/platform/web/src/features/replay-admin/PublicationControls.tsx`, `src/platform/web/src/features/replay-admin/ReplayCatalog.test.tsx`
**Ước lượng:** M (4 file)

### [ ] P2-D16 — Spectator replay UI

**Owner:** Phạm Tất Đạt
**Mô tả:** Tạo màn hình công khai chỉ đọc cho replay `PUBLISHED`, phục vụ BTC trình chiếu cho khán giả sau khi trận kết thúc.
**Acceptance criteria:** (1) Tải và kiểm tra schema/version/checksum của replay published, không truy cập replay private và không hiển thị artifact lệch checksum; (2) play/pause, seek theo event index/snapshot, tốc độ 0.5×/1×/2× và hiển thị đội/map/action/fault/kết quả; (3) responsive desktop/mobile, keyboard/accessibility cơ bản và component tests cho loading/error/checksum mismatch/replay end.
**Verification:** `npm test -- src/platform/web/src/features/spectator && npm run build --workspace src/platform/web`.
**Dependencies:** `P2-D14`, `P2-L02`.
**Files dự kiến:** `src/platform/web/src/features/spectator/ReplayPlayer.tsx`, `src/platform/web/src/features/spectator/replay-state.ts`, `src/platform/web/src/features/spectator/api.ts`, `src/platform/web/src/features/spectator/ReplayPlayer.test.tsx`, `src/platform/web/src/pages/SpectatorReplayPage.tsx`
**Ước lượng:** M (5 file)

### [ ] P2-D13 — Qualification E2E local

**Owner:** Phạm Tất Đạt
**Mô tả:** Chứng minh flow từ team/submission đến worker, result, Elo, publication và spectator replay.
**Acceptance criteria:** (1) Một command dựng service/migrate/chạy flow bằng canary; (2) verify submission → queued → running → terminal → series → rating; (3) verify terminal match → stage/publish → spectator replay, artifact bị sửa một byte bị từ chối, retry/restart không duplicate và artifact audit được.
**Verification:** `npm run test:e2e:qualification`; sau test không còn job active ngoài fixture.
**Dependencies:** `P2-T11`, `P2-T12`, `P2-T13`, `P2-L03`, `P2-N14`, `P2-N15`, `P2-D14`, `P2-D15`, `P2-D16`.
**Files dự kiến:** `tests/e2e/qualification.test.ts`, `tests/e2e/helpers.ts`, `scripts/run-local-qualification.sh`, `docs/runbooks/phase-2-local.md`, `package.json`
**Ước lượng:** M (5 file)

## Checkpoint P2-A — Backend local

- [ ] `P2-T01`–`P2-T15` hoàn tất; API/worker tests pass với Docker services và OCI corpus benchmark.
- [ ] Queue retry, sandbox, finalization idempotency và rating rebuild có automated evidence.
- [ ] Chạy GitNexus `detect-changes` và xử lý mọi HIGH/CRITICAL risk.

## Checkpoint P2-B — Phase 2 local hoàn tất

- [ ] `P2-L02`, `P2-L03`, `P2-N14`, `P2-N15`, `P2-D14`–`P2-D16` hoàn tất; qualification E2E pass gồm BTC provision → team login → submission và replay publication/spectator flow.
- [ ] `npm run typecheck && npm test && npm run build` pass từ clean checkout.
- [ ] Thuận nhận runbook, env contract, artifact format để lập kế hoạch local → cloud riêng.
