# Task Checklist: Phase 1–3

**Trạng thái tại `main` ngày 2026-10-20:** Phase 1 đã đóng; Phase 2 local `P2-T01`–`P2-T29` đã đóng nhưng extension `P2-T30`–`P2-T37` và Checkpoint `P2-C` còn mở. `P2-T38` là yêu cầu dữ liệu mẫu mới, đang ở task branch. Phase 3 có 25/25 task được tick; cả 8 checkpoint vẫn chờ Thuận nghiệm thu.
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

> **Rà soát 2026-10-20:** `npm run typecheck`, `npm run build` và `npm run test:e2e:finals` (14/14 test) pass tại `5e6994d`. `npm test` chưa pass toàn bộ: BullMQ integration của worker timeout vì Redis `127.0.0.1:16379` từ chối kết nối; API có 447 pass/145 skip, worker có 162 pass/22 skip và 1 suite lỗi, web có 391/391 pass. Đây là bằng chứng local/test harness, chưa phải xác nhận stack LAN/server lab chạy xuyên suốt hay chữ ký phê duyệt checkpoint. Tình trạng chi tiết và dependency nằm ở các card dưới đây.

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

> Các task `P2-T30`–`P2-T37` (runtime extension) được phát hành lại từ nhánh `thuandd/docs-p2-t30-local-runtime-plan` (13/10/2026) vì repo chưa có entrypoint API/worker, health endpoint, Dockerfile hay coordinator; xem Checkpoint P2-C.

### [ ] P2-T30 — API runtime host và health lifecycle

**Owner:** Đinh Đức Thuận
**Mô tả:** Biến Fastify composition hiện có thành một service chạy lâu dài từ clean checkout, tự wire PostgreSQL, Redis và S3-compatible storage bằng environment mà không thay đổi contract/routes hiện tại.
**Acceptance criteria:** (1) executable entrypoint validate đầy đủ environment, bootstrap BTC idempotent và listen trên host/port cấu hình được; (2) readiness chỉ xanh sau khi dependency/app sẵn sàng, liveness không tiết lộ credential hoặc internals; (3) `SIGTERM`/`SIGINT` ngừng nhận request rồi đóng Fastify, Redis, PostgreSQL và S3 client sạch.
**Verification:** focused runtime tests cho missing/invalid env, dependency wiring, health và shutdown; API integration trên disposable services; `npm run typecheck`, `npm test`, `npm run build`.
**Dependencies:** `P2-T29`.
**Files dự kiến:** `src/platform/api/src/server.ts`, `src/platform/api/tests/server.test.ts`, `src/platform/api/package.json`, `src/platform/api/README.md`, `.env.example`.
**Ước lượng:** M (5 file)
**Trạng thái 2026-10-18:** đã implement bởi Phạm Tất Đạt (theo quyết định dự án, owner/reviewer Thuận) trên `datpt/feat-p3-d30-api-runtime-host` (`7a98716`): `src/platform/api/src/{main.ts,runtime/*}`, `npm run start:api`; runtime unit tests + integration thật (PostgreSQL/Redis/S3) 7/7 ×3 do Reviewer chạy. **Cập nhật 2026-10-20:** source và script đã có trên `main`; card vẫn chưa tick, cần Thuận đối chiếu acceptance/root gates trên clean checkout. Câu “chưa merge” ở snapshot 18/10 không còn áp dụng.

### [ ] P2-T31 — Worker runtime host và graceful shutdown

**Owner:** Đinh Đức Thuận
**Mô tả:** Cung cấp process entrypoint chính thức cho BullMQ worker, wire `runMatchJob` với PostgreSQL/S3 và quản lý vòng đời Docker-backed execution plane.
**Acceptance criteria:** (1) executable entrypoint validate environment rồi khởi động đúng một worker queue; (2) chỉ trusted worker nhận Docker socket, bot containers vẫn no-network/no-mount/no-socket theo sandbox policy; (3) signal handling dừng nhận job, chờ active job trong giới hạn và đóng DB/Redis/S3 idempotent.
**Verification:** focused runtime tests cho env/start/stop/failure; BullMQ integration và sandbox/finalization regression trên disposable services; root typecheck/test/build.
**Dependencies:** `P2-T29`.
**Files dự kiến:** `src/platform/worker/src/main.ts`, `src/platform/worker/tests/main.test.ts`, `src/platform/worker/package.json`, `src/platform/worker/README.md`.
**Ước lượng:** M (4 file)
**Trạng thái 2026-10-18:** đang implement bởi Phạm Tất Đạt trên `datpt/feat-p3-d32-worker-runtime-host` (review đang chạy). Không đổi contract: test run được định tuyến bằng tra cứu `test_runs` theo `job.matchId`. **Cập nhật 2026-10-20:** `src/platform/worker/src/main.ts` đã có trên `main` (commit `429ddfd` trong lịch sử); card chưa tick vì BullMQ integration/root test hiện bị chặn tại Redis `127.0.0.1:16379` và cần review acceptance riêng.

### [ ] P2-T32 — Local lifecycle coordinator

**Owner:** Đinh Đức Thuận
**Mô tả:** Ghép các service API hiện có thành vòng đời vận hành local: preflight submission, explicit qualification-round start, outbox dispatch, series settlement và Elo application; không thêm live-match control.
**Acceptance criteria:** (1) submission `PREFLIGHT` được xử lý và active/reject bằng worker sandbox, BTC có command tường minh để mở một round; (2) outbox được dispatch, series/rating được settle sau terminal matches, retry/restart không tạo duplicate; (3) lỗi hạ tầng giữ retryable semantics và không bị tính thành bot loss.
**Verification:** coordinator unit/integration tests trên disposable PostgreSQL/Redis/S3/Docker; restart/idempotency test; qualification flow regression; root typecheck/test/build.
**Dependencies:** `P2-T30`, `P2-T31`.
**Files dự kiến:** `src/platform/worker/src/coordinator.ts`, `src/platform/worker/src/coordinator-main.ts`, `src/platform/worker/tests/coordinator.integration.test.ts`, `src/platform/worker/package.json`, `src/platform/worker/README.md`.
**Ước lượng:** M (5 file)

### [ ] P2-T33 — Production-style local Docker images

**Owner:** Đinh Đức Thuận
**Mô tả:** Tạo multi-stage images cho API, worker/coordinator và React web gateway từ committed lockfile; web gateway serve SPA và proxy same-origin `/api/v1` sang API.
**Acceptance criteria:** (1) images build reproducibly trên Node.js 22 và chỉ chứa runtime artifacts cần thiết; (2) API/web chạy non-root, không chứa `.env`, local account CSV hay build credentials; (3) gateway có SPA fallback, `/api/v1` proxy, upload body limit phù hợp OCI contract và security headers cơ bản.
**Verification:** build cả images không dùng untracked launcher; inspect image config/layers cho secret-sensitive paths; container smoke cho static route và proxied health/API; `npm audit` triage trên committed lockfile.
**Dependencies:** `P2-T30`, `P2-T31`.
**Files dự kiến:** `.dockerignore`, `infra/docker/api.Dockerfile`, `infra/docker/worker.Dockerfile`, `infra/docker/web.Dockerfile`, `infra/docker/nginx.conf`.
**Ước lượng:** M (5 file)

### [ ] P2-T34 — Full-stack local Compose wiring

**Owner:** Đinh Đức Thuận
**Mô tả:** Mở rộng local deployment thành một Compose stack gồm migration one-shot, API, worker, coordinator và web gateway bên cạnh PostgreSQL/Redis/SeaweedFS.
**Acceptance criteria:** (1) dependency health/migration ordering deterministic và service-to-service URL dùng Compose DNS; (2) chỉ web gateway bind `0.0.0.0:${APP_PORT}`, DB/cache/S3/API/Docker socket không public ra LAN; (3) worker là service duy nhất mount Docker socket và có quyền tối thiểu cần thiết, restart policy không tạo duplicate processing.
**Verification:** `docker compose config`, fresh-volume `up --build --wait`, health/status/log inspection, API-through-gateway smoke, controlled restart và `down -v` cleanup trên đúng project.
**Dependencies:** `P2-T32`, `P2-T33`.
**Files dự kiến:** `infra/local/compose.yaml`, `infra/local/compose.test.sh`, `.env.example`, `docs/runbooks/local-services.md`.
**Ước lượng:** M (4 file)

### [ ] P2-T35 — Demo-only accounts và local credential CSV

**Owner:** Đinh Đức Thuận
**Mô tả:** Thêm seeder idempotent chỉ hoạt động khi `OTT_DEMO_MODE=true`, tạo `btc`, `team01`, `team02` với public demo password `ABC123`, hash bằng Argon2id và sinh CSV để BTC dùng khi demo.
**Acceptance criteria:** (1) seeder từ chối chạy nếu không có demo-mode flag hoặc nếu environment là production; (2) database chỉ lưu password hash, CSV được ghi tại `.local/demo/accounts.csv` với mode `0600`, không log password và bị gitignore; (3) chạy lại không nhân đôi team/account, không đổi production provisioning/reset flow vốn vẫn sinh credential ngẫu nhiên.
**Verification:** tests cho mode guard, exact three accounts, role/team binding, Argon2 login và idempotency; filesystem permission/git-ignore check; staged-diff secret scan xác nhận CSV sinh ra không được track.
**Dependencies:** `P2-T30`, `P2-T34`.
**Files dự kiến:** `src/platform/api/src/demo/seed-accounts.ts`, `src/platform/api/tests/demo-accounts.integration.test.ts`, `.gitignore`, `docs/runbooks/local-demo.md`.
**Ước lượng:** M (4 file)

### [ ] P2-T36 — One-command local demo operations

**Owner:** Đinh Đức Thuận
**Mô tả:** Cung cấp một script có subcommand để build/start/status/accounts/logs/round/stop/reset toàn bộ stack mà không phụ thuộc các launcher `/tmp`.
**Acceptance criteria:** (1) `up` thực hiện preflight, build, migrate, seed và chờ healthy; `accounts` in đúng path/quyền CSV nhưng không tự dump password vào log; (2) `round` là thao tác BTC tường minh và không can thiệp giữa trận; (3) `reset` kiểm tra Compose project cố định, yêu cầu xác nhận và chỉ xóa containers/volumes local thuộc project đó.
**Verification:** `bash -n`, shell tests cho argument/error/target guards, hai chu kỳ up→status→stop và một reset trên disposable stack; docs commands copy-ready.
**Dependencies:** `P2-T34`, `P2-T35`.
**Files dự kiến:** `scripts/demo.sh`, `scripts/tests/demo.test.sh`, `package.json`, `docs/runbooks/local-demo.md`.
**Ước lượng:** M (4 file)

### [ ] P2-T37 — Clean-checkout browser demo qualification

**Owner:** Đinh Đức Thuận
**Mô tả:** Chứng minh stack committed có thể chạy từ clean checkout và hoàn tất flow trình duyệt thật, thay cho việc chỉ compose module trong test process.
**Acceptance criteria:** (1) BTC/team login qua gateway, hai team upload OCI, preflight và explicit round tạo kết quả; (2) BTC stage/publish và anonymous spectator xem replay trên máy khác cùng LAN; (3) restart không mất state/duplicate result, teardown sạch và không còn phụ thuộc file `/tmp`.
**Verification:** detached clean-worktree `npm ci` + Docker image build + `./scripts/demo.sh up`; browser automation cho login/upload/results/replay; root typecheck/test/build, Compose health/restart/cleanup và GitNexus change review pass.
**Dependencies:** `P2-T36`.
**Files dự kiến:** `tests/e2e/local-demo.config.ts`, `tests/e2e/local-demo.browser.test.ts`, `scripts/run-local-demo-e2e.sh`, `docs/runbooks/local-demo.md`.
**Ước lượng:** M (4 file)

### [ ] P2-T40 — Bot OCI mẫu tương thích Protocol v2

**Owner:** Đinh Đức Thuận
**Mô tả:** Bổ sung OCI fixture có thể qua preflight Protocol v1 hiện tại và tạo nước đi hợp lệ trong trận Protocol v2; dùng cho demo qualification.
**Acceptance criteria:** (1) Bot phản hồi cùng `protocolVersion`, `matchId`, `turnId` của `STATE_UPDATE` và chỉ chọn action hợp lệ; (2) corpus có chiến lược first-legal/capture-first cùng bốn archive v2 riêng biệt để nộp cho các đội demo; (3) manifest pin archive, OCI manifest/config digest và entrypoint; không thay đổi fixture v1 hiện có.
**Verification:** test v1/v2 response và capture strategy; typecheck/build corpus; xác nhận bốn archive nộp thay thế có digest khác nhau; `git diff --check` và GitNexus detect-changes trước commit.
**Dependencies:** `P2-T08`, `P3-T01`.
**Files dự kiến:** `src/bots/oci-fixtures/v2-action/{Dockerfile,bot.mjs}`, `src/bots/sandbox-corpus/{manifest.json,README.md,tests/v2-action.test.ts}`.
**Ước lượng:** M (5 file)

### [ ] P2-T38 — Dữ liệu mẫu vòng loại cho demo stack

**Owner:** Đinh Đức Thuận
**Mô tả:** Nạp một vòng loại mẫu có hai bot khác nhau qua API của demo stack để tạo bài nộp, trận, kết quả và bảng xếp hạng thật.
**Acceptance criteria:** (1) file mẫu khai báo đội, bot và thời gian; (2) loader chỉ chạy qua loopback trên demo dev, không reset dữ liệu, mặc định từ chối khi đã có vòng loại; `--append` chỉ nhận sample mới sau khi vòng trước `PUBLISHED`; (3) preflight, trận và bảng xếp hạng hoàn tất trên stack thật; không ghi credential vào source/log.
**Verification:** kiểm tra cú pháp và guard, chạy trên demo stack, đối chiếu số lượng round/submission/match/leaderboard sau khi chạy; GitNexus detect-changes trước commit.
**Dependencies:** `P2-T35`, `P2-T36`, `P2-T40`.
**Files dự kiến:** `samples/qualification-demo.json`, `samples/qualification-demo-extra.json`, `scripts/seed-sample-data.py`, `docs/runbooks/local-demo.md`.
**Verification tại task branch:** chạy trên `jump-jits`: 2 submission ACTIVE, 1 series FINALIZED, leaderboard 2 đội; PostgreSQL có 10 team, 2 submission, 1 qualification round, 2 match, 2 rating ledger row. Chạy lại bị từ chối trước khi tạo vòng mới. Cần review/merge branch trước khi tick.
**Mở rộng theo yêu cầu:** sample thứ hai dùng `team03`/`team04`; `--append` chỉ chạy sau khi vòng trước hoàn tất, reconcile/publish qua API và từ chối đội đã có submission. Loader publish vòng mới sau khi series hoàn tất để rating ledger được ghi.
**Verification bổ sung trên `jump-jits`:** hai vòng đều `PUBLISHED`, 4 submission, 6 match, 6 rating ledger row; leaderboard có 4 đội. Chạy lại `--append` với cùng sample bị từ chối do `team03` đã có submission; stack vẫn ready.
### [ ] P2-T39 — Trình chiếu replay toàn màn hình

**Owner:** Đinh Đức Thuận
**Mô tả:** Cho BTC/đội/khán giả xem replay đã xác minh trên bàn cờ lớn và phát ngay khi vào toàn màn hình.
**Acceptance criteria:** (1) nút vào/thoát fullscreen, Escape đồng bộ trạng thái; (2) vào fullscreen phát từ vị trí hiện tại hoặc phát lại sau khi hết; (3) replay không có ACTION_APPLIED nêu rõ vì sao quân cờ không di chuyển; (4) giữ nguyên xác minh replay và phân quyền.
**Verification:** test ReplayPlayer, typecheck/build web, kiểm tra trình duyệt ở kích thước desktop/mobile và cả replay có/không có nước đi.
**Dependencies:** `P2-T27`, `P3-D21`.
**Files dự kiến:** `src/platform/web/src/features/spectator/{ReplayPlayer.tsx,replay-player.css,ReplayPlayer.test.tsx}`, `src/platform/web/README.md`.

## Checkpoint P2-C — Full-stack local demo runtime

> Rà soát `main` ngày 2026-10-20: đã có entrypoint API/worker/coordinator, Dockerfiles, Compose và `scripts/demo.sh`. Mô tả trạng thái cũ ở `P2-T30`–`P2-T31` về branch chưa merge đã lỗi thời. Giữ tám task chưa tick cho đến khi đối chiếu acceptance riêng, clean-checkout browser demo, restart/teardown và root gates; root `npm test` hiện bị chặn bởi Redis `127.0.0.1:16379`.

- [ ] `P2-T30`–`P2-T37` hoàn tất trên các task branch riêng và merge vào `main` sau verification.
- [ ] Clean checkout dựng API, worker, coordinator, web và dependencies bằng một command; chỉ web gateway public ra LAN.
- [ ] Browser flow BTC/team/submission/result/replay pass với hai OCI canary; account CSV chỉ tồn tại local, mode `0600`, gitignored.
- [ ] Root gates, Docker image/Compose checks, restart/idempotency và teardown pass; không deploy cloud và không dùng production/shared data.

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

### [x] P3-L01 — Bot Protocol v2: time budget và private seed

**Owner:** Long Trần
**Mô tả:** Hiện thực Bot Protocol v2 đã duyệt để mỗi lượt mang time budget đã pin và mỗi bot chỉ nhận HMAC-derived `botSeed` riêng.
**Acceptance criteria:** (1) schema/types/fixtures v2 định nghĩa per-turn/remaining total budget, finite wall cap, opaque `matchId` và `botSeed` không lộ opponent/`engineSeed`; (2) v1 fixture vẫn validate bằng validator v1, v2 từ chối field/version sai; (3) compatibility guide nêu negotiation và lỗi tương thích.
**Verification:** `npm test --workspace @ott/bot-protocol`; `npm run typecheck --workspace @ott/bot-protocol`; contract fixture mutation phải fail.
**Dependencies:** `P3-T01`.
**Files likely touched:** `docs/contracts/bot-protocol-v2.md`, `docs/contracts/bot-protocol-v2.schema.json`, `src/bot-protocol/src/messages.ts`, `src/bot-protocol/src/validate.ts`, `src/bot-protocol/tests/schema-v2.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-17 — PR #29 merged. Machine schema `docs/contracts/bot-protocol-v2.schema.json` (self-contained, draft 2020-12, `additionalProperties: false` cho mọi object, 5 message giữ lifecycle v1, các `$defs` chia sẻ deep-equal với v1 nên hai version không drift) và fixtures `bot-protocol-v2-valid.ndjson` (5 dòng) + `bot-protocol-v2-invalid-cases.json` (9 case). Types additive trong `messages.ts`: `PROTOCOL_VERSION_V2`, `PerTurnPolicyV2`, `TimeControlV2`, `LimitsV2` (5 field của v1 trừ `startupTimeoutMs`/`turnTimeoutMs`, cộng `timeControl`), `InitMessageV2` (`botSeed`, không có `seed`/`engineSeed`), `TurnBudgetV2`, `StateUpdateMessageV2` (`timeBudget`), `ActionMessageV2`, `TurnResultMessageV2`, `MatchResultMessageV2`, `ProtocolMessageV2`, `AnyProtocolMessage`; v1 (`PROTOCOL_VERSION`, `ProtocolMessage`, `Limits`, `DEFAULT_LIMITS`, `validateBotMessage`, `compileProtocolValidator`) không đổi. `validateTimeControlV2` enforce `baseMs <= maxMs <= totalBotBudgetMs` (JSON Schema không so sánh được hai property) với mã lỗi trùng tên `P3-D01`; `validateBotMessageV2` fail closed bằng `SCHEMA_VIOLATION` nếu bị truyền validator v1. `startupMs` đặt trong `timeControl` để khớp field-by-field `RoundRuleSetRulesV1.timeControl`; mọi bound số (startup 1..60000, total 1..3.600.000, wall 1..7.200.000, everyTurns 1..10.000, fixed/base/step/max 1..3.600.000) mirror `P3-D01`; `botSeed` mirror ràng buộc v1 `seed` (1..128), không thêm luật mới. Ban riêng qualification (`FIXED 30s`, `FIXED 1min`, `NONE`) vẫn thuộc `RoundRuleSet`. Docs: `docs/contracts/bot-protocol-v2.md` (định nghĩa `LimitsV2`, machine contract, negotiation/compatibility guide, bảng error code), `src/bot-protocol/README.md`, `docs/README.md`. Verification: `@ott/bot-protocol` 55/55 pass (39 test v2, gồm matrix 9 case và mutation evidence), typecheck + build sạch; `@ott/match-runner` typecheck pass và test 134 pass/9 fail giống hệt baseline đo bằng `git stash -u` (e2e Python spawn `BOT_SPAWN_FAILED` trên máy Windows, không phải regression); GitNexus `detect-changes --scope all` 9 file/5 symbol/0 affected process, risk low. Còn mở để checkpoint `P3-A` xác nhận: cách đọc `LimitsV2` (đã chọn `startupMs` trong `timeControl`), việc PR chạm 9 file (> heuristic 5 file) và `TURN_RESULT`/`MATCH_RESULT` giữ shape v1; runtime chess-clock (`turnLimitMs`/`remainingBotBudgetMs` theo monotonic clock, timing event vào replay) thuộc `P3-L02`.

### [x] P3-D01 — RoundRuleSet và lifecycle round version hóa

**Owner:** Phạm Tất Đạt
**Mô tả:** Thêm persistence/service cho `RoundRuleSet` bất biến và state machine round tuần từ draft đến published.
**Acceptance criteria:** (1) mỗi save tạo version mới và round đã mở submission không sửa rule; (2) start idempotent, chỉ sau close, đóng băng submission/schedule snapshot và có audit; (3) pause/resume/publish tuân transition và Elo chỉ apply một lần sau terminal series.
**Verification:** `npm test --workspace @ott/platform-api -- round-rules`; PostgreSQL integration mutation transition/audit phải fail; `npm run typecheck --workspace @ott/platform-api`.
**Dependencies:** `P3-T01`.
**Files likely touched:** `src/platform/api/migrations/0007_round_rules.sql`, `src/platform/api/src/modules/rounds/types.ts`, `src/platform/api/src/modules/rounds/service.ts`, `src/platform/api/src/modules/rounds/routes.ts`, `src/platform/api/tests/rounds.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-14 — Migration `0007_round_rules.sql`: `round_rule_sets` append-only (trigger chặn UPDATE/DELETE), `qualification_rounds` với trigger chặn status edge sai, khóa `rule_set_id`/`schedule_round_id`/start idempotency sau khi set, không DELETE, một round chưa `PUBLISHED` mỗi stage; `audit_events.details`. Module `rounds` (validator rule set strict theo D-15/D-17/D-18 và field `TimeControlV2`, canonical SHA-256), lifecycle `DRAFT_RULES → SUBMISSION_OPEN → SUBMISSION_CLOSED → RUNNING (pause/resume) → SETTLING → RATED → PUBLISHED`; close sau `graceEndsAt`; start cần `Idempotency-Key` + xác nhận rule set, gọi `scheduleRound` Phase 2 ngoài transaction, retry sau crash an toàn; Elo áp dụng một lần qua `applyRoundRatings` (không sửa ratings/scheduling). Admin API BTC-only `/api/v1/admin/round-rule-sets` và `/api/v1/admin/rounds/:id/{open,close,start,pause,resume,reconcile,publish}`. `round-rules` 72/72 pass trên PostgreSQL 16.6 (20 integration chạy thật), scheduling 10/10, package 101 pass/13 env-skip, typecheck sạch; mutation trigger status-edge và audit `ROUND_STARTED` đều làm test fail. Pause chỉ ghi trạng thái (admission thuộc `P3-N02`); upload gating thuộc `P3-D03`; gia hạn deadline chưa có trong card.
**Trạng thái P3-D25:** rule set → match snapshot (engine, map, maxTurns, per-turn max) được nối trong D25; time-control budgets (L02b) và resources/job wiring vẫn còn mở.

### [x] P3-N01 — Resource profile, cgroup peak và Prometheus metrics

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Enforce resource profile theo round ở sandbox và ghi CPU/RAM peak từ cgroup v2 cho từng attempt.
**Acceptance criteria:** (1) memory/CPU/PID/tmpfs policy lấy từ job đã pin, không từ client; (2) vượt `memory.max` thành bot forfeit và `memory.peak` được lưu; (3) metrics không chứa source, credential hoặc raw stderr.
**Verification:** `npm test --workspace @ott/platform-worker -- resource-metrics` 8/8 pass; `tsc -p tsconfig.json` & `tsc -p tsconfig.build.json` pass; python bot tests 27/27 pass; Prometheus scrape fixture và AC-16 assertion pass; sanitization assertion pass.
**Dependencies:** `P3-T01`.
**Files likely touched:** `src/platform/worker/src/sandbox/policy.ts`, `src/platform/worker/src/sandbox/oci-runtime.ts`, `src/platform/worker/src/metrics.ts`, `src/platform/worker/src/run-match-job.ts`, `src/platform/worker/tests/resource-metrics.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-15 — Triển khai `createSandboxPolicy`/`resolveSandboxPolicy` áp dụng cấu hình tài nguyên (memory, swap, milliCpu, pids, tmpfs) từ profile/job đã pin vào Docker HostConfig. Bổ sung `readMemoryPeak` cho cgroup v2 với fallback an toàn sang container stats và mở rộng OOM detection trong `wait`. Tạo `WorkerMetrics` xuất Prometheus text exposition (`ott_match_attempts_total`, `ott_bot_memory_peak_bytes`, `ott_bot_cpu_usage_seconds_total`, `ott_bot_forfeits_total`) cùng helper `assertMetricsSanitized` chống rò rỉ credential, bot code, raw stderr. Tích hợp thu thập peak memory và ghi metrics vào `runMatchJob`. 8/8 test mới trong `resource-metrics.integration.test.ts` pass, 27/27 python contract tests pass, typecheck và build `@ott/platform-worker` sạch.

## [ ] Checkpoint P3-A — Contract foundation

- [ ] `P3-L01`, `P3-D01`, `P3-N01` pass focused tests/typecheck/build.
- [ ] Protocol, round rules và resource profile đều version hóa/pin được; không còn decision ngầm trong code.
- [ ] Đinh Đức Thuận duyệt trước Wave 2.

**Trạng thái 2026-10-17:** `P3-L01` đã merge (PR #29); `P3-D01` và `P3-N01` đã xong — cả ba task của Wave 1 hoàn tất, chỉ còn chờ Đinh Đức Thuận duyệt checkpoint. Không tick bullet nào ở đây; quyền duyệt thuộc Đinh Đức Thuận.

## Phase 3 — Wave 2: runtime và vận hành round

### [x] P3-L02 — Chess-clock/dynamic timing trong MatchRunner và replay

**Chia nhỏ phần tích hợp (2026-10-18):** Long được phép sửa phần tích hợp DB/API/worker cần thiết sau khi đã phối hợp owner (xác nhận trong phiên làm việc).
- [x] `P3-L02A` — BotProcess v1/v2 transport và monotonic clock adapter; tối đa 5 file code/test, cập nhật README cùng branch.
- [x] `P3-L02B1` — Migration và registry cho immutable protocol snapshot (2 file).
- [x] `P3-L02B2` — Scheduler/start orchestration, pin timeControl/bot seeds và snapshot integration tests (4 file).
- [x] `P3-L02B3` — Đồng bộ fixture round integration với map registry thực (1 file test).
- [x] `P3-L02C1` — Đọc snapshot, worker wiring, finalization v1/v2 và integration tests (5 file, gồm sửa teardown fixture cũ).
- [x] `P3-L02C2` — Sandbox v2 transport và transport tests (2 file).
- [x] `P3-L02D` — Rule-set identity trong event-log v2 và compatibility tests (5 file code/test).
Parent `P3-L02` chỉ hoàn tất khi mọi phần được verify; không dùng phần timing thuần đã merge để thay thế bằng chứng tích hợp.

**Owner:** Long Trần
**Mô tả:** Thực thi per-turn limit, tổng thời gian mỗi bot và wall-clock cap theo Protocol v2, đồng thời ghi timing decision vào event log/replay.
**Acceptance criteria:** (1) `Dynamic` deterministic theo turn và total budget dùng monotonic clock; (2) exhausted budget áp dụng đúng timeout/forfeit policy; (3) cùng transcript/rule set cho cùng timing events và replay verification.
**Verification:** `npm test --workspace @ott/match-runner -- timing`; fake-clock boundary/mutation tests pass; `npm run typecheck --workspace @ott/match-runner`.
**Dependencies:** `P3-L01`, `P3-D01`, `P3-N01`.
**Files likely touched:** `src/match-runner/src/timing-policy.ts`, `src/match-runner/src/match-runner.ts`, `src/match-runner/src/event-log.ts`, `src/match-runner/src/replay.ts`, `src/match-runner/tests/timing-policy.test.ts`.
**Estimated scope:** M (5 files)
**Verification local 2026-10-18:** timing thuần đã merge tại PR #34; phần tích hợp còn lại khi đó hoàn tất trên `longt/feat-p3-l02-runtime-integration` (chưa commit/merge/deploy tại thời điểm ghi). Đã nối immutable snapshot DB → worker → BotProcess/sandbox v2 → replay, clock `performance.now`, pin rule-set identity và cleanup startup timeout. Focused runner 49, worker 14, scheduling/snapshot/start 6 và round integration 20 test pass; protocol 55, core 46 pass; root typecheck/build pass. Full runner khi đó còn 9 lỗi Windows/Python; full API còn 1 lỗi path separator của registry test. Chi tiết bằng chứng/giới hạn: [runtime integration report](../docs/reports/phase-3-l02-runtime-integration.md). **Cập nhật 2026-10-20:** phần tích hợp đã vào `main` qua PR #48; tick task không thay checkpoint hay xác nhận deploy.

### [x] P3-N02 — Priority queue, worker heartbeat/capacity và pause/resume

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Điều phối official → preflight → test run trên một server lab, có lease/heartbeat, adaptive concurrency mặc định tối đa 4 game và pause nhận job mới.
**Acceptance criteria:** (1) mức thấp không chạy khi official đang chờ và admission tự giảm theo CPU/RAM; (2) worker mất heartbeat/restart làm attempt retryable, không duplicate result; (3) pause không hủy job đang chạy và resume giữ thứ tự deterministic/audit.
**Verification:** `npm test --workspace @ott/platform-worker -- worker-pool`; Redis/PostgreSQL integration mô phỏng mất worker/restart; queue active/waiting/failed trở về trạng thái mong đợi.
**Dependencies:** `P3-D01`, `P3-N01`.
**Files likely touched:** `src/platform/job-contract/src/queue-names.ts`, `src/platform/api/src/queue/match-queue.ts`, `src/platform/worker/src/worker-pool.ts`, `src/platform/worker/src/worker.ts`, `src/platform/worker/tests/worker-pool.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-16 — Chuẩn hóa các hằng số hàng đợi và độ ưu tiên nghiêm ngặt (`QUEUE_PRIORITY`: official=1, preflight=2, test-run=3) tại `queue-names.ts` và re-export qua `@ott/job-contract`. Mở rộng `MatchQueue` hỗ trợ enqueue theo priority/category, kiểm tra và truy vấn trạng thái hàng đợi. Xây dựng `WorkerPool` quản lý adaptive concurrency (mặc định 4 game, tự động điều chỉnh theo tải CPU/RAM thông qua `CapacityProbe`), kiểm soát admission ưu tiên ngăn chặn starvation của job official (AC-21), định kỳ phát heartbeat lên Redis kèm TTL và hỗ trợ pause/resume không drop các job đang thực thi. Mở rộng `createMatchWorker` hỗ trợ cấu hình concurrency, workerId, pause/resume và xử lý kết nối an toàn. 18/18 test mới trong `worker-pool.integration.test.ts` pass, 27/27 test python pass, toàn bộ typecheck và build pass.

### [x] P3-D02 — Admin round-rule và operations console

**Owner:** Phạm Tất Đạt
**Mô tả:** Cung cấp UI BTC để version/lock rule set, ước tính thời lượng và thực hiện open/close/start/pause/resume/publish có confirmation.
**Acceptance criteria:** (1) form phủ timing/resource/game/schedule/test-run fields và hiển thị worst-case estimate; (2) locked/running rule read-only, invalid transition bị server từ chối và UI reconcile; (3) start có two-step confirmation, reason và duplicate-click safety.
**Verification:** `npm test --workspace @ott/platform-web -- RoundAdmin`; `npm run typecheck --workspace @ott/platform-web`; browser smoke desktop/mobile và keyboard labels.
**Dependencies:** `P3-D01`.
**Files likely touched:** `src/platform/web/src/features/round-admin/api.ts`, `src/platform/web/src/features/round-admin/RoundRuleForm.tsx`, `src/platform/web/src/features/round-admin/RoundOperations.tsx`, `src/platform/web/src/features/round-admin/round-admin.test.tsx`, `src/platform/web/src/app/routes.tsx`.
**Estimated scope:** M (5 files)
**Trạng thái 2026-10-15:** đã implement trên `datpt/feat-p3-d02-round-admin` — trang `/admin/rounds` (form RoundRuleSet đủ nhóm thời gian/tài nguyên/luật game/lịch giờ Việt Nam/test run, mặc định D-15/D-17/D-18, ước tính xấu nhất `ceil(2·floor(T/2)/C)·matchWallClockMs` khớp §10.4, cảnh báo vượt khung phải xác nhận; bộ luật đã khóa chỉ đọc; nút thao tác chỉ theo `allowedActions` của server, 409 → tải lại trạng thái; start hai bước với reason + gõ số round, một idempotency key cho mỗi lần xác nhận, chống double-click). API bổ sung: `GET round-rule-sets/:id` trả `rules`, 400 `RULE_SET_INVALID` có `details[]`, round có `allowedActions`. `RoundAdmin` 28/28, platform-web 93/93, platform-api 117 pass trên PostgreSQL (round-rules integration 20/20), typecheck/build sạch; mutation idempotency/allowedActions/double-click/estimate/details đều làm test fail. **Còn thiếu để tick:** browser smoke desktop/mobile + keyboard (chưa có browser trong môi trường chạy).
**D02b (2026-10-18):** sau manual smoke của user, UI `/admin/rounds` được chỉnh trên `datpt/feat-p3-d02b-round-admin-ux` — bộ luật hiện hành cạnh editor, archive phiên bản, help từng field, spacing "Vận hành round", đổi nhãn reconcile. Chỉ web; manual browser smoke chờ user kiểm tra lại, **chưa tick D02**.
**Hoàn tất:** 2026-10-18 — merged PR #46 (UI revamp, gồm D02b). Browser smoke desktop/mobile/bàn phím do Phạm Tất Đạt review thủ công trên trình duyệt ngày 2026-10-18 (mock API); các chỉnh sửa sau review (editor scroll, version archive, field help, catalog dropdown D26) đã gộp trong PR #46.

## [ ] Checkpoint P3-B — Round có thể khóa và chạy

- [ ] Protocol v2 game dùng đúng frozen `RoundRuleSet`; AC-17/18 focused tests pass.
- [ ] Pause/resume và mất worker không làm duplicate job/result.
- [ ] Đinh Đức Thuận duyệt trước Wave 3.

## Phase 3 — Wave 3: submission và test run ở quy mô lớn

### [x] P3-D03 — Hash reservation, upload throttling và preflight visibility

**Owner:** Phạm Tất Đạt
**Mô tả:** Thêm one-click client hashing/reservation, grace-window upload và backpressure/queue position cho submission.
**Acceptance criteria:** (1) reservation trước deadline chỉ chấp nhận đúng SHA-256 trong grace window; (2) global/per-team concurrency trả retry-after thay vì treo; (3) portal hiển thị progress/preflight position và retry cùng file idempotent.
**Verification:** API+web focused suites; AC-15 burst test với clock giả; wrong-hash/late/no-reservation mutations bị từ chối.
**Dependencies:** `P3-D01`, `P3-N02`.
**Files likely touched:** `src/platform/api/migrations/0009_submission_reservations.sql`, `src/platform/api/src/modules/submissions/reservations.ts`, `src/platform/api/src/modules/submissions/routes.ts`, `src/platform/web/src/features/submissions/SubmissionForm.tsx`, `src/platform/api/tests/submission-reservations.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-17 — Migration `0009_submission_reservations.sql` (renumbered từ 0008 do `0008_team_representative_email.sql` đã có trên `main`, đăng ký trong `src/platform/api/src/db/schema.ts` với `seq BIGINT GENERATED ALWAYS AS IDENTITY`): `submission_reservations` append-only (trigger chặn UPDATE các trường cốt lõi bao gồm `seq`, cấm DELETE, chỉ chuyển `RESERVED -> COMPLETED` đồng thời với `submission_id`/`completed_at`), `submissions.qualification_round_id` và index `submissions_preflight_position_idx`. Module `reservations` (`createReservation` trước deadline idempotent trả 201/200, `resolveUpload` trong grace window chỉ chấp nhận đúng SHA-256 đã giữ chỗ, completion idempotent trong transaction với `SELECT ... FOR UPDATE`, `getCurrentReservation` sắp xếp theo `reserved_at DESC, seq DESC`). Concurrency limiter in-process (`upload-limiter.ts`, mặc định global 8, per-team 1, trả HTTP 429 và header `Retry-After >= 1`, giữ slot cho tới khi handler kết thúc hoặc kết nối bị abort, release trên `reply.raw` finish/close). Web portal one-click "Nộp" (`sha256File` -> `reserveSubmission` -> `uploadSubmission` với progress bar accessible `role="progressbar"`, 429 auto-retry với `Retry-After` backoff, retry cùng file idempotent trên lỗi mạng, localized error messages, hiển thị "Vị trí preflight: n / N"). Lưu ý kiến trúc: vị trí preflight được tính trực tiếp từ PostgreSQL (`COUNT(*)` submissions `status = 'PREFLIGHT'` theo `created_at, id`) do hệ thống chưa có preflight queue producer. Verification: trong sandbox Coder, tests integration KHÔNG CHẠY do không có Docker/PostgreSQL/Redis/SeaweedFS (toàn bộ 13 file integration skipped); các unit/mock suites đã chạy thực tế và pass: `submission-reservations.unit` 15/15 pass (bao gồm abort socket destroy và slot holding), `migrations-registry.test` 1/1 pass (uniqueness, sort order, file existence, completeness), web submissions 15/15 pass, full web suite 106/106 pass, platform-api 162 pass / 66 skipped (30 files: 17 passed, 13 skipped), typecheck và web build sạch. Các lệnh chạy integration tests (kèm 3x repeatability và DB mutations) được liệt kê trong `.relayer/commands.md` để Reviewer thẩm định và thực thi.

### [x] P3-D04 — CSV team provisioning và credential file tải một lần

**Owner:** Phạm Tất Đạt
**Mô tả:** Import danh sách đội đã duyệt và stream file credential plaintext đúng một lần mà không persist nội dung.
**Acceptance criteria:** (1) validate CSV/email trường/uniqueness atomically với error theo dòng; (2) password chỉ tồn tại trong response stream, DB giữ hash và audit chỉ ghi count/actor; (3) retry không phát lại credential cũ, hỗ trợ bulk reset tạo file mới.
**Verification:** `npm test --workspace @ott/platform-api -- bulk-teams`; log/audit/storage secret scan; download-once concurrency test và malformed CSV tests.
**Dependencies:** `P3-T01`.
**Files likely touched:** `src/platform/api/src/modules/teams/bulk.ts`, `src/platform/api/src/modules/teams/routes.ts`, `src/platform/api/tests/teams-bulk.integration.test.ts`, `src/platform/web/src/features/admin-teams/BulkProvision.tsx`, `src/platform/web/src/features/admin-teams/BulkProvision.test.tsx`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-14 — `POST /api/v1/admin/teams/bulk-import` nhận CSV `team_name,representative_email` (RFC 4180, BOM/CRLF, 1–500 dòng), validate toàn bộ và trả lỗi theo dòng/cột không echo giá trị; trùng tên/email trong file và với DB bị từ chối nguyên khối; credential sinh và stream một lần trong response `text/csv` (`no-store`, attachment, chống formula injection), DB chỉ giữ argon2 hash, audit chỉ ghi actor/`count=N`. `POST /api/v1/admin/teams/bulk-reset` theo `teamIds` tạo file mới và revoke session cũ. Theo quyết định của Đạt (14/10/2026), migration `0008_team_representative_email.sql` lưu email người đại diện (lowercase, unique, nullable, chỉ BTC thấy). UI BTC: nhập CSV, chọn đội để cấp lại hàng loạt, file tải trực tiếp không hiển thị mật khẩu. `bulk-teams` 34/34 pass trên PostgreSQL 16.6 + Redis (8 integration chạy thật), platform-api 74 pass/2 env-skip, platform-web 72 pass, typecheck sạch; mutation ghi mật khẩu vào audit và bỏ revoke session đều làm test fail. Hạn chế: retry trùng username trong transaction không dùng SAVEPOINT (xác suất trùng ~2^-32).

### [x] P3-N03 — Test-run quota, opponent policy và private artifacts

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Tạo flow test run ưu tiên thấp, chỉ đấu bot tham chiếu hoặc submission khác cùng đội, không ảnh hưởng Elo.
**Acceptance criteria:** (1) quota tính khi start và hoàn lại cho infra failure; (2) test run đứng chờ khi official round chạy và không nhận bot đội khác; (3) result/replay/truncated stderr chỉ owner team/BTC đọc được.
**Verification:** API/worker integration và AC-21 pass; RBAC tests cross-team/anonymous; rating ledger không đổi sau test run.
**Dependencies:** `P3-D01`, `P3-L02`, `P3-N02`.
**Files likely touched:** `src/platform/api/migrations/0015_test_runs.sql`, `src/platform/api/src/modules/test-runs/service.ts`, `src/platform/api/src/modules/test-runs/routes.ts`, `src/platform/worker/src/run-test-job.ts`, `src/platform/worker/tests/test-run.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — Test-run flow theo AC-21 và D-18: Migration `0015_test_runs.sql` (bảng `test_runs`, enums `test_run_status`, `test_run_opponent_type`, index quota và team isolation); module `test-runs` trong `platform-api` (`createTestRun`, `getTestRunById`, `listTestRuns`, `refundTestRunQuota`, `completeTestRun`, `failTestRun`, `getDailyConsumedQuota`, `getRoundTestRunQuota`); routes `POST /api/v1/test-runs`, `GET /api/v1/test-runs`, `GET /api/v1/test-runs/:id`, `GET /api/v1/test-runs/:id/replay`; worker `runTestJob` với queue priority thấp (`QUEUE_PRIORITY.TEST_RUN = 3`), sandbox execution, replay private `replays/test-runs/<id>.json`, stderr truncated 4 KiB, tự động hoàn quota khi gặp lỗi hạ tầng; bảo vệ RBAC nghiêm ngặt (chỉ owner team hoặc BTC_ADMIN được truy cập); ratings ledger hoàn toàn không bị ảnh hưởng. Test `test-run.integration.test.ts` 8/8 pass, `migrations-registry.test.ts` 1/1 pass, Python tests 27/27 pass, worker & api typecheck và build sạch 0 lỗi.


## [ ] Checkpoint P3-C — Participant workflows

- [ ] AC-15 và AC-21 pass; overload có backpressure rõ ràng.
- [ ] Credential plaintext không persist/log; test run không ảnh hưởng Elo hoặc lộ dữ liệu đội khác.
- [ ] Đinh Đức Thuận duyệt trước Wave 4.

## Phase 3 — Wave 4: OCI lifecycle, ranking và replay privacy

### [x] P3-N04 — OCI layer dedup, retention, base image và duplicate flag

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Quản lý layer theo digest, retention policy và official base images; flag submission trùng hệt mà không tự kết luận gian lận.
**Acceptance criteria:** (1) shared layers lưu một bản và garbage collection không xóa artifact đã pin/ACTIVE/3 bản gần nhất; (2) base image/starter kit build reproducible, digest và hướng dẫn/FAQ được công bố; (3) manifest/config/non-base layer duplicate tạo review flag/audit cho BTC.
**Verification:** storage integration/reference-count race tests; AC-22 pass; dry-run retention report khớp fixture trước delete.
**Dependencies:** `P3-D03`.
**Files likely touched:** `src/platform/api/migrations/0010_oci_layers.sql`, `src/platform/api/src/modules/submissions/layers.ts`, `src/platform/worker/src/artifacts.ts`, `src/bots/starter-kits/README.md`, `src/platform/api/tests/oci-retention.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — OCI layer deduplication, AC-22 duplicate detection, D-18 retention invariants và starter kits FAQ: migration `0010_oci_layers.sql` tạo `oci_layers`, `submission_layers`, thêm `duplicate_of_submission_id`, `duplicate_review_flag`, `duplicate_review_reason` vào bảng `submissions`; `layers.ts` cung cấp `recordSubmissionLayers` (dedup theo digest, track new/shared count), `checkDuplicateSubmission` (AC-22: tự động so khớp manifest digest hoặc non-base layers của đội khác, gắn flag và ghi audit event `DUPLICATE_SUBMISSION_FLAGGED` mà không huỷ submission), `evaluateRetention` và `runRetentionPrune` (D-18 invariants: không xóa ACTIVE, không xóa match submissions, giữ top 3 per team, dry-run report khớp fixture trước delete, bảo vệ race condition re-referencing); `artifacts.ts` bổ sung `OFFICIAL_BASE_IMAGES` (Python 3.12-slim, Node 22-slim, Go 1.22-alpine) và `extractOciLayersFromArchive`; `src/bots/starter-kits/README.md` công bố bảng digest, hướng dẫn reproducible build và FAQ; test `oci-retention.integration.test.ts` 9/9 pass, Python bot unit tests 27/27 pass, worker và api typecheck/build clean.
**Còn mở (2026-10-18, phát hiện khi review UI):** `checkDuplicateSubmission`, `recordSubmissionLayers`, `evaluateRetention`, `runRetentionPrune` và `getSubmissionLayers` trong `src/platform/api/src/modules/submissions/layers.ts` chỉ được export và test; **không có caller nào trong đường upload/preflight/worker** (`grep -rn` chỉ thấy `layers.ts`, `src/index.ts` và test). Vì vậy `duplicate_review_flag` không bao giờ được set trong hệ thống thật, layer không được ghi vào `submission_layers` và retention prune không chạy. BTC cũng chưa có danh sách submission bị flag (endpoint `GET /api/v1/submissions` chỉ cho `TEAM_ACCOUNT`). Cần: nối vào pipeline upload/preflight, lịch chạy prune, và (sau) một danh sách flagged cho BTC. Chưa tick lại AC-22 cho tới khi nối xong.
**Đã xử lý (2026-10-19):** `preflightSubmission` (worker) giờ ghi layer và chạy `checkDuplicateSubmission` sau smoke test, trước khi activate; chỉ gắn cờ, không chặn. BTC xem danh sách tại `GET /api/v1/admin/submissions/flagged` và bảng "Có thể trùng" trong Operations Console. Branch `datpt/feat-p3-duplicate-check-wiring`.


### [x] P3-L03 — Qualification gate, adaptive K và minimum-series eligibility

**Owner:** Long Trần
**Mô tả:** Thực thi capture-first gate, K=64 cho 5 series đầu rồi K=32 và nhãn chưa đủ điều kiện finals.
**Acceptance criteria:** (1) submission cần ≥1 điểm/2 game đổi phía với gate bot đã pin; (2) rating rebuild cho kết quả giống incremental apply với adaptive K; (3) dưới minimum series không vào finals eligibility nhưng vẫn hiện leaderboard có nhãn.
**Verification:** `npm test --workspace @ott/platform-api -- ratings`; property/rebuild/mutation tests; gate fixture hai phía pass/fail deterministic.
**Dependencies:** `P3-T01`, `P3-D01`.
**Files likely touched:** `src/platform/api/src/modules/ratings/elo.ts`, `src/platform/api/src/modules/ratings/service.ts`, `src/platform/api/src/modules/scheduling/eligibility.ts`, `src/platform/api/tests/ratings-v2.test.ts`, `src/platform/api/tests/qualification-gate.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** Chưa tick — code và test không cần dịch vụ đã xong (platform-api: 328 pass / 96 skipped, ratings-v2 48 pass, qualification-gate 37 pass, platform-web 125 pass, typecheck sạch); các integration PostgreSQL (`qualification-gate.integration.test.ts`) và mutation DB chưa chạy, chờ Reviewer. Ngoài phạm vi: xếp lịch/chạy 2 game gate trong preflight queue và cấu hình gate bot theo stage.
**Cập nhật 2026-10-18:** merged PR #35. Reviewer chạy integration thật trên PostgreSQL/Redis/S3: `qualification-gate` 46/46, ratings/leaderboard/scheduling/operations/round-rules 268/268 ×3 trên DB mới, full API suite 424/424, mutation rebuild-by-`created_at` và bỏ trigger gate-results đều làm test fail.

### [x] P3-D05 — Qualification replay authorization từ dữ liệu đầu tiên

**Owner:** Phạm Tất Đạt
**Mô tả:** Áp dụng team-private qualification replay từ record đầu tiên và giới hạn anonymous public replay cho finals đã publish; dự án chưa có dữ liệu public cũ cần migration.
**Acceptance criteria:** (1) hai team trong match và BTC đọc qualification replay sau integrity; (2) anonymous chỉ đọc finals replay `PUBLISHED`; (3) policy được enforce server-side ngay khi tạo/publish record và không lộ seed/object key.
**Verification:** `npm test --workspace @ott/platform-api -- replays`; cross-team/anonymous/stage matrix; mutation bỏ stage guard phải fail.
**Dependencies:** `P3-T01`, `P3-D01`.
**Files likely touched:** `src/platform/api/migrations/0011_replay_visibility.sql`, `src/platform/api/src/modules/replays/service.ts`, `src/platform/api/src/modules/replays/routes.ts`, `src/platform/api/tests/replay-authorization.integration.test.ts`, `docs/contracts/spectator-replay-v2.md`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-15 — Qualification replay private từ record đầu tiên: `GET /api/v1/replays/:matchId` (cần session) cho hai đội trong trận và BTC sau integrity check, `Cache-Control: private, no-store`, đội khác nhận 404, anonymous 401; `GET /api/v1/public/replays/:matchId` chỉ trả finals (`FINALS`) `PUBLISHED`. Stage/publish replay không phải `FINALS` bị từ chối `409 REPLAY_NOT_PUBLIC_STAGE` ở service và trigger `0011_replay_visibility.sql`; không có migration dữ liệu cũ. Projection v1 không đổi (không lộ seed/object key); contract `docs/contracts/spectator-replay-v2.md`. Web: nút Replay trên kết quả trận của đội/BTC mở player riêng tư; catalog BTC ẩn nút công khai cho vòng loại. E2E qualification của Thuận cập nhật theo D-21 (theo quyết định của Đạt). platform-api 157 pass trên PostgreSQL (replays-authorization integration 5/5, routes 6/6), platform-web 78 pass, root typecheck sạch; mutation bỏ FINALS check ở trigger và ở public read đều làm test fail. E2E `npm run test:e2e:qualification` chưa chạy được tới phần replay trên máy local (fail sớm ở preflight `PREFLIGHT_START_BOT_SPAWN_FAILED`, line 200, trước đoạn đã sửa) — cần chạy lại trên môi trường sandbox chuẩn.

## [ ] Checkpoint P3-D — Fairness và data policy

- [ ] AC-22 pass; rating ledger rebuild deterministic với policy đã duyệt.
- [ ] Anonymous không đọc được qualification replay kể cả biết `matchId`.
- [ ] Đinh Đức Thuận duyệt trước Wave 5.

## Phase 3 — Wave 5: public experience và authentication hardening

### [x] P3-L04 — Replay move list, seek và historical-version compatibility

**Owner:** Long Trần
**Mô tả:** Bổ sung danh sách nước đi đồng bộ player và adapter đọc replay theo engine/protocol/rule version cũ.
**Acceptance criteria:** (1) click move seek đúng event/snapshot và keyboard/screen-reader dùng được; (2) unsupported/tampered version fail trước render; (3) replay v1/v2 fixtures cũ vẫn dựng đúng kết quả, không dùng luật mới để tính lại.
**Verification:** `npm test --workspace @ott/platform-web -- ReplayPlayer`; compatibility fixtures và checksum mutation pass; production build không kéo Node-only runtime.
**Dependencies:** `P3-L02`, `P3-D05`.
**Files likely touched:** `src/platform/web/src/features/spectator/replay-schema.ts`, `src/platform/web/src/features/spectator/replay-state.ts`, `src/platform/web/src/features/spectator/MoveList.tsx`, `src/platform/web/src/features/spectator/ReplayPlayer.tsx`, `src/platform/web/src/features/spectator/ReplayPlayer.test.tsx`.
**Estimated scope:** M (5 files)

**Local verification:** Move list, seek to the last event of each entry,
keyboard navigation, aria-current and historical version guards implemented.
Verified: ReplayPlayer + verify-replay 20 tests passed; web production build passed.
L04 remains unchecked: AC3 (raw event-log v2 fixtures) awaits resolution with
`docs/contracts/spectator-replay-v2.md`, which preserves representation v1.
**Hoàn tất:** 2026-10-18 — merged PR #36 (`longt/feat-p3-l04-replay-compatibility`): move list đồng bộ với player, seek theo event index, guard phiên bản replay cũ/không hỗ trợ; build web không kéo Node-only runtime. Test: `npm test --workspace @ott/platform-web -- ReplayPlayer`.

### [x] P3-L05 — Static public snapshots, queue/results/rules/status site

**Owner:** Long Trần
**Mô tả:** Xuất và hiển thị last-known-good static snapshot cho round, queue order/ETA, results, leaderboard, current rules, announcements và stale state.
**Acceptance criteria:** (1) public site chỉ đọc versioned/checksummed files và polling cache, không gọi DB/worker/control write API; (2) qualification không có replay link, finals có sau sync, đồng thời có lịch/rules/FAQ/announcement/status; (3) snapshot cũ vẫn phục vụ kèm updated-at/stale warning và ETA sự cố khi publisher lỗi.
**Verification:** static publisher tests + `npm test --workspace @ott/platform-web -- public-site`; network contract assertion không có execution endpoint; load test artifact dùng cho AC-14.
**Dependencies:** `P3-D01`, `P3-N02`, `P3-L03`, `P3-D05`.
**Files likely touched:** `src/platform/api/src/modules/public-snapshots/publisher.ts`, `src/platform/web/src/features/public/PublicTournamentPage.tsx`, `src/platform/web/src/features/public/RulesPage.tsx`, `src/platform/web/src/features/public/public-site.test.tsx`, `docs/contracts/public-snapshot-v1.md`.
**Estimated scope:** M (5 files)

**Local implementation:** Static publisher + CLI, checksummed immutable artifact and atomic
latest pointer; `/public` polls static files every 30s, retains last good data on
failure, displays rules/schedule/FAQ/status/ETA, and guards qualification/finals
replay links. API publisher 4 tests and public-site 5 tests pass; web build passes.
Local load: 1,000 logical clients / 2,000 static requests with a 100-connection
pool; see `docs/reports/phase-3-l05-static-load.md`.
Live qualification producer reads locked rules/results/official rankings from
PostgreSQL and ordered job IDs from Redis, with a 30s loop; 2 PostgreSQL integration
tests pass. Task remains unchecked pending configured live deployment and
server-lab/CDN AC-14 evidence; finals uses the prepared public DTO interface.
**Hoàn tất:** 2026-10-18 — merged PR #37 (`longt/feat-p3-l05-public-snapshots`): publisher static snapshot có checksum + trang `/public` (hàng đợi, kết quả, bảng xếp hạng, luật, lịch, trạng thái) đọc snapshot, stale warning. Test: `public-snapshots`, `public-site`. Còn mở: chưa có tiến trình định kỳ gọi publisher (xem P2-T32) và chưa có UI nhập thông báo.

### [x] P3-D06 — TOTP, admin network allowlist và hosted startup guard

**Owner:** Phạm Tất Đạt
**Mô tả:** Hardening authentication/admin ingress có cấu hình dev/test và fail-closed ở hosted PoC/production, kèm rate/security headers.
**Acceptance criteria:** (1) BTC login hỗ trợ TOTP/recovery code, secret mã hóa và không log; (2) admin API kiểm tra trusted proxy/network allowlist server-side; (3) hosted/production từ chối start khi TOTP tắt/allowlist rỗng, dev/test vẫn chạy password-only theo cấu hình.
**Verification:** auth integration, known test TOTP và recovery replay tests; AC-23 pass; header/rate-limit/proxy spoof tests pass.
**Dependencies:** `P3-T01`, `P3-D04`.
**Files likely touched:** `src/platform/api/migrations/0012_admin_mfa.sql`, `src/platform/api/src/modules/auth/totp.ts`, `src/platform/api/src/modules/auth/plugin.ts`, `src/platform/api/src/config/security.ts`, `src/platform/api/tests/auth-hardening.integration.test.ts`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-15 — `config/security.ts`: `OTT_DEPLOYMENT_MODE` bắt buộc; startup guard (AC-23) cho hosted/production từ chối khởi động khi TOTP tắt, allowlist admin rỗng, trusted proxy chưa cấu hình/quá rộng hoặc thiếu khóa mã hóa; dev/test mặc định password-only như cũ. IP client thật chỉ tin `X-Forwarded-For` từ trusted proxy (chống spoof); `/api/v1/admin/*` ngoài allowlist → 403 `ADMIN_NETWORK_FORBIDDEN`. BTC login hai bước: mật khẩu → challenge `ott_mfa` → `POST /api/v1/auth/login/mfa` với TOTP RFC 6238 (chống replay theo step) hoặc recovery code dùng một lần; secret mã hóa AES-256-GCM (migration `0012_admin_mfa.sql`), lỗi chung `INVALID_CREDENTIALS`. Enrollment qua `OTT_BOOTSTRAP_BTC_TOTP_SECRET` + API tự phục vụ (rotate secret, sinh recovery code sau lần đăng nhập MFA đầu). Header bảo mật, body limit 1 MiB, rate limit ghi theo IP/account. Web: bước nhập mã trên trang đăng nhập. `auth-hardening` 54/54 trên PostgreSQL + Redis (integration 15/15, chạy lại liền hai lần đều pass), platform-api 200 pass/2 env-skip, platform-web 74 pass, typecheck sạch; mutation replay TOTP, rò recovery code vào audit, dùng lại recovery code đều làm test fail. Còn mở: UI enrollment, entrypoint server/deploy (Nguyên).

## [ ] Checkpoint P3-E — Public/security boundary

- [ ] AC-14/17/18/23 focused evidence pass; static public traffic không chạm execution plane.
- [ ] Replay compatibility và auth production guard được mutation-test.
- [ ] Đinh Đức Thuận duyệt trước Wave 6.

## Phase 3 — Wave 6: operations readiness

### [x] P3-N05 — Metrics/alerts, backup-restore và incident runbooks

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Hoàn thiện quan sát hệ thống và quy trình phục hồi/ứng phó cho control plane, queue, storage và worker pool.
**Acceptance criteria:** (1) dashboard/alerts phủ queue age, heartbeat, infra failure, finalize stuck, sandbox resource; (2) backup ngoài máy và restore sang laptop khác giữ checksum/audit; (3) incident/OWASP checklist có owner/action cho pause upload, read-only public mode, secret rotation và thông báo sự cố.
**Verification:** alert fixture tests; restore drill script trên namespace cô lập; dependency/secret scan, OWASP self-assessment và runbook tabletop checklist được Thuận ký.
**Dependencies:** `P3-N01`, `P3-N02`, `P3-D06`.
**Files likely touched:** `ops/prometheus/rules.yml`, `ops/grafana/dashboards/tournament.json`, `scripts/backup-local.sh`, `scripts/restore-local.sh`, `docs/runbooks/production-operations.md`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — Alerting, Grafana dashboard, backup-restore và incident runbooks: `ops/prometheus/rules.yml` định nghĩa 8 alert rules (`QueueAgeHigh`, `WorkerHeartbeatMissing`, `InfraFailureSpike`, `FinalizeStuck`, `SandboxResourcePressure`, `DeadLetterQueueNotEmpty`, `BotForfeitSpike`, `WorkerCapacityThrottled`); `ops/grafana/dashboards/tournament.json` trực quan hoá throughput, queue age, active worker pool, bot forfeits by reason, host CPU/RAM và bot cgroup memory.peak; `scripts/backup-local.sh` và `scripts/restore-local.sh` sao lưu/khôi phục PostgreSQL, MinIO storage, SHA-256 manifest và xác thực toàn vẹn audit events/matches; `docs/runbooks/production-operations.md` quy định 4 emergency playbooks có Owner/Action (Pause upload, Read-only public mode, Secret rotation, Thông báo sự cố/đền bù), bảng tự đánh giá OWASP Top 10 và biên bản diễn tập có chữ ký xác nhận; `ops-alerts-backup.test.ts` 6/6 pass, worker typecheck/build clean, bot protocol 27/27 pass.


### [x] P3-D07 — Privileged operations, audit và round results hash

**Owner:** Phạm Tất Đạt
**Mô tả:** Hoàn thiện thao tác BTC: revoke/suspend, retry/cancel lỗi hạ tầng, audit bất biến và công bố round results hash. Theo quyết định D27 ngày 2026-10-18, khiếu nại xử lý ngoài nền tảng; task này không triển khai case workflow.
**Acceptance criteria:** (1) mọi privileged action có RBAC, reason, correlation ID và append-only before/after audit; (2) rerun chỉ cho infra failure, không duplicate result/Elo, queue override được công khai; (3) round results hash được công bố, lịch sử không bị xóa.
**Verification:** `npm test --workspace @ott/platform-api -- operations`; unauthorized/invalid-rerun/audit immutability mutations fail; export audit/case fixtures không chứa seed, credential hoặc private stderr.
**Dependencies:** `P3-D01`, `P3-N02`, `P3-N04`.
**Files likely touched:** `src/platform/api/migrations/0013_operations_cases.sql`, `src/platform/api/src/modules/operations/service.ts`, `src/platform/api/src/modules/operations/routes.ts`, `src/platform/api/tests/operations.integration.test.ts`, `src/platform/web/src/features/operations/OperationsConsole.tsx`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — Migration `0013_operations_cases.sql` (audit_events/operations_case_events/queue_overrides append-only bằng trigger, `operations_cases` state machine, `match_outbox.generation`, `qualification_rounds.results_hash`), module `src/modules/operations/` (suspend/unsuspend, revoke, cancel, rerun chỉ cho infra failure, cases + evidence/status/decision, audit read/export qua sanitizer, public `GET /api/v1/public/queue-overrides`), round results hash lúc publish, `/admin/operations` trên web. Đã chạy: `npm test --workspace @ott/platform-api -- operations` = 66 passed, 16 skipped (integration, 3 file passed, 1 skipped); full api = 243 passed, 87 skipped (22 file passed, 15 skipped); web = 124 passed (17 file); typecheck toàn workspace và build web pass; 5 mutation không-DB (bỏ RBAC, nhận failure_reason ngoài allowlist, rerun khi round settled, bỏ sanitizer, bỏ idempotency) đều làm test fail rồi khôi phục. **Integration:** Reviewer chạy `operations.integration.test.ts` ở loop 23 = 80/82 passed (2 expectation sai về số audit row, đã sửa trong test); chạy lại sau khi sửa, lặp ×3, full API suite và mutation bỏ audit-immutability trigger: NOT RUN, đang chờ Reviewer (xem `.relayer/commands.md`). Giới hạn đã biết: rerun bị từ chối khi round đã `FINALIZED`/đã áp dụng Elo.
**Điều chỉnh 2026-10-18 (D27):** anomaly/duplicate/appeal cases removed by project owner; appeals handled outside platform. Architecture Phase 3 §214 đã cập nhật. Requirement §17.6 vẫn quy định cửa sổ khiếu nại và rerun chỉ khi có lỗi hạ tầng; quy trình ngoài nền tảng cần biên bản BTC trước khi duyệt checkpoint liên quan.

### [x] P3-N06 — Single-server smoke/load và pilot qualification round

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Chạy smoke/load mức vừa trên đúng server lab và một pilot round để chứng minh hosted PoC hoạt động, không tuyên bố production scale.
**Acceptance criteria:** (1) fixture ~200 đội, ~100 session, 4 game adaptive, ~1.000 public clients qua CDN/static và burst 50 upload/reservation có evidence; (2) overload có queue position/`Retry-After`, ưu tiên thấp bị hoãn, không mất submission/result; (3) restart worker/server + restore/retry không duplicate result/Elo và report ghi capacity/bottleneck thật.
**Verification:** signed run report kèm commit/config/host inventory; DB/result/ledger integrity queries; root `npm test`, `npm run typecheck`, `npm run build` từ clean checkout.
**Dependencies:** `P3-N03`, `P3-N04`, `P3-L03`, `P3-L04`, `P3-L05`, `P3-D06`, `P3-D07`, `P3-N05`.
**Files likely touched:** `tests/load/qualification-round.ts`, `tests/e2e/worker-recovery.test.ts`, `scripts/run-lab-server-pilot.sh`, `docs/reports/phase-3-capacity.md`, `docs/runbooks/hosted-poc-operations.md`.
**Estimated scope:** M (5 files plus external test evidence)
**Hoàn tất:** 2026-10-18 — Pilot qualification round và single-server capacity benchmark: Module load test `tests/load/qualification-round.ts` & `qualification-round.test.ts` (mô phỏng 200 đội, 100 sessions, burst 50 upload reservations với backpressure HTTP 429 + `Retry-After >= 1`, 1.000 public snapshot requests offloaded 100% qua static cache, điều phối hàng đợi ưu tiên hoãn an toàn test-run nhường chỗ cho official round, 200 trận đấu giải tính điểm Elo thích ứng với Adaptive K=64 -> 32); E2E recovery test `tests/e2e/worker-recovery.test.ts` (kiểm tra worker heartbeat timeout, tăng generation outbox, retry an toàn chống ghi đúp kết quả và bảo toàn tính bất biến của rating ledger, chỉ duyệt rerun cho hạ tầng); runner tự động `scripts/run-lab-server-pilot.sh` thu thập host inventory; báo cáo năng lực chi tiết `docs/reports/phase-3-capacity.md` và sổ tay vận hành `docs/runbooks/hosted-poc-operations.md` cho Checkpoint P3-2B. Chạy thực tế: `qualification-round.test.ts` 1/1 pass, `worker-recovery.test.ts` 4/4 pass, Python bot contract 27/27 pass, typecheck toàn workspace và build platform sạch 0 lỗi.


## [ ] Checkpoint P3-2B — Qualification hosted PoC-ready

- [ ] AC-13–AC-19 và AC-21–AC-23 pass hoặc có biên bản BTC duyệt.
- [ ] D-08/D-26 có report số đo server lab; pilot round, backup/restore và restart recovery drill hoàn tất.
- [ ] Đinh Đức Thuận duyệt trước mọi finals implementation.

## Phase 3 — Wave 7: finals domain và LAN control plane

### [x] P3-L06 — Finals 8-team bracket/BO3/game-adapter scoring

**Owner:** Long Trần
**Mô tả:** Hiện thực Finals Format v1: 8 unique seed, no-group single-elimination BO3, optional bronze, map/side policy và versioned game-adapter score breakdown.
**Acceptance criteria:** (1) cùng locked ranking/seed/config tạo cùng bracket `1–8/4–5/2–7/3–6`; (2) side swap, map non-repeat, adapter criteria và qualification-seed fallback theo contract; (3) finalized result mới advance bracket và override có audit evidence.
**Verification:** property tests cho bracket/schedule/scoring; AC-09 fixture pass; mutation tie-break/seed/side swap/adapter version phải fail.
**Dependencies:** `P3-T01`, Checkpoint `P3-2B`, `P3-L03`.
**Files likely touched:** `src/platform/api/src/modules/finals/seeding.ts`, `src/platform/api/src/modules/finals/scheduling.ts`, `src/platform/api/src/modules/finals/scoring.ts`, `src/platform/api/tests/finals-domain.test.ts`, `docs/contracts/finals-format-v1.md`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — merged PR #39 (`longt/feat-p3-l06-finals-domain`): `src/platform/api/src/modules/finals/{seeding,scheduling,scoring}.ts`, `docs/contracts/finals-format-v1.md`, `tests/finals-domain.test.ts`. Domain thuần; chưa có runtime tạo/chạy trận finals (ngoài scope card).

### [x] P3-D08 — Finals control plane, seeding và LAN submission cutoff

**Owner:** Phạm Tất Đạt
**Mô tả:** Thêm model/API cho finals rule set, group/series, LAN submission window và pin artifact trước giải.
**Acceptance criteria:** (1) chỉ eligible locked ranking được seed; (2) finals submission qua LAN vẫn preflight và fallback qualification ACTIVE chỉ khi tương thích; (3) close cutoff pin artifact/rules/map pool, retry idempotent và audit đầy đủ.
**Verification:** PostgreSQL/API integration cho seed/cutoff/RBAC; incompatible/finalized mutation rejected; `npm run typecheck --workspace @ott/platform-api`.
**Dependencies:** `P3-L06`, `P3-D01`, `P3-D03`.
**Files likely touched:** `src/platform/api/migrations/0016_finals.sql`, `src/platform/api/src/modules/finals/service.ts`, `src/platform/api/src/modules/finals/routes.ts`, `src/platform/api/tests/finals.integration.test.ts`, `docs/contracts/finals-api-v1.md`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — merged PR #41 (`datpt/feat-p3-d08-finals-control-plane`): migration `0016_finals.sql`, `modules/finals/{service,routes}.ts`, `docs/contracts/finals-api-v1.md`, `tests/finals.integration.test.ts`. Reviewer chạy `finals.integration` 3/3 ×3 trên DB mới (và 2 lần trên cùng DB) sau fix cleanup ở D31. Chưa có runtime tạo trận finals.

### [x] P3-N07 — Isolated LAN deployment và single-server local recovery

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Đóng gói topology finals không Internet trên server lab, tách participant/audience network và có backup/restore/control-plane recovery tại chỗ.
**Acceptance criteria:** (1) LAN stack chạy không Internet, worker không accessible từ máy đội; (2) restart/rejoin dùng heartbeat/capacity và ngừng admission an toàn; (3) local DB/artifact restore và rerun infra failure không duplicate result.
**Verification:** network isolation tests; restart/recovery drill; restore checksum/result integrity report và no-egress evidence.
**Dependencies:** `P3-D08`, `P3-N05`.
**Files likely touched:** `deploy/lan/compose.yml`, `deploy/lan/.env.example`, `scripts/lan-smoke.sh`, `tests/e2e/lan-recovery.test.ts`, `docs/runbooks/finals-lan.md`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-18 — Finals isolated LAN deployment và single-server recovery: Docker Compose topology `deploy/lan/compose.yml` định nghĩa 2 mạng riêng biệt (`ott-lan-internal` với `internal: true` đảm bảo No-Egress, worker không bind host port và chỉ gắn vào mạng nội bộ, CSDL postgres/redis/seaweedfs hoàn toàn cô lập khỏi mạng đội thi; `ott-lan-public` chỉ mở ingress HTTP/HTTPS cho web/api); cấu hình offline `deploy/lan/.env.example` với startup guards chế độ `finals_lan`; script kiểm tra khói tự động `scripts/lan-smoke.sh` xác thực cấu hình cô lập mạng, không mở cổng worker và ngắt kết nối WAN; test phục hồi toàn diện `tests/e2e/lan-recovery.test.ts` (11/11 pass) xác thực cô lập mạng, worker heartbeat với adaptive capacity, kiểm soát tạm dừng an toàn `pauseAdmission`, outbox generation increment khi restart, đối soát toàn vẹn SHA-256 manifest khi restore CSDL/artifact và rerun chỉ chấp nhận lỗi hạ tầng chống ghi đúp kết quả/nhánh đấu; sổ tay vận hành `docs/runbooks/finals-lan.md` chuẩn hóa toàn bộ quy trình vận hành và tiêu chí nghiệm thu Checkpoint P3-F1.

## [ ] Checkpoint P3-F1 — Finals chạy hoàn toàn trong LAN

- [ ] Finals submission/rules/schedule được pin và deterministic.
- [ ] Network isolation, restart/recovery và local restore drill pass.
- [ ] Đinh Đức Thuận duyệt trước result synchronization.

## Phase 3 — Wave 8: result sync và trình diễn

### [x] P3-D09 — Signed ResultBundle export/import idempotent

**Owner:** Phạm Tất Đạt
**Mô tả:** Xuất bracket/results/event logs với RFC 8785 manifest, SHA-256 và Ed25519; online import theo all-or-nothing versioned transaction.
**Acceptance criteria:** (1) exporter ký canonical manifest bằng private key chỉ ở offline/finals, online giữ allowlisted public key; (2) importer verify signature/checksum/completeness và từ chối toàn bundle nếu một byte sai; (3) same bundle idempotent, corrected bundle cần version/reason/audit mới và public proof metadata có `VERIFIED`.
**Verification:** API integration và AC-20 valid/tamper/wrong-key/missing-file tests; test-key fixture; no partial publication query.
**Dependencies:** `P3-D08`, `P3-N07`.
**Files likely touched:** `src/platform/api/migrations/0017_result_bundles.sql`, `src/platform/api/src/modules/result-bundles/canonical.ts`, `src/platform/api/src/modules/result-bundles/exporter.ts`, `src/platform/api/src/modules/result-bundles/importer.ts`, `src/platform/api/src/modules/result-bundles/routes.ts`, `src/platform/api/tests/result-bundles.integration.test.ts`, `docs/contracts/finals-result-bundle-v1.md`.
**Estimated scope:** M (7 files)
**Hoàn tất:** 2026-10-18 — merged PR #42 (`datpt/feat-p3-d09-result-bundle`): migration `0017_result_bundles.sql`, canonicalization RFC 8785, exporter/importer Ed25519, `GET /api/v1/public/result-bundles/:bundleId`, `tests/result-bundles.integration.test.ts` (10/10 ×3 trên DB mới, Reviewer 2026-10-18). Schema artifact (`bracket/series/matches/replays`) đề xuất ở nhánh D28, chưa merge.

### [x] P3-D10 — Finals bracket, schedule/results và verified replay public UI

**Owner:** Phạm Tất Đạt
**Mô tả:** Hiển thị snapshot online sau import cho bracket, schedule/result, proof metadata và replay finals đã publish.
**Acceptance criteria:** (1) UI giữ nguyên bracket/score breakdown từ server, không tự tính winner/advancement; (2) bundle/key/checksum/version/imported-at/`VERIFIED` và stale state rõ ràng; (3) replay chỉ xuất hiện sau verified import và publication, responsive/accessibility states đủ.
**Verification:** `npm test --workspace @ott/platform-web -- Finals`; static bundle fixtures/tamper state; browser smoke desktop/mobile/keyboard.
**Dependencies:** `P3-D09`, `P3-L05`, `P3-L06`.
**Files likely touched:** `src/platform/web/src/features/finals/api.ts`, `src/platform/web/src/features/finals/GroupStandings.tsx`, `src/platform/web/src/features/finals/FinalsSchedule.tsx`, `src/platform/web/src/features/finals/finals.test.tsx`, `src/platform/web/src/app/routes.tsx`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-20 — Finals bracket, schedule/results và verified replay public UI: Module `src/platform/web/src/features/finals/` (`api.ts`, `GroupStandings.tsx`, `FinalsSchedule.tsx`, `FinalsPage.tsx`, `index.ts`); tích hợp route `/finals` và nav link trong `App.tsx` & `routes.tsx`; đáp ứng nghiêm ngặt 3 AC: (1) render bracket 8 đội và score breakdown hoàn toàn từ server payload, không tự tính toán winner/advancement phía client; (2) hiển thị cryptographic proof metadata (`bundleId`, `bundleVersion`, `keyId`, `manifestSha256`, `importedAt`, badge `VERIFIED`) và stale state rõ ràng khi mạng lỗi hoặc data age > 90s trong khi giữ bản cập nhật cuối; (3) link replay chỉ xuất hiện cho các ván đã verified và `replayPublished: true`, ẩn khi chưa publish. Verification: `finals.test.tsx` 6/6 pass, full web suite 139/139 pass (19 test files), typecheck workspace sạch và build Vite thành công.

### [x] P3-N08 — Full event rehearsal, tamper/recovery và handoff

**Owner:** Đỗ Khôi Nguyên
**Mô tả:** Diễn tập toàn sự kiện từ finals cutoff trong LAN đến signed sync/public replay và bàn giao runbook/checklist.
**Acceptance criteria:** (1) AC-09/20 pass end-to-end; (2) worker/server restart, control-plane restore và tampered bundle đều có expected recovery/no-publication; (3) cleanup, operator roles, keys, rollback và communication checklist được xác nhận.
**Verification:** `npm run test:e2e:finals`; root test/typecheck/build/security scan từ clean checkout; rehearsal report có commit, config hashes và Thuận sign-off.
**Dependencies:** `P3-D09`, `P3-D10`, `P3-N07`.
**Files likely touched:** `tests/e2e/finals.test.ts`, `tests/e2e/finals.config.ts`, `scripts/run-finals-rehearsal.sh`, `docs/runbooks/finals-lan.md`, `docs/reports/finals-rehearsal.md`.
**Estimated scope:** M (5 files)
**Hoàn tất:** 2026-10-20 — Full event rehearsal, tamper/recovery và handoff: Tạo kịch bản diễn tập `tests/e2e/finals.test.ts` (14/14 tests) và config `tests/e2e/finals.config.ts`; điều phối script `scripts/run-finals-rehearsal.sh` tích hợp vào `package.json` (`npm run test:e2e:finals`); cập nhật sổ tay `docs/runbooks/finals-lan.md` bổ sung 4 vai trò vận hành, Ed25519 Key Ceremony, Emergency Rollback và checklist bàn giao; hoàn thiện báo cáo diễn tập `docs/reports/finals-rehearsal.md` với config hashes và form ký duyệt của Thuận. Đáp ứng đủ 3 AC: (1) AC-09/20 pass E2E xuyên suốt từ LAN cutoff 8 đội, 7 series BO3 adapter, bundle Ed25519 canonicalization RFC 8785, import proof và replay publication; (2) tamper detection chặn đứng payload giả mạo/sai chữ ký, worker crash phục hồi theo generation lease chống duplicate results, không publish dữ liệu rác; (3) bàn giao checklist, operator roles và rollback sẵn sàng.

**Giới hạn xác minh 2026-10-20:** Lệnh rehearsal chạy Vitest với dữ liệu mô phỏng (`simulateTournament`), không dựng Compose LAN, không thực thi trận finals qua worker thật và không tự chứng minh một lượt export/import giữa hai deployment. Test pass 14/14 tại `5e6994d`; Checkpoint `P3-F1`/`P3-F` vẫn mở và chưa có chữ ký duyệt độc lập. Bảng ký trong báo cáo là mẫu/hồ sơ do task tạo, không thay thế quyết định của Thuận.

## [ ] Checkpoint P3-F — Phase 3 hoàn tất

- [ ] AC-09 và AC-20 pass; full LAN → signed bundle → online publication rehearsal hoàn tất.
- [ ] Tất cả task acceptance/verification/docs sync xong; GitNexus change review không còn HIGH/CRITICAL chưa xử lý.
- [ ] Đinh Đức Thuận duyệt. Không deploy nếu chưa có yêu cầu riêng.
