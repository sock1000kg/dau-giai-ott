# Task Checklist: Phase 1–3

**Trạng thái:** Phase 1–2 hoàn tất; Phase 3 baseline đã duyệt tại `P3-T01`, Wave 1 sẵn sàng
**Mức khuyến nghị Phase 3:** Cần Đinh Đức Thuận duyệt thủ công
**Plan:** `tasks/plan.md`
**Nguồn:** `docs/team-assignment.md`

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

Các ID cũ bị hủy trước khi triển khai và không được tái sử dụng. Công việc tương ứng được phát hành lại với ID `P2-Txx` để khớp owner Đinh Đức Thuận. Ngày 2026-10-13, các UI/replay/E2E `P2-D13`–`P2-D16`, `P2-L02`–`P2-L03`, `P2-N14`–`P2-N15` cũng bị hủy và phát hành lại thành `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29`.

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
**Mô tả:** Khóa contract OCI Image Spec 1.1 trong OCI Image Layout (`imageLayoutVersion: 1.0.0`) cho bot đa ngôn ngữ, cùng parser/validator thuần không chạy Docker hoặc build source từ upload.
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

### P2-L02 — Đã hủy, phát hành lại thành `P2-T17A`, `P2-T17B` và `P2-T18`

Không triển khai ID này. Web workspace và login/session được chuyển cho Đinh Đức Thuận, đồng thời tách scaffold thành hai task để không trộn package foundation với app shell/behavior xác thực; `P2-L02` không được tái sử dụng.

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

### P2-N14 — Đã hủy, phát hành lại thành `P2-T19`

Không triển khai ID này. BTC team-account provisioning console được chuyển cho Đinh Đức Thuận; `P2-N14` không được tái sử dụng.

### P2-L03 — Đã hủy, phát hành lại thành `P2-T20`

Không triển khai ID này. Team submission portal được chuyển cho Đinh Đức Thuận; `P2-L03` không được tái sử dụng.

### [x] P2-T08 — OCI canary bot và sandbox security corpus

**Owner:** Đinh Đức Thuận
**Mô tả:** OCI images tốt/xấu để kiểm thử worker/sandbox; bắt đầu bằng các Python bot Phase 1 được đóng image, sau đó thêm fixture đa ngôn ngữ.
**Acceptance criteria:** (1) Có OCI canary từ FirstLegal/CaptureFirst và timeout/fork/write/network/output/memory/CPU cases; (2) mỗi image có expected outcome, manifest/config digest và chỉ chạy qua harness giới hạn; (3) có ít nhất một fixture Node.js và một native fixture trước khi mở nhận bot đa ngôn ngữ.
**Verification:** `npm --workspace @ott/sandbox-corpus run build:corpus && npm test --workspace @ott/sandbox-corpus`.
**Dependencies:** `P1-D11`, `P2-T14`.
**Files dự kiến:** `src/bots/oci-fixtures/first-legal/`, `src/bots/oci-fixtures/capture-first/`, `src/bots/sandbox-corpus/package.json`, `src/bots/sandbox-corpus/manifest.json`, `src/bots/sandbox-corpus/tests/oci-corpus.test.ts`, `src/bots/sandbox-corpus/README.md`
**Ước lượng:** M (5 file)
**Hoàn tất:** 2026-10-13 — 11 OCI archives (2 Python, Node, Go native, 7 fault scenarios) build được; manifest lưu archive SHA-256, manifest/config digest, entrypoint và expected outcome. Build lại xác nhận SHA ổn định; validator OCI chấp nhận archive; fault images chỉ dành cho sandbox harness. `sandbox-corpus` tests/typecheck và OCI validator 4 tests pass.

### [x] P2-T09 — MatchJob contract và BullMQ worker

**Owner:** Đinh Đức Thuận
**Mô tả:** Queue yêu cầu chạy trận và worker nhận job version hóa.
**Acceptance criteria:** (1) Job schema/version/idempotency key và pinned OCI submission/manifest/config/policy reference hợp lệ, không có tag/command mutable; (2) retry/backoff/dead-letter, duplicate không tạo hai match hoặc thay image; (3) structured log và graceful shutdown.
**Verification:** `REDIS_URL=redis://... npm test --workspace @ott/platform-worker -- --run tests/match-job.integration.test.ts` với Redis local; `npm test --workspace @ott/job-contract -- --run tests/match-job.test.ts`.
**Dependencies:** `P2-T02`, `P2-T07`, `P2-T14`, `P2-T01`, `P1-D11`.
**Files dự kiến:** job-contract types/schema/tests; API BullMQ producer; worker package/runtime/integration test; README/SAD/task graph.
**Ước lượng:** M (8 logical paths)
**Hoàn tất:** 2026-10-13 — `MatchJobV1` strict/versioned pin submission/archive/manifest/config/policy cho hai phía, idempotency key gắn với UUID trận; BullMQ giữ terminal job, retry exponential 3 lần và dead-letter riêng (poison payload được cách ly ngay, không copy raw payload). Contract unit tests 3/3, Redis integration 4/4 (duplicate/image conflict, retry+DLQ, poison payload, graceful shutdown) và API/worker typecheck pass.

### [x] P2-T10 — Sandbox adapter và artifact validation

**Owner:** Đinh Đức Thuận
**Mô tả:** Dùng Docker Engine local qua `SandboxOciBotPort` để xác minh OCI artifact và chạy bot qua BotPort trong giới hạn tài nguyên/network.
**Acceptance criteria:** (1) Check pinned OCI manifest/config digest và derived entrypoint; không shell-string, không Dockerfile/build/tag/client command; (2) worker override non-root, no-network, read-only rootfs, no Docker socket/mount/capability, CPU/RAM/PID/tmp/output/time limit và cleanup container idempotent; (3) Python fixture Phase 1 chạy qua MatchRunner không đổi protocol, corpus xấu và fixture Node/native bị chặn/chạy đúng expected reason.
**Verification:** `npm test -- src/platform/worker/tests/sandbox.integration.test.ts` trên Docker local.
**Dependencies:** `P2-T07`, `P2-T09`, `P2-T08`.
**Files dự kiến:** `src/platform/worker/src/sandbox/oci-runtime.ts`, `src/platform/worker/src/sandbox/oci-bot-port.ts`, `src/platform/worker/src/sandbox/policy.ts`, `src/platform/worker/src/artifacts.ts`, `src/platform/worker/tests/sandbox.integration.test.ts`
**Ước lượng:** M (4 file)
**Hoàn tất:** 2026-10-13 — Docker Engine API `/images/load` nhập OCI layout, pin image theo manifest digest và đối chiếu Entrypoint; archive SHA/config/policy được kiểm tra trước import. `SandboxOciBotPort` chạy qua MatchRunner không đổi protocol; Docker inspect xác nhận user non-root, network none, read-only rootfs, CapDrop ALL, không mount/device, 1 vCPU/256 MiB/64 PID. Python (2 bot), Node, native và 7 fault corpus: integration 13/13; worker typecheck pass. `OTT_SANDBOX_V1` là baseline nội bộ; benchmark và gate đăng ký ở `P2-T15`. DOCS UPDATED: SAD OCI, worker README, task graph.

### [x] P2-T15 — Benchmark quota OCI và gate mở nhận bot đa ngôn ngữ

**Owner:** Đinh Đức Thuận
**Mô tả:** Đo sandbox thực trên Docker local bằng corpus OCI, xác nhận hoặc điều chỉnh profile tài nguyên công bố; đây là cổng bắt buộc trước khi BTC nhận submission từ đội thi ngoài các fixture nội bộ.
**Acceptance criteria:** (1) Chạy có bằng chứng FirstLegal/CaptureFirst, Node.js, native và các case timeout/fork/write/network/output/memory/CPU qua `SandboxOciBotPort`; (2) ghi kết quả benchmark, host specification, policy version và lý do mọi thay đổi quota; (3) cập nhật D-08/SAD/runbook với profile phát hành, hoặc dừng mở đăng ký nếu không có profile thỏa fairness và isolation.
**Verification:** `npm test --workspace @ott/sandbox-corpus && npm test -- src/platform/worker/tests/sandbox.integration.test.ts`; report benchmark được version-control cùng policy.
**Dependencies:** `P2-T08`, `P2-T10`.
**Files dự kiến:** `src/bots/sandbox-corpus/results/`, `src/platform/worker/tests/sandbox.integration.test.ts`, `docs/architecture/sad-oci-bot-submissions.md`, `docs/tai-lieu-yeu-cau.md`, `docs/runbooks/phase-2-local.md`
**Ước lượng:** S (3 file)

**Hoàn tất:** 2026-10-13 — Docker local, Ubuntu 26.04.1/cgroup v2, Engine 29.8.1/API 1.56, 8 logical CPUs, 40.66 GB RAM. Python FirstLegal/CaptureFirst, Node, native đều `ACTION`; 7 fault canaries được thực thi: timeout/network/CPU bị giới hạn theo turn, fork/write crash, output/memory `RESOURCE_LIMIT_EXCEEDED`; CPU canary đo ~101% của 1 CPU, memory chạm quota 256 MiB. Sandbox corpus 1/1 và Docker integration 14/14 pass. Report: `src/bots/sandbox-corpus/results/2026-10-13-local-docker.json`. Một máy/một lượt chưa chứng minh fairness; không đổi D-08, `OTT_SANDBOX_V1` vẫn baseline nội bộ và registration tiếp tục đóng đến benchmark lặp trên host đại diện + BTC duyệt. DOCS UPDATED: SAD OCI, yêu cầu D-08, worker README, Phase 2 runbook, sandbox report.

### [x] P2-T11 — MatchResult finalization idempotent

**Owner:** Đinh Đức Thuận
**Mô tả:** Chạy MatchRunner trong worker và ghi result/event đúng một lần.
**Acceptance criteria:** (1) Map output sang result/error chuẩn; (2) retry không nhân đôi result/event/rating trigger; (3) DB result và artifact có checksum/final hash.
**Verification:** `npm test -- src/platform/worker/tests/finalization.integration.test.ts`.
**Dependencies:** `P2-T10`, `P2-T03`.
**Files dự kiến:** `src/platform/worker/src/run-match-job.ts`, `src/platform/worker/src/finalize-result.ts`, `src/platform/worker/src/result-repository.ts`, `src/platform/worker/tests/finalization.integration.test.ts`
**Ước lượng:** M (4 file)

**Hoàn tất:** 2026-10-13 — Worker claim match bằng row lock + 15 phút lease, so sánh immutable artifact refs với DB, SHA-256 archive, chạy `MatchRunner` qua OCI BotPort, verify event log/replay, upload theo content hash. Migration 0002 lưu execution snapshot/lease, giới hạn baseline 200 turns/3 giây và trigger DB từ chối sửa snapshot, cùng transactional outbox unique `(match_id,event_type)`. Finalize transaction ghi một `MatchResult`, event trail, `MATCH_FINALIZED`, thành công attempt và status `FINALIZED`; lỗi hạ tầng retryable/final attempt terminal, bot crash là FORFEIT chính thức. Integration PostgreSQL 5/5 pass (concurrent lease, redelivery, corrupt archive/retry, forfeit, immutable snapshot), worker/API typecheck pass; worker Redis retry integration 4/4 pass. DOCS UPDATED: Solution Architecture, worker README, Phase 2 runbook, task graph.

### [x] P2-T12 — Scheduling và series scoring

**Owner:** Đinh Đức Thuận
**Mô tả:** Tạo series/match schedule và tổng hợp điểm Phase 2.
**Acceptance criteria:** (1) Pairings deterministic, không trùng và có idempotency key; (2) finalize khi đủ terminal matches, tie/forfeit/cancel rõ; (3) retry không đổi số match/điểm.
**Verification:** `npm test -- src/platform/api/tests/scheduling.integration.test.ts`.
**Dependencies:** `P2-T11`, `P2-T01`.
**Files dự kiến:** `src/platform/api/src/modules/scheduling/service.ts`, `src/platform/api/src/modules/scheduling/repository.ts`, `src/platform/api/src/modules/series/scoring.ts`, `src/platform/api/tests/scheduling.integration.test.ts`
**Ước lượng:** M (4 file)

**Hoàn tất:** 2026-10-13 — Migration 0003 bổ sung round snapshot/idempotency, series BO2/score, unique participant per round, pairing reverse-pair guard, swapped game number và immutability triggers; `scheduleRound` đọc active submission/current rating từ DB, khóa đồng thời theo stage, greedy pairing band 200 +100 và tránh rematch trong 3 round gần nhất, ghi bye, 2 match X/O đảo phe và `MATCH_SCHEDULED` outbox atomically. Queue dispatcher validates payload và retry an toàn qua stable MatchQueue key; `settleSeries` đợi đủ hai terminal games, tính điểm theo side swap, retry idempotent, tie rõ ràng, hạ tầng failure/cancel không có score (bot FORFEIT vẫn là result chính thức). Mỗi stage chỉ có một round mở; round mới bị chặn đến khi mọi series FINALIZED ở round trước có đủ 2 rating ledger entries từ P2-T13; series CANCELLED không cần ledger. Test logic 9/9, PostgreSQL schema+scheduling integration 11/11, worker finalization integration 5/5; full test/typecheck/build pass, audit 0 vulnerabilities; docs SAD, API README và local runbook updated. DOCS UPDATED: Solution Architecture Phase 2, platform API README, Phase 2 local runbook, task graph.

### [x] P2-T13 — Match results, Elo ledger và leaderboard API (nhóm task)

**Owner:** Đinh Đức Thuận
**Mô tả:** Hoàn thiện Elo ledger, leaderboard và API kết quả; được tách thành các PR nhỏ theo ranh giới triển khai.
**Acceptance criteria:** (1) Mỗi series terminal tạo ledger entry đúng một lần từ snapshot đầu vòng; (2) rebuild/replay giữ nguyên rating hiện tại; (3) leaderboard và results có authorization, ordering, tie-break và pagination ổn định.
**Dependencies:** `P2-T12`, `P2-T01`.
**Ước lượng:** L (3 task con)
**Hoàn tất:** 2026-10-13 — T13A Elo/ledger/rebuild, T13B public leaderboard và T13C authenticated match/series results hoàn thành. PostgreSQL integration của ba lát 8/8 pass, API suite/typecheck/build pass; exact leaderboard tie chờ BTC và results giới hạn theo session owner. DOCS UPDATED: API README, task graph/checklist.

#### [x] P2-T13A — Elo calculation, round ledger và rebuild verification

**Owner:** Đinh Đức Thuận
**Mô tả:** Áp dụng Elo cho toàn bộ series hợp lệ sau khi vòng terminal, ghi ledger nguyên tử/idempotent và cung cấp phép rebuild đối chiếu.
**Acceptance criteria:** (1) Mỗi series FINALIZED có đúng hai ledger entry, series hủy/lỗi hạ tầng không đổi Elo; (2) mọi series trong vòng dùng rating snapshot đầu vòng; (3) chạy lại không nhân đôi và rebuild cùng dữ liệu cho cùng current rating.
**Verification:** API rating unit/integration tests với PostgreSQL.
**Dependencies:** `P2-T12`, `P2-T01`.
**Files dự kiến:** migration, `ratings/elo.ts`, `ratings/service.ts`, tests.
**Hoàn tất:** 2026-10-13 — Migration 0004 thêm marker `rating_applied_at`; rating Elo K=32 dùng round snapshot và delta integer zero-sum. `settleSeries` tự áp dụng rating sau khi round terminal; thao tác transaction/idempotent và không ghi series hủy. `rebuildRatingLedger` phục hồi entry thiếu từ snapshot/kết quả bất biến và từ chối mismatch. PostgreSQL rating + scheduling integration 4/4; API unit suite 13 passed/13 DB tests skipped; typecheck/build pass. GitNexus all/compare main: HIGH, 10 execution flows; review xác nhận wiring settlement có integration evidence, apply service impact LOW. Mutation check đảo nhánh kết quả làm PostgreSQL test thất bại như kỳ vọng. DOCS UPDATED: API README, task graph/checklist.

#### [x] P2-T13B — Leaderboard API và tie-break

**Owner:** Đinh Đức Thuận
**Mô tả:** Cung cấp leaderboard ổn định với thứ tự theo Elo, điểm đối đầu, win-rate, lỗi kỹ thuật/forfeit và khóa cuối xác định.
**Acceptance criteria:** (1) Public response chỉ gồm field được phép; (2) xếp Elo, head-to-head trong cùng Elo cohort, win rate, faults/forfeit; exact ties cùng rank và báo BTC cần tie-break, team ID chỉ ổn định thứ tự trình bày; (3) pagination validate/bounded, ổn định.
**Verification:** `npm test --workspace @ott/platform-api -- --run tests/leaderboard.integration.test.ts`.
**Dependencies:** `P2-T13A`.
**Files dự kiến:** `ratings/routes.ts`, repository/query, tests, API docs.
**Hoàn tất:** 2026-10-13 — Public leaderboard query tổng hợp Elo/record, h2h, fault skip và forfeit, rank ổn định; exact ties giữ đồng hạng và đánh dấu `BTC_REQUIRED`, không tự biến UUID thành luật thi đấu. Route public đăng ký trong app, lọc stage, pagination có giới hạn. PostgreSQL integration 2/2 qua `createAuthApp` (ẩn danh), API typecheck/build pass; mutation validation đảo điều kiện làm test thất bại. GitNexus all/compare main HIGH do `createAuthApp` composition-root fan-out 10 flows; xác nhận route là đăng ký sibling và app-level integration pass. DOCS UPDATED: API README và task graph/checklist.

#### [x] P2-T13C — Match/series results API với RBAC

**Owner:** Đinh Đức Thuận
**Mô tả:** Cung cấp kết quả trận/series cho BTC và giới hạn tài khoản đội vào dữ liệu được phép xem.
**Acceptance criteria:** (1) Team account không thể đọc chéo team; BTC xem trong phạm vi giải; (2) response không lộ seed, object key hay artifact riêng tư; (3) ordering và pagination deterministic, có reason/terminal outcome.
**Verification:** `npm test --workspace @ott/platform-api -- --run tests/results.integration.test.ts`; gồm unauthenticated, team IDOR và BTC cases.
**Dependencies:** `P2-T12`, `P2-T01`.
**Files dự kiến:** `results/routes.ts`, app registration, tests, API docs.
**Hoàn tất:** 2026-10-13 — `GET /api/v1/results/matches` và `/series` yêu cầu login, team account được scope bằng principal (IDOR trả 403), BTC xem/filter toàn giải; chỉ trả terminal results, order/pagination deterministic, không lộ seed/object/replay keys. PostgreSQL+Redis integration 2/2, API suite/typecheck/build pass; mutation bỏ scope làm test thấy 4 thay vì 2 kết quả rồi khôi phục. GitNexus all/compare main HIGH do app composition-root fan-out 15 flows; context xác nhận route mới là sibling registration, app-level auth/IDOR integration pass. DOCS UPDATED: API README, task graph/checklist.

### P2-D11 — Đã hủy, tách thành `P2-L02` và `P2-L03`

Không triển khai ID này. Web shell/login và team submission portal từng được tách thành `P2-L02`/`P2-L03`, sau đó phát hành lại thành `P2-T17A`/`P2-T17B`/`P2-T18`/`P2-T20`; `P2-D11` không được tái sử dụng.

### P2-D12 — Đã hủy, tách thành `P2-N15`

Không triển khai ID này. Results/leaderboard UI từng được chuyển thành `P2-N15`, sau đó phát hành lại thành `P2-T21`/`P2-T22`; `P2-D12` không được tái sử dụng.

### P2-N15 — Đã hủy, phát hành lại thành `P2-T21` và `P2-T22`

Không triển khai ID này. Results và leaderboard UI được chuyển cho Đinh Đức Thuận và tách thành hai feature độc lập; `P2-N15` không được tái sử dụng.

### P2-D14 — Đã hủy, phát hành lại thành `P2-T23` và `P2-T24`

Không triển khai ID này. Replay persistence/catalog và publication HTTP/integrity được chuyển cho Đinh Đức Thuận, tách theo transaction boundary; `P2-D14` không được tái sử dụng.

### P2-D15 — Đã hủy, phát hành lại thành `P2-T25`

Không triển khai ID này. BTC replay console được chuyển cho Đinh Đức Thuận; `P2-D15` không được tái sử dụng.

### P2-D16 — Đã hủy, phát hành lại thành `P2-T26` và `P2-T27`

Không triển khai ID này. Spectator replay được chuyển cho Đinh Đức Thuận và tách client integrity khỏi player UI; `P2-D16` không được tái sử dụng.

### P2-D13 — Đã hủy, phát hành lại thành `P2-T28` và `P2-T29`

Không triển khai ID này. Qualification E2E được chuyển cho Đinh Đức Thuận và tách harness khỏi full-flow assertions; `P2-D13` không được tái sử dụng.

### [x] P2-T16 — Rebaseline ownership và execution loop Phase 2

**Owner:** Đinh Đức Thuận
**Mô tả:** Chuyển toàn bộ phần Phase 2 còn mở sang Thuận, loại cloud deployment khỏi phạm vi và phát hành task nhỏ cho vòng lặp AI tuần tự.
**Acceptance criteria:** (1) Không còn task Phase 2 mở mang owner khác Thuận; (2) ID cũ được ghi hủy và không tái sử dụng; (3) plan, assignment, AI context và diagram cùng một dependency graph, mỗi task mới có acceptance/verification/files.
**Verification:** `git diff --check`; `rg -n '^### \[ \] P2-' tasks/todo.md` chỉ trả task `P2-Txx`, và text search không còn owner Phase 2 mở ngoài Thuận.
**Dependencies:** `P2-T01`–`P2-T15`.
**Files:** `tasks/todo.md`, `tasks/plan.md`, `docs/team-assignment.md`, `docs/README.md`, `docs/ai-context/*.md`
**Ước lượng:** M (docs governance)
**Hoàn tất:** 2026-10-13 — toàn bộ scope Phase 2 còn lại được phát hành lại thành `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29`; deploy cloud bị loại khỏi Definition of Done Phase 2 local.

### [x] P2-T17A — React/Vite workspace package foundation

**Owner:** Đinh Đức Thuận
**Mô tả:** Đăng ký `src/platform/web` thành npm workspace và khóa React/Vite/tooling dependencies trước khi thêm app behavior.
**Acceptance criteria:** (1) Root workspace nhận đúng `@ott/platform-web`; React, React DOM, Vite, Testing Library và jsdom được pin chính xác; (2) module tuân exports và hai TypeScript config của convention package; (3) test import package chạy qua Vitest, chưa có auth/domain behavior.
**Verification:** Pass 2026-10-13: `npm ci`; workspace test (no module tests yet), typecheck and build; root `npm test`, `npm run typecheck`, and `npm run build` all pass. Root suite includes the new `@ott/platform-web` public-import smoke test. `npm ci` reported 0 vulnerabilities.
**Dependencies:** `P2-T16`.
**Files dự kiến:** `package.json`, `package-lock.json`, `src/platform/web/package.json`, `src/platform/web/tsconfig.json`, `src/platform/web/tsconfig.build.json`, `src/platform/web/src/index.ts`, `tests/smoke.test.ts`
**Ước lượng:** M (7 file; workspace/lock/config foundation)

### [x] P2-T17B — React/Vite app shell và component test harness

**Owner:** Đinh Đức Thuận
**Mô tả:** Tạo entrypoint, app shell tối thiểu và jsdom test harness trên workspace đã đăng ký.
**Acceptance criteria:** (1) Vite render app shell từ `main.tsx`; (2) Vitest/Testing Library chạy component test với cleanup/setup ổn định; (3) build không nhúng secret/env production và shell chưa tự giả auth/domain data.
**Verification:** Pass 2026-10-13: workspace component test (1/1), typecheck, production build; root `npm test`, `npm run typecheck`, `npm run build` pass. Dev-server HTTP smoke returned Vietnamese HTML title and transformed React entry/App modules. Build output contains no configured secret/env values. Chrome DevTools MCP was unavailable, so visual browser inspection was not performed.
**Dependencies:** `P2-T17A`.
**Files dự kiến:** `src/platform/web/package.json`, root `package-lock.json`, `src/platform/web/vite.config.ts`, `src/platform/web/index.html`, `src/platform/web/src/main.tsx`, `src/platform/web/src/app/App.tsx`, `src/platform/web/src/app/App.test.tsx`, `src/platform/web/src/test/setup.ts`
**Ước lượng:** M (8 files; shell, React transform and jsdom harness)

### [x] P2-T18 — Login, session restore và route authorization UI

**Owner:** Đinh Đức Thuận
**Mô tả:** Hoàn thiện login/logout/current-session và route guard cho `BTC_ADMIN`/`TEAM_ACCOUNT`, không self-register/reset.
**Acceptance criteria:** (1) Session restore chặn nội dung riêng tư cho đến khi biết principal; (2) generic login failure, logout và role guard dùng cookie session contract; (3) keyboard/label/focus/loading/error states và component tests phủ anonymous/team/BTC/expired session.
**Verification:** Pass 2026-10-13: auth suite 9/9 and App shell test 1/1; root tests/typecheck/build pass; verified login sends same-origin cookie credentials, expired session shows login, server roles choose the appropriate area, cross-role UI route is denied, generic 401/rate-limit messages, successful/retryable logout, and server-error session restore keeps private content hidden. A role inversion mutation made the route test fail, then was reverted and the auth suite passed 9/9. GitNexus all/compare reports `CRITICAL` because 17 affected flows traverse the new auth composition (restore/session, login/credential parsing, error states, logout); each is an intended auth path, no backend authorization code changed, and tests exercise the key success/failure branches. This graph warning was reviewed, not waived using `riskSharedAxes`. Browser DevTools MCP unavailable; component tests run in jsdom.
**Dependencies:** `P2-T17B`, `P2-T05`.
**Files dự kiến:** `src/platform/web/README.md`, `src/platform/web/src/features/auth/api.ts`, `src/platform/web/src/features/auth/AuthProvider.tsx`, `src/platform/web/src/features/auth/LoginPage.tsx`, `src/platform/web/src/app/routes.tsx`, `src/platform/web/src/app/App.tsx`, `src/platform/web/src/app/App.test.tsx`, `src/platform/web/src/app/styles.css`, `src/platform/web/src/features/auth/auth.test.tsx`
**Ước lượng:** M (9 files; contract client, auth state, routing and accessible login shell)

### [x] P2-T19 — BTC team-account provisioning console

**Owner:** Đinh Đức Thuận
**Mô tả:** Cho BTC tạo team từ tên đội, reset credential và xem/copy plaintext đúng một lần để gửi ngoài hệ thống.
**Acceptance criteria:** (1) Chỉ `BTC_ADMIN` vào route và form create chỉ nhận team name; (2) credential chỉ nằm trong response/create-reset view, biến mất khi dismiss/navigation/refresh; (3) confirm reset, copy feedback, loading/empty/error và tests phủ role denial/one-time handling.
**Verification:** Pass 2026-10-13: admin-teams component/API-client suite 10/10, workspace suite 20/20, root tests/typecheck/build pass; create sends only trimmed team name, role guard denies TEAM_ACCOUNT, credential view supports copy/dismiss and clears on `pagehide`, reset requires and honors confirmation, empty/loading/error/retry states are covered, malformed credential/server error details are not rendered. A role-gate inversion mutation made the team-route denial test fail; reverted and workspace suite passed 20/20. GitNexus all/compare reports `CRITICAL` across 20 flows because admin routes extend the app composition; the flows were reviewed by path: auth route/session, team create+shape/error, team reset+shape/error, list+retry, and one-time copy/clear. The backend `P2-T06` route enforces BTC server-side; this change adds no authority to the UI and the role-denial test passes. Warning reviewed, not waived using `riskSharedAxes`. P2-T06 integration test was invoked but skipped 3/3 because `DATABASE_URL`/`REDIS_URL` are absent; that fixture drops `public` schema/flushes Redis, so it was not pointed at any unverified data store. The exact route/response shapes were checked in `src/platform/api/src/modules/teams/routes.ts`.
**Dependencies:** `P2-T18`, `P2-T06`.
**Files dự kiến:** `src/platform/web/README.md`, `src/platform/web/src/app/routes.tsx`, `src/platform/web/src/app/App.tsx`, `src/platform/web/src/app/App.test.tsx`, `src/platform/web/src/app/styles.css`, `src/platform/web/src/features/auth/auth.test.tsx`, `src/platform/web/src/features/admin-teams/api.ts`, `src/platform/web/src/features/admin-teams/TeamProvisionPage.tsx`, `src/platform/web/src/features/admin-teams/CredentialOnce.tsx`, `src/platform/web/src/features/admin-teams/TeamProvisionPage.test.tsx`
**Ước lượng:** M (10 files; BTC route, provisioning/reset and one-time credential UI)

### [x] P2-T20 — Team OCI submission portal

**Owner:** Đinh Đức Thuận
**Mô tả:** Cho team đã đăng nhập nộp OCI archive và xem submission của chính team, không tin `teamId` từ browser.
**Acceptance criteria:** (1) UI không có team selector/language/command/tag/registry URL và API client không gửi teamId; (2) validate file/size, khóa double-submit, hiển thị progress và stable server error; (3) list/status chỉ lấy scope session, tests phủ invalid file/API failure/forbidden.
**Verification:** Pass 2026-10-13: root `npm test`, `npm run typecheck`, and `npm run build` pass; web workspace 32/32, API 17 passed with 17 service-dependent integration tests skipped (no DB/Redis/S3 env); focused web submission/auth tests 21/21 and API route tests 4/4. Local dev-server HTTP smoke served `/team/submissions` SPA and transformed its route component. Component/API tests cover empty/non-tar/over-limit files, progress, duplicate-submit lock, status paging, retry/error/forbidden, and no team selector; API tests prove session-team SQL scope, BTC 403, bounded pagination, and malformed page rejection. Mutation replacing `principal.teamId` with `wrong-team` made the ownership test fail; restored and reran full checks. GitNexus staged/compare detected CRITICAL across 19 flows; reviewed auth/session composition, team upload/list/file validation/error paths and server OCI validation/authorization. No partial/truncated flag on these changed-flow responses; the global inventory separately warns that 14/214 candidate entry points and 293 callees are omitted, so global coverage is incomplete. Browser DevTools MCP is unavailable, so no browser screenshot/DOM inspection. API integration fixture is service-gated and destructive to schema/Redis, so it was not pointed at unverified services.
**Dependencies:** `P2-T18`, `P2-T07`.
**Files dự kiến:** `docs/contracts/oci-submission-v1.md`, `src/platform/api/src/modules/submissions/routes.ts`, `src/platform/api/tests/submissions.routes.test.ts`, `src/platform/web/README.md`, `src/platform/web/src/app/routes.tsx`, `src/platform/web/src/app/styles.css`, `src/platform/web/src/features/auth/auth.test.tsx`, và `src/platform/web/src/features/submissions/{api.ts,api.test.ts,SubmissionForm.tsx,SubmissionForm.test.tsx,SubmissionStatus.tsx}`.
**Ước lượng:** M (12 implementation/test/docs files plus task-status docs)

### [x] P2-T21 — Team/BTC match và series results UI

**Owner:** Đinh Đức Thuận
**Mô tả:** Hiển thị match/series terminal results theo server-side RBAC và pagination của `P2-T13C`.
**Acceptance criteria:** (1) team chỉ thấy scope API trả về, BTC có filter team; (2) outcome/reason/fault/pagination/order được render mà không lộ seed/object key; (3) loading/empty/error/forbidden và mapping tests đầy đủ.
**Verification:** Pass 2026-10-13: root `npm test` (40 web tests; 17 API and 5 worker environment-gated integration cases skipped in this root invocation), `npm run typecheck`, and `npm run build` pass. Isolated-service checks: results UI 7/7, auth UI 11/11, API routes 2/2, API PostgreSQL/Redis integration 2/2, and worker PostgreSQL finalization integration 5/5. Migration 0005 was applied by both integration suites; stored runner fault summaries were asserted for normal completion and a BOT_CRASHED forfeit. API/UI tests cover server-owned team scope, BTC team filter, outcome/reason/fault display, pagination, no seed/object key, fault JSON allowlisting, and loading/empty/forbidden/error states. A mutation reversing the BTC-role filter made the API route test fail; after restoration the route/UI suites passed. Local Vite HTTP smoke returned the `/team/results` SPA and transformed the results page module. GitNexus staged/compare reported CRITICAL, 147 changed symbols, 20 files and 26 affected flows; all 26 returned flows were inspected, with no `partial`/`truncated` response flag. Global flow inventory remains incomplete (23/223 entrypoint candidates and 294 callees omitted), so it is not evidence of zero impact. Browser DevTools MCP is unavailable; no visual browser inspection. No cloud deployment.
**Dependencies:** `P2-T18`, `P2-T13C`.
**Files:** `src/platform/api/migrations/0005_match_fault_summary.sql`, `src/platform/api/src/db/schema.ts`, results API, worker finalization persistence, route/worker tests and docs, plus results UI/auth routes/styles/tests.
**Ước lượng:** M (cross-layer persistence/API/UI slice)

### [x] P2-T22 — Public leaderboard UI

**Owner:** Đinh Đức Thuận
**Mô tả:** Hiển thị leaderboard public từ `P2-T13B`, giữ nguyên rank/tie-break của server.
**Acceptance criteria:** (1) không tự tính Elo/rank/head-to-head ở client; (2) exact tie hiển thị đồng hạng và `BTC_REQUIRED`; (3) pagination, loading/empty/error, responsive table và accessibility tests pass.
**Verification:** Pass 2026-10-13: root `npm test` (web 44/44; API 19 passed/17 DB-service-gated skipped; worker 19 passed/5 DB-service-gated skipped), `npm run typecheck`, and `npm run build` pass; focused leaderboard UI 4/4 and auth route suite passes. Existing leaderboard PostgreSQL integration tests pass 2/2 on a disposable database with current migrations. Component/API tests verify anonymous `/leaderboard` makes no auth request, preserves non-contiguous server ranks and `BTC_REQUIRED` ties without client ranking, sends stage/page filters, excludes seed/object key, and covers loading/empty/retryable error with accessible table/status/labels. Mutating the mapped rank by +1 failed three focused tests; after restoring server rank mapping, all four pass. Local Vite HTTP smoke served the `/leaderboard` SPA and transformed both page/table modules. Chrome DevTools MCP is not available in this session, so there is no live DOM/screenshot inspection. GitNexus staged/compare reported HIGH, 23 changed symbols, 10 files and 13 affected flows; all 13 returned flows were reviewed with no `partial`/`truncated` flags. Global flow inventory is incomplete (27/227 entrypoint candidates and 287 callees omitted). No API behavior/dependency change or cloud deployment.
**Dependencies:** `P2-T17B`, `P2-T13B`.
**Files:** `src/platform/web/src/features/leaderboard/{api.ts,LeaderboardPage.tsx,LeaderboardTable.tsx,leaderboard.test.tsx}`, public app routing/header/styles, and web README.
**Ước lượng:** M (4 file)

### [x] P2-T23 — Replay publication persistence và catalog repository

**Owner:** Đinh Đức Thuận
**Mô tả:** Thêm model/migration/repository cho lifecycle `PRIVATE` → `STAGED` → `PUBLISHED` và BTC terminal-match catalog.
**Acceptance criteria:** (1) một publication row/match với state transition bất biến và idempotency constraint; (2) chỉ match terminal có verified replay identity mới được stage; (3) actor/reason/time audit lưu được nhưng không chứa credential/object body.
**Verification:** Pass 2026-10-13: isolated PostgreSQL integration 5/5 (including simultaneous idempotent stage, publish retry, invalid actor/status/checksum, immutable transition/identity/audit, and catalog privacy/pagination); API unit suite 19 pass/22 service-gated skips; root `npm test`, `npm run typecheck`, and `npm run build` pass. Migration 0006 was applied in a random disposable schema and removed during test teardown. GitNexus staged/compare: HIGH, 111 symbols, 10 files, 8 affected flows; all eight are the new stage/publish transaction and validation paths, and direct source search confirms no callers outside repository tests yet (T24 will wire the API). The global flow index remains incomplete (33/233 entrypoint candidates and 298 callees omitted), so this is not treated as zero-impact proof. No cloud deployment.
**Dependencies:** `P2-T04`, `P2-T11`, `P2-T16`.
**Files dự kiến:** `src/platform/api/migrations/0006_replay_publication.sql`, `src/platform/api/src/modules/replays/types.ts`, `src/platform/api/src/modules/replays/repository.ts`, `src/platform/api/tests/replay-publication-repository.integration.test.ts`
**Ước lượng:** M (4 file)

### [x] P2-T24 — Replay publication và public artifact HTTP API

**Owner:** Đinh Đức Thuận
**Mô tả:** Cung cấp BTC catalog/stage/publish endpoints và public read endpoint chỉ cho replay đã publish.
**Acceptance criteria:** (1) BTC transitions idempotent, server kiểm tra terminal state + stored checksum trước publish; (2) anonymous chỉ đọc `PUBLISHED`, response loại seed/private object key và có schema/version/checksum; (3) test từ chối unauthenticated/TEAM_ACCOUNT transition, private replay và artifact bị sửa một byte.
**Verification:** Pass 2026-10-13: T24 integration 1/1 against isolated PostgreSQL schema, local Redis and a disposable SeaweedFS S3 container; root `npm test`, `npm run typecheck`, and `npm run build` pass. Integration covers BTC catalog/auth boundaries, team/anonymous transition denial, PRIVATE not-found, idempotent stage/publish retries, tamper rejection before publish and public read, seed/key exclusion, and SHA-256 of exact public response bytes. A checksum-comparison mutation caused the valid stage assertion to fail; after restoring the guard the same integration passes. GitNexus staged/compare reports CRITICAL, 137 symbols, 14 files and 42 flows; all 42 returned flows reviewed. The aggregate warning is driven by the API composition-root change (`createAuthApp`) linking existing auth/error/query flows plus the new replay flows; targeted integration and complete workspace test/typecheck/build pass. Global flow inventory remains incomplete (47/247 entrypoint candidates and 323 callees omitted), so this is not treated as zero-impact proof. No Redis flush, shared bucket writes, or cloud deployment.
**Dependencies:** `P2-T23`.
**Files dự kiến:** `src/platform/api/src/modules/replays/service.ts`, `src/platform/api/src/modules/replays/routes.ts`, `src/platform/api/tests/replays.integration.test.ts`, `src/platform/api/src/app.ts`, `src/platform/api/README.md`
**Ước lượng:** M (5 file)

### [x] P2-T25 — BTC replay catalog và publication console

**Owner:** Đinh Đức Thuận
**Mô tả:** Cho BTC tìm terminal match, xem integrity/publication state và stage/publish replay sau trận.
**Acceptance criteria:** (1) route chỉ dành cho BTC và không có live control; (2) transition có confirm/reason, double-click không tạo duplicate và UI refresh theo response chính thức; (3) loading/empty/error/success và component tests phủ state machine.
**Verification:** Pass 2026-10-13: replay-admin UI suite 5/5; full web suite 49/49; root `npm test`, `npm run typecheck`, and `npm run build` pass. Covers BTC-only route, catalog loading/empty/retryable error, stage→publish server reconciliation, required reason, stable idempotency key on retry, and duplicate-submit lock. Mutating the transition response match-ID guard caused 3 focused tests to fail; after restoration the suite passes. Local Vite HTTP smoke served `/admin/replays` SPA and transformed the replay catalog module. GitNexus staged/compare reports CRITICAL, 27 symbols, 10 files and 18 affected flows; all 18 returned flows reviewed. The aggregate warning links `AuthRoutes` through existing app/session flows and the new replay paths; root suite covers those existing web paths. Global flow index is incomplete (55/255 entrypoint candidates and 325 callees omitted), so this is not treated as zero-impact proof. Chrome DevTools MCP/browser DOM inspection is unavailable in this session; no screenshot/accessibility-tree inspection. No live match controls or private object key/seed are rendered.
**Dependencies:** `P2-T18`, `P2-T24`.
**Files:** `src/platform/web/src/features/replay-admin/{api.ts,ReplayCatalog.tsx,PublicationControls.tsx,ReplayCatalog.test.tsx}`, `src/platform/web/src/app/{routes.tsx,styles.css}`, `src/platform/web/README.md`
**Ước lượng:** M (4 file)

### [x] P2-T26 — Spectator replay client và integrity verification

**Owner:** Đinh Đức Thuận
**Mô tả:** Xây client public tải replay và kiểm tra schema/version/checksum trước khi giao dữ liệu cho player.
**Acceptance criteria:** (1) private/not-found/schema mismatch có error ổn định; (2) checksum tính trên canonical bytes theo API contract và mismatch không trả event data; (3) tests dùng valid/tampered/unsupported fixtures, không phụ thuộc UI timer.
**Verification:** Pass 2026-10-13: replay integrity suite 10/10; full web suite 59/59; root `npm test`, `npm run typecheck`, and `npm run build` pass. Tests verify exact raw body bytes (including final newline) before parse, valid event sequence starting at 0, tampering rejected before return, stable private/not-found and schema errors, allowlist strips seed/unknown fields, anonymous fetch uses `credentials: omit`, invalid ID/network failure handling. Inverting the checksum guard made 6 tests fail; restored verifier passes. GitNexus staged/compare reports HIGH, 57 symbols, 8 files and 9 flows; all 9 returned flows reviewed and they resolve to the new replay parser/validator and docs references. Global flow index is incomplete (71/271 entrypoint candidates and 346 callees omitted), so this is not treated as zero-impact proof. The original task filter `replay-integrity` matched no test file; corrected the canonical filter to `verify-replay` to match `verify-replay.test.ts`. No browser-rendered page in this task; Chrome DevTools UI inspection is not applicable here. No dependency or cloud changes.
**Dependencies:** `P2-T17B`, `P2-T24`.
**Files:** `src/platform/web/src/features/spectator/{api.ts,replay-schema.ts,verify-replay.ts,verify-replay.test.ts}`, `src/platform/web/README.md`, `tasks/todo.md`
**Ước lượng:** M (4 file)

### [x] P2-T27 — Spectator replay player và presentation page

**Owner:** Đinh Đức Thuận
**Mô tả:** Tạo player chỉ đọc để BTC trình chiếu replay đã publish cho khán giả sau trận.
**Acceptance criteria:** (1) play/pause/seek event/speed 0.5x-1x-2x và replay end deterministic; (2) hiển thị đội/map/action/fault/result nhưng không có live socket/control; (3) responsive, keyboard/focus/screen-reader labels và tests dùng verified model từ `P2-T26`.
**Verification:** `npm test --workspace @ott/platform-web -- ReplayPlayer` (5/5 focused; full web 64/64); `npm run typecheck --workspace @ott/platform-web`; `npm run build --workspace @ott/platform-web`; root `npm test`, `npm run typecheck`, `npm run build` all pass. Vite HTTP smoke: public replay SPA route returned 200 and page module transformed. Build has no Node crypto externalization warning. Chrome DevTools MCP is unavailable in this session, so no real-browser screenshot/assertion was run. GitNexus compare-to-main reports CRITICAL across 16 flows because the shared `App` route entrypoint and newly indexed page/tests participate in application traces; direct `SpectatorReplayPage` and `createReplayTimeline` impact are LOW/exact. The reported paths include public replay fetch/schema/error handling plus existing leaderboard and App error paths; full web regression suite covers App shell, auth, leaderboard and replay admin, and a dedicated route test proves no auth request is started. One `engineVersion` test-fixture match is a graph naming collision, not a code path. Global flow inventory is incomplete: 75/275 candidate entry points and 351 callees were truncated, so absent flows are not considered unaffected.
**Dependencies:** `P2-T26`.
**Files:** `src/platform/web/src/features/spectator/replay-state.ts`, `src/platform/web/src/features/spectator/ReplayPlayer.tsx`, `src/platform/web/src/pages/SpectatorReplayPage.tsx`, `src/platform/web/src/features/spectator/ReplayPlayer.test.tsx`, `src/platform/web/src/app/App.tsx`, `src/platform/web/src/app/styles.css`, `src/platform/web/package.json` (direct type dependency on `@ott/game-core`). The browser player deliberately imports only game-core types: its Node-only hash implementation is not browser-compatible, as confirmed by the initial production build warning; runtime board frames are projected from verified recorded events instead.
**DOCS UPDATED:** `src/platform/web/README.md`, this task card, `tasks/plan.md`, `docs/team-assignment.md`.
**Ước lượng:** M (4 file)

### [x] P2-T28 — Qualification E2E harness và deterministic fixtures

**Owner:** Đinh Đức Thuận
**Mô tả:** Tạo một command chuẩn dựng local dependencies, migrate, seed canary và cleanup cô lập cho qualification E2E.
**Acceptance criteria:** (1) harness dùng PostgreSQL/Redis/SeaweedFS/Docker local với namespace riêng; (2) setup/teardown idempotent, không xóa dữ liệu ngoài namespace và không để active job/process; (3) command fail-fast nếu corpus/profile/dependency thiếu.
**Verification:** `npm run test:e2e:qualification -- --runInBand --testNamePattern harness` hai lần liên tiếp: mỗi lượt 4/4 pass; PostgreSQL/Redis/SeaweedFS healthy, áp dụng đủ migration `0001`–`0006`, seed đúng hai submission canary; project Compose, containers, volumes và network của lượt chạy được teardown. `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`, `bash -n scripts/run-local-qualification.sh` pass; default root Vitest excludes this environment-bound E2E test, while the dedicated config includes it. Shared local containers không bị đụng tới. GitNexus direct impact của fixture seeder là `UNKNOWN`/không có resolved callers; xác nhận invocation qua `qualification-run.ts` và shell script. detect-changes thấy 2 file nhưng không có indexed symbol overlap; không xem kết quả đó là all-clear vì E2E CLI/config chưa được GitNexus biểu diễn thành symbol.
**Dependencies:** `P2-T15`, `P2-T20`, `P2-T22`, `P2-T25`, `P2-T27`.
**Files:** `tests/e2e/qualification.config.ts`, `tests/e2e/qualification-fixtures.ts`, `tests/e2e/qualification-harness.test.ts`, `tests/e2e/qualification-run.ts`, `tests/e2e/helpers.ts`, `scripts/run-local-qualification.sh`, `vitest.config.ts`, `package.json`, `package-lock.json`.
**DOCS UPDATED:** `docs/runbooks/phase-2-local.md`, this task card, `tasks/plan.md`, `docs/team-assignment.md`.
**Ước lượng:** M (5 file)

### [x] P2-T29 — Qualification full-flow E2E và local handoff

**Owner:** Đinh Đức Thuận
**Mô tả:** Chứng minh toàn bộ Phase 2 local từ BTC provision đến spectator replay và ghi runbook vận hành tái lập.
**Acceptance criteria:** (1) BTC create team → team login → OCI upload/preflight → schedule/worker/finalize → series/rating/results; (2) BTC stage/publish → public replay player, tamper bị từ chối; (3) retry/restart không duplicate result/ledger/publication và runbook cho clean checkout tái lập được.
**Verification:** `npm run test:e2e:qualification` chạy cả harness và full flow: 2 test pass; hai đội được BTC provision/login, upload OCI canary thật (~19.5 MiB), worker sandbox preflight ACTION + idempotent activation, schedule/outbox → BullMQ worker → Docker sandbox/MatchRunner → finalize 2 game, settle series/Elo, results/leaderboard, BTC stage/publish và public replay client timeline. Tamper bị từ chối; repeat schedule/preflight/job/settlement/rating/publication không tạo duplicate result/ledger/event. Sau run, queue active/waiting/delayed/failed = 0; Compose containers/volumes/network được xóa. Root `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` và `bash -n scripts/run-local-qualification.sh` pass. E2E phát hiện và sửa bodyLimit upload OCI (19.5 MiB) cùng media-type normalization replay.
**Dependencies:** `P2-T19`–`P2-T28`.
**Files:** `tests/e2e/qualification.test.ts`, `src/platform/worker/src/preflight-submission.ts`, `src/platform/worker/src/index.ts`, `src/platform/api/src/modules/submissions/routes.ts`, `src/platform/web/src/features/spectator/verify-replay.ts`, `src/platform/web/src/features/spectator/verify-replay.test.ts`, `docs/contracts/oci-submission-v1.md`, `docs/contracts/spectator-replay-v1.md`, `docs/runbooks/phase-2-local.md`, this task card, `tasks/plan.md`, `docs/team-assignment.md`, `docs/ai-context/dinh-duc-thuan.md`.
**DOCS UPDATED:** OCI/replay contracts, Phase 2 local runbook, plan/status, assignment graph and Thuận AI context.
**Ước lượng:** M (4 file)

## Checkpoint P2-A — Backend local

- [x] `P2-T01`–`P2-T15` hoàn tất; API/worker tests pass với Docker services và OCI corpus benchmark.
- [x] Queue retry, sandbox, finalization idempotency và rating rebuild có automated evidence.
- [x] GitNexus `detect-changes` HIGH tại composition root đã được review cùng integration/mutation evidence; không còn CRITICAL chưa xử lý.

## Checkpoint P2-B — Phase 2 local hoàn tất

- [x] `P2-T17A`, `P2-T17B` và `P2-T18`–`P2-T29` hoàn tất; qualification E2E pass gồm BTC provision → team login → submission và replay publication/spectator flow.
- [x] Từ detached clean worktree của `404195f`, `npm ci`, build corpus, qualification E2E, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` và `bash -n scripts/run-local-qualification.sh` đều pass; OCI canary archives được build từ source bằng Docker, Compose harness dọn sạch resource. Root tests: 19 passed, 5 skipped (service-gated); web 65/65; các workspace khác đều xanh.
- [x] Runbook, env contract và artifact format local tái lập được; runbook ghi rõ build corpus archive bị ignore trước qualification; deploy cloud không thuộc phạm vi Phase 2 này.

## Phase 3 — Gate P3-0: decision và contract approval

> `P3-T01` đã duyệt requirement/ADR/contract ngày 14/10/2026. Task implementation chỉ hoàn tất sau acceptance/verification riêng; Wave 1 có thể bắt đầu trên branch task từ `main`.

### [x] P3-T01 — Khóa quyết định, ADR và contract Phase 3

**Owner:** Đinh Đức Thuận (decision/review only)
**Mô tả:** Duyệt D-14–D-30, giải quyết mâu thuẫn với nguồn đã khóa và xác nhận ranh giới hosted PoC/finals trước khi ba implementation lane bắt đầu.
**Acceptance criteria:** (1) mọi decision in-scope có giá trị cuối, trạng thái, ngày và người duyệt; (2) D-15/D-27, D-22, D-20/D-28 và D-23 được đồng bộ vào ADR/contract liên quan; (3) chốt replay private từ dữ liệu đầu tiên, finals 8 đội, configurable finite caps, game-adapter scoring và Ed25519/RFC 8785 `ResultBundle`.
**Verification:** D-14–D-30 không còn `CHỜ DUYỆT/HOÃN`; requirement ↔ ADR-0008–0010 ↔ contract v2/finals review không còn hai nghĩa; validator kiểm 118 Markdown links/fences, Phase 3 sync 25 task/8 checkpoint, `git diff --check`, root typecheck/build và GitNexus detect-changes (`risk: low`, không partial/truncated) pass ngày 14/10/2026. Root test: core/protocol/runner/API/web/corpus pass; lệnh tổng exit 1 tại worker integration vì Redis `127.0.0.1:16379` không chạy, không phải regression của docs.
**Dependencies:** Checkpoint `P2-B`.
**Files likely touched:** `docs/tai-lieu-yeu-cau.md`, `docs/decisions/`, `docs/contracts/bot-protocol-v2.md`, `docs/contracts/platform-auth-v2.md`, `docs/contracts/finals-result-bundle-v1.md`.
**Estimated scope:** M (documentation/decision gate; không implementation)
**DOCS UPDATED:** requirement v0.5.0, ADR-0008–0010, Protocol/Auth v2 design contract, Finals Format/ResultBundle v1, Phase 3 SA, plan/todo, assignment/AI contexts.

## Phase 3 — Wave 1: contract và foundation

### [ ] P3-L01 — Bot Protocol v2: time budget và private seed

**Owner:** Long Trần
**Mô tả:** Hiện thực Bot Protocol v2 đã duyệt để mỗi lượt mang time budget đã pin và mỗi bot chỉ nhận HMAC-derived `botSeed` riêng.
**Acceptance criteria:** (1) schema/types/fixtures v2 định nghĩa per-turn/remaining total budget, finite wall cap, opaque `matchId` và `botSeed` không lộ opponent/`engineSeed`; (2) v1 fixture vẫn validate bằng validator v1, v2 từ chối field/version sai; (3) compatibility guide nêu negotiation và lỗi tương thích.
**Verification:** `npm test --workspace @ott/bot-protocol`; `npm run typecheck --workspace @ott/bot-protocol`; contract fixture mutation phải fail.
**Dependencies:** `P3-T01`.
**Files likely touched:** `docs/contracts/bot-protocol-v2.md`, `docs/contracts/bot-protocol-v2.schema.json`, `src/bot-protocol/src/messages.ts`, `src/bot-protocol/src/validate.ts`, `src/bot-protocol/tests/schema-v2.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-D01 — RoundRuleSet và lifecycle round version hóa

**Owner:** Phạm Tất Đạt
**Mô tả:** Thêm persistence/service cho `RoundRuleSet` bất biến và state machine round tuần từ draft đến published.
**Acceptance criteria:** (1) mỗi save tạo version mới và round đã mở submission không sửa rule; (2) start idempotent, chỉ sau close, đóng băng submission/schedule snapshot và có audit; (3) pause/resume/publish tuân transition và Elo chỉ apply một lần sau terminal series.
**Verification:** `npm test --workspace @ott/platform-api -- round-rules`; PostgreSQL integration mutation transition/audit phải fail; `npm run typecheck --workspace @ott/platform-api`.
**Dependencies:** `P3-T01`.
**Files likely touched:** `src/platform/api/migrations/0007_round_rules.sql`, `src/platform/api/src/modules/rounds/types.ts`, `src/platform/api/src/modules/rounds/service.ts`, `src/platform/api/src/modules/rounds/routes.ts`, `src/platform/api/tests/rounds.integration.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-N01 — Resource profile, cgroup peak và Prometheus metrics

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Enforce resource profile theo round ở sandbox và ghi CPU/RAM peak từ cgroup v2 cho từng attempt.
**Acceptance criteria:** (1) memory/CPU/PID/tmpfs policy lấy từ job đã pin, không từ client; (2) vượt `memory.max` thành bot forfeit và `memory.peak` được lưu; (3) metrics không chứa source, credential hoặc raw stderr.
**Verification:** `npm test --workspace @ott/platform-worker -- sandbox`; corpus memory/fork/cpu pass; Prometheus scrape fixture và AC-16 assertion pass.
**Dependencies:** `P3-T01`.
**Files likely touched:** `src/platform/worker/src/sandbox/policy.ts`, `src/platform/worker/src/sandbox/oci-runtime.ts`, `src/platform/worker/src/metrics.ts`, `src/platform/worker/src/run-match-job.ts`, `src/platform/worker/tests/resource-metrics.integration.test.ts`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-A — Contract foundation

- [ ] `P3-L01`, `P3-D01`, `P3-N01` pass focused tests/typecheck/build.
- [ ] Protocol, round rules và resource profile đều version hóa/pin được; không còn decision ngầm trong code.
- [ ] Đinh Đức Thuận duyệt trước Wave 2.

## Phase 3 — Wave 2: runtime và vận hành round

### [ ] P3-L02 — Chess-clock/dynamic timing trong MatchRunner và replay

**Owner:** Long Trần
**Mô tả:** Thực thi per-turn limit, tổng thời gian mỗi bot và wall-clock cap theo Protocol v2, đồng thời ghi timing decision vào event log/replay.
**Acceptance criteria:** (1) `Dynamic` deterministic theo turn và total budget dùng monotonic clock; (2) exhausted budget áp dụng đúng timeout/forfeit policy; (3) cùng transcript/rule set cho cùng timing events và replay verification.
**Verification:** `npm test --workspace @ott/match-runner -- timing`; fake-clock boundary/mutation tests pass; `npm run typecheck --workspace @ott/match-runner`.
**Dependencies:** `P3-L01`, `P3-D01`, `P3-N01`.
**Files likely touched:** `src/match-runner/src/timing-policy.ts`, `src/match-runner/src/match-runner.ts`, `src/match-runner/src/event-log.ts`, `src/match-runner/src/replay.ts`, `src/match-runner/tests/timing-policy.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-N02 — Priority queue, worker heartbeat/capacity và pause/resume

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Điều phối official → preflight → test run trên một server lab, có lease/heartbeat, adaptive concurrency mặc định tối đa 4 game và pause nhận job mới.
**Acceptance criteria:** (1) mức thấp không chạy khi official đang chờ và admission tự giảm theo CPU/RAM; (2) worker mất heartbeat/restart làm attempt retryable, không duplicate result; (3) pause không hủy job đang chạy và resume giữ thứ tự deterministic/audit.
**Verification:** `npm test --workspace @ott/platform-worker -- worker-pool`; Redis/PostgreSQL integration mô phỏng mất worker/restart; queue active/waiting/failed trở về trạng thái mong đợi.
**Dependencies:** `P3-D01`, `P3-N01`.
**Files likely touched:** `src/platform/job-contract/src/queue-names.ts`, `src/platform/api/src/queue/match-queue.ts`, `src/platform/worker/src/worker-pool.ts`, `src/platform/worker/src/worker.ts`, `src/platform/worker/tests/worker-pool.integration.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-D02 — Admin round-rule và operations console

**Owner:** Phạm Tất Đạt
**Mô tả:** Cung cấp UI BTC để version/lock rule set, ước tính thời lượng và thực hiện open/close/start/pause/resume/publish có confirmation.
**Acceptance criteria:** (1) form phủ timing/resource/game/schedule/test-run fields và hiển thị worst-case estimate; (2) locked/running rule read-only, invalid transition bị server từ chối và UI reconcile; (3) start có two-step confirmation, reason và duplicate-click safety.
**Verification:** `npm test --workspace @ott/platform-web -- RoundAdmin`; `npm run typecheck --workspace @ott/platform-web`; browser smoke desktop/mobile và keyboard labels.
**Dependencies:** `P3-D01`.
**Files likely touched:** `src/platform/web/src/features/round-admin/api.ts`, `src/platform/web/src/features/round-admin/RoundRuleForm.tsx`, `src/platform/web/src/features/round-admin/RoundOperations.tsx`, `src/platform/web/src/features/round-admin/round-admin.test.tsx`, `src/platform/web/src/app/routes.tsx`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-B — Round có thể khóa và chạy

- [ ] Protocol v2 game dùng đúng frozen `RoundRuleSet`; AC-17/18 focused tests pass.
- [ ] Pause/resume và mất worker không làm duplicate job/result.
- [ ] Đinh Đức Thuận duyệt trước Wave 3.

## Phase 3 — Wave 3: submission và test run ở quy mô lớn

### [ ] P3-D03 — Hash reservation, upload throttling và preflight visibility

**Owner:** Phạm Tất Đạt
**Mô tả:** Thêm one-click client hashing/reservation, grace-window upload và backpressure/queue position cho submission.
**Acceptance criteria:** (1) reservation trước deadline chỉ chấp nhận đúng SHA-256 trong grace window; (2) global/per-team concurrency trả retry-after thay vì treo; (3) portal hiển thị progress/preflight position và retry cùng file idempotent.
**Verification:** API+web focused suites; AC-15 burst test với clock giả; wrong-hash/late/no-reservation mutations bị từ chối.
**Dependencies:** `P3-D01`, `P3-N02`.
**Files likely touched:** `src/platform/api/migrations/0008_submission_reservations.sql`, `src/platform/api/src/modules/submissions/reservations.ts`, `src/platform/api/src/modules/submissions/routes.ts`, `src/platform/web/src/features/submissions/SubmissionForm.tsx`, `src/platform/api/tests/submission-reservations.integration.test.ts`.
**Estimated scope:** M (5 files)

### [x] P3-D04 — CSV team provisioning và credential file tải một lần

**Owner:** Phạm Tất Đạt
**Mô tả:** Import danh sách đội đã duyệt và stream file credential plaintext đúng một lần mà không persist nội dung.
**Acceptance criteria:** (1) validate CSV/email trường/uniqueness atomically với error theo dòng; (2) password chỉ tồn tại trong response stream, DB giữ hash và audit chỉ ghi count/actor; (3) retry không phát lại credential cũ, hỗ trợ bulk reset tạo file mới.
**Verification:** `npm test --workspace @ott/platform-api -- bulk-teams`; log/audit/storage secret scan; download-once concurrency test và malformed CSV tests.
**Dependencies:** `P3-T01`.
**Files likely touched:** `src/platform/api/src/modules/teams/bulk.ts`, `src/platform/api/src/modules/teams/routes.ts`, `src/platform/api/tests/teams-bulk.integration.test.ts`, `src/platform/web/src/features/admin-teams/BulkProvision.tsx`, `src/platform/web/src/features/admin-teams/BulkProvision.test.tsx`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-14 — `POST /api/v1/admin/teams/bulk-import` nhận CSV `team_name,representative_email` (RFC 4180, BOM/CRLF, 1–500 dòng), validate toàn bộ và trả lỗi theo dòng/cột không echo giá trị; trùng tên/email trong file và với DB bị từ chối nguyên khối; credential sinh và stream một lần trong response `text/csv` (`no-store`, attachment, chống formula injection), DB chỉ giữ argon2 hash, audit chỉ ghi actor/`count=N`. `POST /api/v1/admin/teams/bulk-reset` theo `teamIds` tạo file mới và revoke session cũ. Theo quyết định của Đạt (14/10/2026), migration `0008_team_representative_email.sql` lưu email người đại diện (lowercase, unique, nullable, chỉ BTC thấy). UI BTC: nhập CSV, chọn đội để cấp lại hàng loạt, file tải trực tiếp không hiển thị mật khẩu. `bulk-teams` 34/34 pass trên PostgreSQL 16.6 + Redis (8 integration chạy thật), platform-api 74 pass/2 env-skip, platform-web 72 pass, typecheck sạch; mutation ghi mật khẩu vào audit và bỏ revoke session đều làm test fail. Hạn chế: retry trùng username trong transaction không dùng SAVEPOINT (xác suất trùng ~2^-32).

### [ ] P3-N03 — Test-run quota, opponent policy và private artifacts

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo flow test run ưu tiên thấp, chỉ đấu bot tham chiếu hoặc submission khác cùng đội, không ảnh hưởng Elo.
**Acceptance criteria:** (1) quota tính khi start và hoàn lại cho infra failure; (2) test run đứng chờ khi official round chạy và không nhận bot đội khác; (3) result/replay/truncated stderr chỉ owner team/BTC đọc được.
**Verification:** API/worker integration và AC-21 pass; RBAC tests cross-team/anonymous; rating ledger không đổi sau test run.
**Dependencies:** `P3-D01`, `P3-L02`, `P3-N02`.
**Files likely touched:** `src/platform/api/migrations/0009_test_runs.sql`, `src/platform/api/src/modules/test-runs/service.ts`, `src/platform/api/src/modules/test-runs/routes.ts`, `src/platform/worker/src/run-test-job.ts`, `src/platform/worker/tests/test-run.integration.test.ts`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-C — Participant workflows

- [ ] AC-15 và AC-21 pass; overload có backpressure rõ ràng.
- [ ] Credential plaintext không persist/log; test run không ảnh hưởng Elo hoặc lộ dữ liệu đội khác.
- [ ] Đinh Đức Thuận duyệt trước Wave 4.

## Phase 3 — Wave 4: OCI lifecycle, ranking và replay privacy

### [ ] P3-N04 — OCI layer dedup, retention, base image và duplicate flag

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Quản lý layer theo digest, retention policy và official base images; flag submission trùng hệt mà không tự kết luận gian lận.
**Acceptance criteria:** (1) shared layers lưu một bản và garbage collection không xóa artifact đã pin/ACTIVE/3 bản gần nhất; (2) base image/starter kit build reproducible, digest và hướng dẫn/FAQ được công bố; (3) manifest/config/non-base layer duplicate tạo review flag/audit cho BTC.
**Verification:** storage integration/reference-count race tests; AC-22 pass; dry-run retention report khớp fixture trước delete.
**Dependencies:** `P3-D03`.
**Files likely touched:** `src/platform/api/migrations/0010_oci_layers.sql`, `src/platform/api/src/modules/submissions/layers.ts`, `src/platform/worker/src/artifacts.ts`, `src/bots/starter-kits/`, `src/platform/api/tests/oci-retention.integration.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-L03 — Qualification gate, adaptive K và minimum-series eligibility

**Owner:** Long Trần
**Mô tả:** Thực thi capture-first gate, K=64 cho 5 series đầu rồi K=32 và nhãn chưa đủ điều kiện finals.
**Acceptance criteria:** (1) submission cần ≥1 điểm/2 game đổi phía với gate bot đã pin; (2) rating rebuild cho kết quả giống incremental apply với adaptive K; (3) dưới minimum series không vào finals eligibility nhưng vẫn hiện leaderboard có nhãn.
**Verification:** `npm test --workspace @ott/platform-api -- ratings`; property/rebuild/mutation tests; gate fixture hai phía pass/fail deterministic.
**Dependencies:** `P3-T01`, `P3-D01`.
**Files likely touched:** `src/platform/api/src/modules/ratings/elo.ts`, `src/platform/api/src/modules/ratings/service.ts`, `src/platform/api/src/modules/scheduling/eligibility.ts`, `src/platform/api/tests/ratings-v2.test.ts`, `src/platform/api/tests/qualification-gate.integration.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-D05 — Qualification replay authorization từ dữ liệu đầu tiên

**Owner:** Phạm Tất Đạt
**Mô tả:** Áp dụng team-private qualification replay từ record đầu tiên và giới hạn anonymous public replay cho finals đã publish; dự án chưa có dữ liệu public cũ cần migration.
**Acceptance criteria:** (1) hai team trong match và BTC đọc qualification replay sau integrity; (2) anonymous chỉ đọc finals replay `PUBLISHED`; (3) policy được enforce server-side ngay khi tạo/publish record và không lộ seed/object key.
**Verification:** `npm test --workspace @ott/platform-api -- replays`; cross-team/anonymous/stage matrix; mutation bỏ stage guard phải fail.
**Dependencies:** `P3-T01`, `P3-D01`.
**Files likely touched:** `src/platform/api/migrations/0011_replay_visibility.sql`, `src/platform/api/src/modules/replays/service.ts`, `src/platform/api/src/modules/replays/routes.ts`, `src/platform/api/tests/replay-authorization.integration.test.ts`, `docs/contracts/spectator-replay-v2.md`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-D — Fairness và data policy

- [ ] AC-22 pass; rating ledger rebuild deterministic với policy đã duyệt.
- [ ] Anonymous không đọc được qualification replay kể cả biết `matchId`.
- [ ] Đinh Đức Thuận duyệt trước Wave 5.

## Phase 3 — Wave 5: public experience và authentication hardening

### [ ] P3-L04 — Replay move list, seek và historical-version compatibility

**Owner:** Long Trần
**Mô tả:** Bổ sung danh sách nước đi đồng bộ player và adapter đọc replay theo engine/protocol/rule version cũ.
**Acceptance criteria:** (1) click move seek đúng event/snapshot và keyboard/screen-reader dùng được; (2) unsupported/tampered version fail trước render; (3) replay v1/v2 fixtures cũ vẫn dựng đúng kết quả, không dùng luật mới để tính lại.
**Verification:** `npm test --workspace @ott/platform-web -- ReplayPlayer`; compatibility fixtures và checksum mutation pass; production build không kéo Node-only runtime.
**Dependencies:** `P3-L02`, `P3-D05`.
**Files likely touched:** `src/platform/web/src/features/spectator/replay-schema.ts`, `src/platform/web/src/features/spectator/replay-state.ts`, `src/platform/web/src/features/spectator/MoveList.tsx`, `src/platform/web/src/features/spectator/ReplayPlayer.tsx`, `src/platform/web/src/features/spectator/ReplayPlayer.test.tsx`.
**Estimated scope:** M (5 files)

### [ ] P3-L05 — Static public snapshots, queue/results/rules/status site

**Owner:** Long Trần
**Mô tả:** Xuất và hiển thị last-known-good static snapshot cho round, queue order/ETA, results, leaderboard, current rules, announcements và stale state.
**Acceptance criteria:** (1) public site chỉ đọc versioned/checksummed files và polling cache, không gọi DB/worker/control write API; (2) qualification không có replay link, finals có sau sync, đồng thời có lịch/rules/FAQ/announcement/status; (3) snapshot cũ vẫn phục vụ kèm updated-at/stale warning và ETA sự cố khi publisher lỗi.
**Verification:** static publisher tests + `npm test --workspace @ott/platform-web -- public-site`; network contract assertion không có execution endpoint; load test artifact dùng cho AC-14.
**Dependencies:** `P3-D01`, `P3-N02`, `P3-L03`, `P3-D05`.
**Files likely touched:** `src/platform/api/src/modules/public-snapshots/publisher.ts`, `src/platform/web/src/features/public/PublicTournamentPage.tsx`, `src/platform/web/src/features/public/RulesPage.tsx`, `src/platform/web/src/features/public/public-site.test.tsx`, `docs/contracts/public-snapshot-v1.md`.
**Estimated scope:** M (5 files)

### [ ] P3-D06 — TOTP, admin network allowlist và hosted startup guard

**Owner:** Phạm Tất Đạt
**Mô tả:** Hardening authentication/admin ingress có cấu hình dev/test và fail-closed ở hosted PoC/production, kèm rate/security headers.
**Acceptance criteria:** (1) BTC login hỗ trợ TOTP/recovery code, secret mã hóa và không log; (2) admin API kiểm tra trusted proxy/network allowlist server-side; (3) hosted/production từ chối start khi TOTP tắt/allowlist rỗng, dev/test vẫn chạy password-only theo cấu hình.
**Verification:** auth integration, known test TOTP và recovery replay tests; AC-23 pass; header/rate-limit/proxy spoof tests pass.
**Dependencies:** `P3-T01`, `P3-D04`.
**Files likely touched:** `src/platform/api/migrations/0012_admin_mfa.sql`, `src/platform/api/src/modules/auth/totp.ts`, `src/platform/api/src/modules/auth/plugin.ts`, `src/platform/api/src/config/security.ts`, `src/platform/api/tests/auth-hardening.integration.test.ts`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-E — Public/security boundary

- [ ] AC-14/17/18/23 focused evidence pass; static public traffic không chạm execution plane.
- [ ] Replay compatibility và auth production guard được mutation-test.
- [ ] Đinh Đức Thuận duyệt trước Wave 6.

## Phase 3 — Wave 6: operations readiness

### [ ] P3-N05 — Metrics/alerts, backup-restore và incident runbooks

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Hoàn thiện quan sát hệ thống và quy trình phục hồi/ứng phó cho control plane, queue, storage và worker pool.
**Acceptance criteria:** (1) dashboard/alerts phủ queue age, heartbeat, infra failure, finalize stuck, sandbox resource; (2) backup ngoài máy và restore sang laptop khác giữ checksum/audit; (3) incident/OWASP checklist có owner/action cho pause upload, read-only public mode, secret rotation và thông báo sự cố.
**Verification:** alert fixture tests; restore drill script trên namespace cô lập; dependency/secret scan, OWASP self-assessment và runbook tabletop checklist được Thuận ký.
**Dependencies:** `P3-N01`, `P3-N02`, `P3-D06`.
**Files likely touched:** `ops/prometheus/rules.yml`, `ops/grafana/dashboards/tournament.json`, `scripts/backup-local.sh`, `scripts/restore-local.sh`, `docs/runbooks/production-operations.md`.
**Estimated scope:** M (5 files)

### [ ] P3-D07 — Privileged operations, anti-cheat review và appeal workflow

**Owner:** Phạm Tất Đạt
**Mô tả:** Hoàn thiện thao tác BTC còn thiếu: revoke/suspend, retry/cancel lỗi hạ tầng, review anomaly/duplicate và xử lý khiếu nại mà không sửa lịch sử.
**Acceptance criteria:** (1) mọi privileged action có RBAC, reason, correlation ID và append-only before/after audit; (2) rerun chỉ cho infra failure, không duplicate result/Elo, queue override được công khai; (3) anomaly/duplicate/appeal case có evidence/status/decision, round hash được công bố và lịch sử không bị xóa.
**Verification:** `npm test --workspace @ott/platform-api -- operations`; unauthorized/invalid-rerun/audit immutability mutations fail; export audit/case fixtures không chứa seed, credential hoặc private stderr.
**Dependencies:** `P3-D01`, `P3-N02`, `P3-N04`.
**Files likely touched:** `src/platform/api/migrations/0013_operations_cases.sql`, `src/platform/api/src/modules/operations/service.ts`, `src/platform/api/src/modules/operations/routes.ts`, `src/platform/api/tests/operations.integration.test.ts`, `src/platform/web/src/features/operations/OperationsConsole.tsx`.
**Estimated scope:** M (5 files)

### [ ] P3-N06 — Single-server smoke/load và pilot qualification round

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Chạy smoke/load mức vừa trên đúng server lab và một pilot round để chứng minh hosted PoC hoạt động, không tuyên bố production scale.
**Acceptance criteria:** (1) fixture ~200 đội, ~100 session, 4 game adaptive, ~1.000 public clients qua CDN/static và burst 50 upload/reservation có evidence; (2) overload có queue position/`Retry-After`, ưu tiên thấp bị hoãn, không mất submission/result; (3) restart worker/server + restore/retry không duplicate result/Elo và report ghi capacity/bottleneck thật.
**Verification:** signed run report kèm commit/config/host inventory; DB/result/ledger integrity queries; root `npm test`, `npm run typecheck`, `npm run build` từ clean checkout.
**Dependencies:** `P3-N03`, `P3-N04`, `P3-L03`, `P3-L04`, `P3-L05`, `P3-D06`, `P3-D07`, `P3-N05`.
**Files likely touched:** `tests/load/qualification-round.ts`, `tests/e2e/worker-recovery.test.ts`, `scripts/run-lab-server-pilot.sh`, `docs/reports/phase-3-capacity.md`, `docs/runbooks/hosted-poc-operations.md`.
**Estimated scope:** M (5 files plus external test evidence)

## [ ] Checkpoint P3-2B — Qualification hosted PoC-ready

- [ ] AC-13–AC-19 và AC-21–AC-23 pass hoặc có biên bản BTC duyệt.
- [ ] D-08/D-26 có report số đo server lab; pilot round, backup/restore và restart recovery drill hoàn tất.
- [ ] Đinh Đức Thuận duyệt trước mọi finals implementation.

## Phase 3 — Wave 7: finals domain và LAN control plane

### [ ] P3-L06 — Finals 8-team bracket/BO3/game-adapter scoring

**Owner:** Long Trần
**Mô tả:** Hiện thực Finals Format v1: 8 unique seed, no-group single-elimination BO3, optional bronze, map/side policy và versioned game-adapter score breakdown.
**Acceptance criteria:** (1) cùng locked ranking/seed/config tạo cùng bracket `1–8/4–5/2–7/3–6`; (2) side swap, map non-repeat, adapter criteria và qualification-seed fallback theo contract; (3) finalized result mới advance bracket và override có audit evidence.
**Verification:** property tests cho bracket/schedule/scoring; AC-09 fixture pass; mutation tie-break/seed/side swap/adapter version phải fail.
**Dependencies:** `P3-T01`, Checkpoint `P3-2B`, `P3-L03`.
**Files likely touched:** `src/platform/api/src/modules/finals/seeding.ts`, `src/platform/api/src/modules/finals/scheduling.ts`, `src/platform/api/src/modules/finals/scoring.ts`, `src/platform/api/tests/finals-domain.test.ts`, `docs/contracts/finals-format-v1.md`.
**Estimated scope:** M (5 files)

### [ ] P3-D08 — Finals control plane, seeding và LAN submission cutoff

**Owner:** Phạm Tất Đạt
**Mô tả:** Thêm model/API cho finals rule set, group/series, LAN submission window và pin artifact trước giải.
**Acceptance criteria:** (1) chỉ eligible locked ranking được seed; (2) finals submission qua LAN vẫn preflight và fallback qualification ACTIVE chỉ khi tương thích; (3) close cutoff pin artifact/rules/map pool, retry idempotent và audit đầy đủ.
**Verification:** PostgreSQL/API integration cho seed/cutoff/RBAC; incompatible/finalized mutation rejected; `npm run typecheck --workspace @ott/platform-api`.
**Dependencies:** `P3-L06`, `P3-D01`, `P3-D03`.
**Files likely touched:** `src/platform/api/migrations/0014_finals.sql`, `src/platform/api/src/modules/finals/service.ts`, `src/platform/api/src/modules/finals/routes.ts`, `src/platform/api/tests/finals.integration.test.ts`, `docs/contracts/finals-api-v1.md`.
**Estimated scope:** M (5 files)

### [ ] P3-N07 — Isolated LAN deployment và single-server local recovery

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Đóng gói topology finals không Internet trên server lab, tách participant/audience network và có backup/restore/control-plane recovery tại chỗ.
**Acceptance criteria:** (1) LAN stack chạy không Internet, worker không accessible từ máy đội; (2) restart/rejoin dùng heartbeat/capacity và ngừng admission an toàn; (3) local DB/artifact restore và rerun infra failure không duplicate result.
**Verification:** network isolation tests; restart/recovery drill; restore checksum/result integrity report và no-egress evidence.
**Dependencies:** `P3-D08`, `P3-N05`.
**Files likely touched:** `deploy/lan/compose.yml`, `deploy/lan/.env.example`, `scripts/lan-smoke.sh`, `tests/e2e/lan-recovery.test.ts`, `docs/runbooks/finals-lan.md`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-F1 — Finals chạy hoàn toàn trong LAN

- [ ] Finals submission/rules/schedule được pin và deterministic.
- [ ] Network isolation, restart/recovery và local restore drill pass.
- [ ] Đinh Đức Thuận duyệt trước result synchronization.

## Phase 3 — Wave 8: result sync và trình diễn

### [ ] P3-D09 — Signed ResultBundle export/import idempotent

**Owner:** Phạm Tất Đạt
**Mô tả:** Xuất bracket/results/event logs với RFC 8785 manifest, SHA-256 và Ed25519; online import theo all-or-nothing versioned transaction.
**Acceptance criteria:** (1) exporter ký canonical manifest bằng private key chỉ ở offline/finals, online giữ allowlisted public key; (2) importer verify signature/checksum/completeness và từ chối toàn bundle nếu một byte sai; (3) same bundle idempotent, corrected bundle cần version/reason/audit mới và public proof metadata có `VERIFIED`.
**Verification:** API integration và AC-20 valid/tamper/wrong-key/missing-file tests; test-key fixture; no partial publication query.
**Dependencies:** `P3-D08`, `P3-N07`.
**Files likely touched:** `src/platform/api/migrations/0015_result_bundles.sql`, `src/platform/api/src/modules/result-bundles/exporter.ts`, `src/platform/api/src/modules/result-bundles/importer.ts`, `src/platform/api/src/modules/result-bundles/routes.ts`, `src/platform/api/tests/result-bundles.integration.test.ts`.
**Estimated scope:** M (5 files)

### [ ] P3-D10 — Finals bracket, schedule/results và verified replay public UI

**Owner:** Phạm Tất Đạt
**Mô tả:** Hiển thị snapshot online sau import cho bracket, schedule/result, proof metadata và replay finals đã publish.
**Acceptance criteria:** (1) UI giữ nguyên bracket/score breakdown từ server, không tự tính winner/advancement; (2) bundle/key/checksum/version/imported-at/`VERIFIED` và stale state rõ ràng; (3) replay chỉ xuất hiện sau verified import và publication, responsive/accessibility states đủ.
**Verification:** `npm test --workspace @ott/platform-web -- Finals`; static bundle fixtures/tamper state; browser smoke desktop/mobile/keyboard.
**Dependencies:** `P3-D09`, `P3-L05`, `P3-L06`.
**Files likely touched:** `src/platform/web/src/features/finals/api.ts`, `src/platform/web/src/features/finals/GroupStandings.tsx`, `src/platform/web/src/features/finals/FinalsSchedule.tsx`, `src/platform/web/src/features/finals/finals.test.tsx`, `src/platform/web/src/app/routes.tsx`.
**Estimated scope:** M (5 files)

### [ ] P3-N08 — Full event rehearsal, tamper/recovery và handoff

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Diễn tập toàn sự kiện từ finals cutoff trong LAN đến signed sync/public replay và bàn giao runbook/checklist.
**Acceptance criteria:** (1) AC-09/20 pass end-to-end; (2) worker/server restart, control-plane restore và tampered bundle đều có expected recovery/no-publication; (3) cleanup, operator roles, keys, rollback và communication checklist được xác nhận.
**Verification:** `npm run test:e2e:finals`; root test/typecheck/build/security scan từ clean checkout; rehearsal report có commit, config hashes và Thuận sign-off.
**Dependencies:** `P3-D09`, `P3-D10`, `P3-N07`.
**Files likely touched:** `tests/e2e/finals.test.ts`, `tests/e2e/finals.config.ts`, `scripts/run-finals-rehearsal.sh`, `docs/runbooks/finals-lan.md`, `docs/reports/finals-rehearsal.md`.
**Estimated scope:** M (5 files)

## [ ] Checkpoint P3-F — Phase 3 hoàn tất

- [ ] AC-09 và AC-20 pass; full LAN → signed bundle → online publication rehearsal hoàn tất.
- [ ] Tất cả task acceptance/verification/docs sync xong; GitNexus change review không còn HIGH/CRITICAL chưa xử lý.
- [ ] Đinh Đức Thuận duyệt. Không deploy nếu chưa có yêu cầu riêng.
