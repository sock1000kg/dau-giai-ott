# @ott/match-runner

MatchRunner — điều phối **Engine API v1** và **Bot Protocol v1**: mỗi lượt hỏi đúng bot
đúng side, chấm action qua game, rồi gửi `TURN_RESULT`/`MATCH_RESULT`.

**Owner:** Phạm Tất Đạt.

## Phạm vi

Module này đã có ranh giới (P1-D02), vòng lặp trận happy path (P1-D03), policy lỗi/skip/
cleanup (P1-D04), adapter bot process NDJSON (P1-D05), timeout/cleanup (P1-D06),
event log / replay verifier (P1-D07), CLI chạy trận local (P1-D08) và adapter core thật
(P1-D09).

## Phạm vi P1-D02 — ports và fakes

`src/ports.ts` (chỉ type):

- `GamePort` — seam mỏng trên Engine API v1 §4: `create`, `listLegalActions`, `apply`,
  `skip`, `forfeit`, `result`, `hash`.
- `BotPort` — `start`, `requestAction`, `notifyStateUpdate`, `sendTurnResult`, `finish`, `stop`.
- `BotReply`, `BotReplyErrorCode`, `BotStartResult`.

`src/fakes.ts` (runtime, chỉ `node:crypto`):

- `FakeGame implements GamePort` — scripted, deterministic, **không** có luật movement/combat/goal.
- `ScriptedBot implements BotPort` — trả reply theo kịch bản, **không** có timer, **không** có child process.

## Phạm vi P1-D03 — MatchRunner happy path

`src/types.ts` (chỉ type): `MatchConfig` (`matchId`, `seed`, `game`, `limits`), `MatchPorts`
(`game` + `bots` theo side), `MatchReport` (`result`, `finalState`, `events`, `faults`),
`MatchRunnerErrorCode`.

`src/match-runner.ts`: `runMatch(config, ports)` và `MatchRunnerError`.

Thứ tự message (Bot Protocol v1 §8):

```text
INIT → X, rồi INIT → O
loop khi state PLAYING:
  legalActions rỗng  → STATE_UPDATE (legalActions: []) → bot đó, KHÔNG chờ ACTION
  ngược lại          → STATE_UPDATE → bot của state.turn, ACTION ← bot đó
  TURN_RESULT → các bot còn sống (X rồi O)
MATCH_RESULT → các bot còn sống (X rồi O)
stop X rồi stop O (luôn chạy trong finally)
```

- `turnId` **bằng** `state.turnNumber`: protocol §4 bắt đầu từ 1 và tăng đúng 1 sau mỗi
  action/skip, đúng như `turnNumber` của Engine.
- `legalActions` rỗng thì bot **vẫn nhận** `STATE_UPDATE` với `legalActions: []` qua
  `notifyStateUpdate` (send-only, chỉ bot của `state.turn`), rồi runner tự skip
  `NO_LEGAL_ACTION` **không chờ `ACTION`** (Bot Protocol v1 §5.2/§8, Engine API v1 §5). Đây
  không phải lỗi bot nên `TURN_RESULT.errorCode` là `NO_LEGAL_ACTION`, action `null`.
- `STATE_UPDATE.state` là projection `PublicGameState`: không có `gameId`, `status` luôn
  `PLAYING`, `outcome` luôn `null`.
- Lỗi bot do policy `P1-D04` xử lý (xem mục kế tiếp), không còn throw từ happy path.
  Lỗi invariant của engine vẫn throw `ENGINE_REJECTED_ACTION` / `ENGINE_NO_RESULT`;
  config lệch `maxTurns` giữa `game` và `limits` throw `INVALID_CONFIG`.
- **Message outbound không chia sẻ reference mutable**: `INIT` deep-copy `map`/`limits` cho
  từng bot, `TURN_RESULT`/`MATCH_RESULT` mỗi bot nhận một bản `structuredClone` riêng, và
  `report.faults` là object graph độc lập với `MATCH_RESULT`. Một bot double sửa message của
  mình không ảnh hưởng bot kia, `config` của caller hay `MatchReport`.

## Phạm vi P1-D04 — policy lỗi, skip và cleanup

`src/errors.ts` (thuần, không side effect): `MatchRunnerError` (chuyển từ `match-runner.ts`,
public API không đổi), `isProcessFault(code)` dựng từ `PROCESS_FAULT_CODES` của
`@ott/bot-protocol`, `zeroFaultSummary()`, `zeroFaults()`, và các helper bộ đếm
`recordRecoverable` / `recordValidAction` / `recordProcessFault` — mỗi cái nhận `FaultSummary`
và trả về object mới, không mutate.

Nguồn sự thật: Bot Protocol v1 §6 (mã lỗi và policy), ngưỡng lấy từ §3
(`maxConsecutiveFaults`, `maxTotalFaults`), khớp ADR-0002 và `docs/tai-lieu-yeu-cau.md` §7.3.

| Loại | Mã | Hành vi runner |
| --- | --- | --- |
| Lỗi lượt phục hồi | `MATCH_ID_MISMATCH`, `TURN_ID_MISMATCH`, `ILLEGAL_ACTION`, và reply `ok:false` với `BOT_TIMEOUT` \| `MALFORMED_JSON` \| `SCHEMA_VIOLATION` \| `MESSAGE_TOO_LARGE` | **không** gọi `apply`; `game.skip` đúng một lần; `total` và `consecutive` tăng đúng 1; broadcast `TURN_RESULT` (`SKIPPED`, `action null`, `errorCode` = mã lỗi) cho bot còn sống; khi chạm ngưỡng thì `game.forfeit` |
| Action hợp lệ | — | chỉ reset `recoverableConsecutive` về 0; `total` và `lastErrorCode` giữ nguyên |
| Không có nước đi | `NO_LEGAL_ACTION` | skip như trên nhưng **không** đổi bộ đếm nào, không tính là lỗi bot |
| Process fault | `BOT_SPAWN_FAILED`, `BOT_CRASHED`, `BOT_EOF`, `STDERR_LIMIT_EXCEEDED`, `RESOURCE_LIMIT_EXCEEDED`, `SANDBOX_VIOLATION` | **không** skip, **không** `TURN_RESULT` cho lượt đó; `alive = false`, `lastErrorCode` = mã; `game.forfeit` ngay; `MATCH_RESULT` chỉ tới bot còn sống |

- **Thứ tự phát hiện** (khớp §7 bước 4): `matchId` → `turnId` → legality. Reply sai cả ba thì
  vẫn báo `MATCH_ID_MISMATCH`.
- **Quy tắc "còn sống" (`alive`)**: bot chết không nhận thêm message nào (kể cả
  `TURN_RESULT` lượt sau lẫn `MATCH_RESULT`), nhưng `stop()` vẫn luôn chạy trong `finally`.
  Mỗi bot còn sống nhận **đúng một** `MATCH_RESULT` và không có message nào sau nó.
- **Diễn giải 1 — lượt chạm ngưỡng**: contract không nói rõ có gửi `TURN_RESULT` cho lượt đó
  hay không. Runner gửi `TURN_RESULT` của lượt skip trước, rồi mới `forfeit`, rồi
  `MATCH_RESULT`. Bot vẫn sống nên vẫn nhận `MATCH_RESULT`.
- **Diễn giải 2 — cả hai bot đều `start` thất bại**: contract không có quy tắc này. Runner
  forfeit side thất bại **đầu tiên theo thứ tự X, O** (X thắng khi cả hai chết) để vẫn có một
  kết quả nhất quán; khi đó không bot nào nhận `MATCH_RESULT`.
- **Exception lạ**: exception từ port (vd. `ScriptedBot` `{kind:'throw'}`, `GamePort` ném) không
  được phân xử — nó ném ra khỏi `runMatch` nguyên vẹn, `finally` vẫn stop cả hai bot.
- `faults` trong `MATCH_RESULT` và trong `MatchReport` là **bộ đếm thật**, là hai object graph
  độc lập.

## Quy tắc quan trọng

- **Failures là giá trị, không phải exception.** `start`/`requestAction` trả
  `{ ok: false, code }` để `P1-D04` map sang skip/forfeit một cách tất định; `stop()` luôn
  idempotent và an toàn trong `finally`.
- `MATCH_ID_MISMATCH`, `TURN_ID_MISMATCH`, `ILLEGAL_ACTION` **không** nằm trong
  `BotReplyErrorCode`: chỉ runner biết ID kỳ vọng và tập action hợp lệ nên tự phát hiện.
- `@ott/game-core` và `@ott/bot-protocol` chỉ được import bằng `import type` trong
  `ports.ts`/`fakes.ts`; không copy type, không copy luật chơi.
- Ranh giới (xem `src/README.md`): match-runner **không** chứa game rules, và fake
  **không** sao chép luật của `game-core` — fake chỉ mô phỏng vòng đời (§5) và thứ tự
  validation (§6).

## Hai sai khác có chủ đích so với sketch §8.2

1. **Không có `viewFor`.** Projection gửi bot là `PublicGameState` của bot-protocol, do
   runner dựng trong `P1-D03`, không phải do game dựng.
2. **Có thêm `listLegalActions`, `forfeit`, `hash`.** Engine API §5 yêu cầu runner skip
   bằng `NO_LEGAL_ACTION` khi hết nước đi (không chờ bot), §5 yêu cầu process fault
   forfeit, và §8/verify D07 cần hash.

## Phạm vi P1-D05 — BotProcess NDJSON adapter

`src/line-buffer.ts`: bộ đệm dòng NDJSON thuần túy (`LineBuffer`, `createLineBuffer`), không I/O, không import process hay file system:
- Tách dòng nghiêm ngặt theo LF (`0x0A`); không strip CR (JSON tự chấp nhận trailing whitespace).
- Thao tác trực tiếp trên byte; chỉ giải mã UTF-8 khi đã đủ một dòng hoàn chỉnh (ký tự multi-byte split qua nhiều chunk giải mã chính xác).
- Quản lý kích thước theo `maxLineBytes` (không tính LF): nếu dòng vượt giới hạn, byte đang chờ lập tức bị drop (bộ nhớ không vượt quá giới hạn, `pendingBytes` về 0), chuyển sang trạng thái discarding cho tới LF kế tiếp và phát ra đúng một event `oversize`. Dòng sau đó parse bình thường.
- `flushOnEnd()` drop phần dòng chưa hoàn chỉnh khi stream đóng (giao thức bắt buộc LF).

`src/bot-process.ts`: hiện thực `BotPort` điều phối child process qua stdin/stdout:
- **Options (`BotProcessOptions`)**: `executable`, `args`, `cwd`, `env` (mặc định môi trường tối thiểu `PATH`, không kế thừa secrets mù quáng), `validator` (`ProtocolValidator` được inject từ caller; CLI tải schema từ đĩa trong D08), `maxMessageBytes`, `onStderr`, `onDiagnostic`.
- **Quy tắc no-shell**: luôn dùng `spawn` với `shell: false` và mảng `args` nguyên bản, không dùng shell string, không import hay gọi `exec`/`execSync`.
- **Request window & unexpected lines**:
  - Ghi `STATE_UPDATE` qua stdin và await flush trước khi mở request window.
  - Dòng hoàn chỉnh đầu tiên nhận được trong request window sẽ phân xử kết quả cho request đó và đóng window ngay lập tức.
  - Các dòng stdout tới ngoài request window (hoặc đến trước khi window mở, hoặc dòng dư thừa trong cùng chunk) đều bị discard và ghi nhận qua counter `unexpectedLines` cùng callback `onDiagnostic({ kind: 'UNEXPECTED_MESSAGE' })`; chúng không bao giờ trả lời cho request kế tiếp.
- **Bảng ánh xạ lỗi lượt**:
  | Điều kiện | Kết quả adapter (`BotReply`) |
  | --- | --- |
  | Dòng vượt quá `maxMessageBytes` / `oversize` | `{ ok: false, code: 'MESSAGE_TOO_LARGE' }` |
  | Không parse được JSON hoặc parse ra không phải plain object (vd: array, primitive, null) | `{ ok: false, code: 'MALFORMED_JSON' }` |
  | Object không khớp schema (`!validator.isProtocolMessage(val)`) | `{ ok: false, code: 'SCHEMA_VIOLATION' }` |
  | Message giao thức hợp lệ nhưng `type !== 'ACTION'` (vd: bot tự gửi `INIT`) | `{ ok: false, code: 'SCHEMA_VIOLATION' }` |
  | Hợp lệ và `type === 'ACTION'` | `{ ok: true, message }` |
- **Điều adapter KHÔNG kiểm tra**: adapter không kiểm tra `matchId`, `turnId` hay tính hợp lệ của action (`legalActions`). Những kiểm tra này thuộc về Runner (P1-D04) vì chỉ runner mới biết ID kỳ vọng và tập nước đi hợp lệ. Nếu bot gửi sai matchId/turnId/illegal action, adapter vẫn chuyển qua dạng `{ ok: true, message }`.
- **Tách bạch stderr**: dữ liệu stderr không đi vào `LineBuffer`, chỉ chuyển tới `onStderr` và bộ đếm `stderrBytes`. Stderr có cấu trúc JSON cũng không bao giờ trở thành reply của giao thức.
- **Phân định phạm vi D05 / D06**:
  - D05 chịu trách nhiệm spawn bằng argv, framing dòng NDJSON, giới hạn kích thước, validate cú pháp/schema, request window, discard unsolicited lines, và tách biệt stderr.
  - D06 hoàn thiện timeout bằng monotonic clock, late-reply discard sau timeout, mã lỗi thoát/EOF/crash/spawn failure đầy đủ, quota stderr (`STDERR_LIMIT_EXCEEDED`), và `stop()` hoàn chỉnh không để lại PID/timer/listener.

## Phạm vi P1-D06 — BotProcess timeout và process cleanup

`src/process-errors.ts`: hàm thuần túy `classifyExit({ code, signal, phase })` phân loại lỗi tiến trình không I/O, không import `child_process`:
- **Bảng phân loại thoát tiến trình**:
  | Phase | Mã thoát / Tín hiệu / Kích hoạt | Kết quả (`ProcessFaultCode`) | Ghi chú |
  | :--- | :--- | :--- | :--- |
  | `starting` | spawn error (ENOENT...), exit/close trước/khi ghi INIT, startup timeout | `BOT_SPAWN_FAILED` | Forfeit ngay tại startup |
  | `running` | exit non-zero (`code !== 0`) hoặc bị kill bởi tín hiệu (`signal !== null`) | `BOT_CRASHED` | Tiến trình crash bất thường |
  | `running` | exit 0 (`code === 0`), stdout `end`, stdin `EPIPE`/`close` | `BOT_EOF` | Tiến trình đóng stream hoặc thoát sạch |
  | `stopping` | Bất kỳ mã thoát hay tín hiệu nào sau khi gọi `stop()` | `null` | Dừng sạch có chủ đích bởi runner |

- **Diễn giải contract**:
  - Startup timeout (quá `startupTimeoutMs` mà INIT chưa ghi/flush xong) → ánh xạ thành `BOT_SPAWN_FAILED` (contract không có mã riêng cho startup timeout).
  - Hủy lượt (abort) khi `stop()` được gọi lúc một request đang chờ → settle request dở dang với `BOT_EOF`.

`src/bot-process.ts`: hoàn thiện quản lý vòng đời, timeout và cleanup cho `BotProcess`:
- **Monotonic Timeouts sau khi write**:
  - `startupTimeoutMs` (mặc định 5000 ms theo baseline §3): tính từ khi spawn tới khi `INIT` được ghi và flush xong. Quá hạn sẽ kill tiến trình và báo `BOT_SPAWN_FAILED`.
  - `turnTimeoutMs`: được tính bằng monotonic clock (`now()`, mặc định `performance.now()`, có thể inject trong test). Deadline `now() + turnTimeoutMs` được chốt **sau** khi write callback của `STATE_UPDATE` hoàn tất; không trừ hao thời gian serialize/write của runner.
  - Settle đúng một lần (`settlePendingRequest` guard) với kết quả đầu tiên xuất hiện: message hợp lệ từ stdout, `BOT_TIMEOUT`, process fault, hoặc abort qua `stop()`. Khi settle, timer của lượt được xóa ngay lập tức.
  - Tuyệt đối không đọc bất kỳ clock, timestamp hay duration nào từ bot gửi lên.
- **Quy tắc xử lý late reply**:
  - Lưu tập các `turnId` đã timeout (`timedOutTurnIds`).
  - Dòng hợp lệ kiểu `ACTION` gửi về muộn có `turnId` nằm trong tập đã timeout bị loại bỏ như `UNEXPECTED_MESSAGE` và request window cho lượt hiện tại vẫn mở — không làm settle sai lượt sau hay gây `TURN_ID_MISMATCH` oan uổng.
  - Các `turnId` lạ khác không thuộc tập timeout vẫn được chuyển nguyên vẹn lên runner để phân xử.
- **Sticky fault & send-only methods**:
  - Lỗi tiến trình đầu tiên (`ProcessFaultCode`) được ghi nhận vĩnh viễn vào getter `fault`.
  - Sau khi có fault, mọi `requestAction` kế tiếp trả ngay `{ ok: false, code: fault }`.
  - Các phương thức một chiều (`notifyStateUpdate`, `sendTurnResult`, `finish`) không bao giờ ném lỗi và không cố ghi nếu tiến trình đã chết/fault — chúng luôn resolve an toàn. Lỗi ghi (`EPIPE`, stdin destroyed) chuyển thành sticky fault `BOT_EOF` thay vì reject.
- **Hạn mức stderr (`STDERR_LIMIT_EXCEEDED`)**:
  - Đo tổng số byte stderr (`stderrBytes`).
  - Chỉ forward cho `onStderr` tối đa `maxStderrBytes` (mặc định 1 MB theo baseline §3).
  - Khi vượt quota, đặt sticky fault `STDERR_LIMIT_EXCEEDED`, settle request đang chờ và kill tiến trình ngay.
- **Quy trình `stop()` (close) idempotent & leo thang tuần tự**:
  - Gọi đồng thời hoặc tuần tự nhiều lần đều an toàn và trả về cùng một Promise instance.
  - Đặt `phase = 'stopping'`, settle request đang dở dang với `BOT_EOF`.
  - Chuỗi ngắt tiến trình: `stdin.end()` → đợi `stopGraceMs` (mặc định 500 ms) → gửi `SIGTERM` → đợi tiếp `stopGraceMs` → gửi `SIGKILL`.
  - Sau khi tiến trình kết thúc: xóa toàn bộ timers trong class, gỡ bỏ toàn bộ listeners trên child process và các stream stdio (`removeAllListeners`), destroy stdio streams.
  - Không sử dụng `unref()` tricks để che giấu rò rỉ tài nguyên; cung cấp `debugHandles()` phục vụ kiểm thử assertion 0 listener / 0 timer.
- **Không thêm bất kỳ runtime dependency mới nào**: module tiếp tục chỉ phụ thuộc các package nội bộ và Node.js built-ins.

## Phạm vi P1-D07 — event log và replay verifier

`src/event-log.ts`: format artifact trận đấu của runner, serializer/parser, ghi file atomic:
- Format: `format: 'ott.match-event-log'`, `formatVersion: 1`. (Parser xác minh chính xác giá trị này và `protocolVersion: 1`).
- Helpers `cloneEvent` và `cloneEventLog` được export công khai (qua `index.ts`) hỗ trợ deep copy an toàn.
- Cấu trúc:
  - `header`: `format`, `formatVersion`, `matchId`, `protocolVersion`, `engineVersion`, `seed`, `game` (đầy đủ config và map spawns), `limits`.
  - `entries`: mảng các `EventLogEntry`, mỗi entry đại diện cho **một transition** thành công: `index`, `input` (`TransitionInput`: `apply` / `skip` / `forfeit`), `events` (engine events nguyên bản), `revision` sau transition, `stateHash` sau transition (`game.hash(state)`).
  - `footer`: `result` (`GameResult` gồm `finalStateHash`), `faults` (bộ đếm thật X và O), `entryCount` (số lượng entry).
- **Tại sao log-owned `index`**: Engine API v1 không quy định `sequence` bắt đầu từ đâu hay có gap-free không (fake dùng revision/revision+1), nên tính liên tục `1..n` được bảo đảm bởi chính `index` của log; các field của engine được giữ nguyên để replay kiểm tra.
- **Atomic write** (`writeEventLogFile`): ghi ra `${path}.partial` cùng thư mục rồi `rename` đè lên `path`. Nếu có lỗi, file `.partial` được xóa (best-effort) và ném lỗi ra; không bao giờ để lại file cụt ở `path`. Tên file tạm tất định, không chứa clock hay ngẫu nhiên.
- **Không bao giờ log**: mã nguồn bot, argv, env, stderr hoặc raw stdout — chỉ lưu các kiểu dữ liệu khai báo trong contract.
- **Ghi chú phạm vi §13.1**: §13.1 trong tài liệu yêu cầu mô tả tập event sản phẩm phong phú hơn (`MATCH_STARTED`, `TURN_STARTED`, `ACTION_RECEIVED`, `BOT_FAULT`, snapshot...). Những thứ đó thuộc sản phẩm replay Phase 2. Engine API v1 đã khóa chỉ phát ra `ACTION_APPLIED | TURN_SKIPPED | MATCH_FINISHED`. P1-D07 ghi đúng các engine events đó kèm runner inputs để replay tái hiện trọn vẹn, có version để Phase 2 mở rộng thành v2 mà không phá vỡ reader v1.

`src/replay.ts`: hàm xác minh thuần trong bộ nhớ `verifyReplay(log, game): ReplayVerdict`:
- Thuần túy, không I/O, không import runtime `@ott/game-core` hay `node:fs`, chỉ thao tác qua `GamePort`.
- Mã lỗi verifier (`ReplayIssueCode`):
  - `SEQUENCE_GAP`: `entry.index` không liên tục 1..n hoặc `footer.entryCount !== entries.length`.
  - `ENGINE_REJECTED`: `GamePort` từ chối input đã ghi (`ok: false`).
  - `EVENT_MISMATCH`: replayed events khác logged events (bắt được việc sửa/đổi thứ tự event).
  - `REVISION_MISMATCH`: state revision sau transition khác revision đã ghi.
  - `STATE_HASH_MISMATCH`: hash state tính lại khác `stateHash` đã ghi.
  - `EXTRA_ENTRIES`: còn entries sau khi state đã `FINISHED`.
  - `MISSING_ENTRIES`: log kết thúc khi state vẫn đang `PLAYING`.
  - `RESULT_MISMATCH`: `footer.result` khác `game.result(finalState)`.
  - `FINAL_HASH_MISMATCH`: `footer.result.finalStateHash` khác `game.hash(finalState)`.

## Phạm vi P1-D08 — CLI chạy trận local

Composition root và command-line interface cho MatchRunner (`src/config.ts`, `src/cli.ts`):
- **Phân tách argv và executable**: Nhận lệnh thực thi (`--bot-x`, `--bot-o`) và từng tham số dòng lệnh (`--bot-x-arg`, `--bot-o-arg`) riêng biệt qua `node:util` `parseArgs` (`strict: true`). Không sử dụng chuỗi shell; mọi đối số được truyền nguyên văn (verbatim), giữ nguyên thứ tự và không bị shell expansion hay split bởi khoảng trắng.
- **Hợp đồng xuất nhập (stdout/stderr contract)**:
  - `stdout`: Đúng **một dòng** JSON chứa kết quả trận đấu khi kết thúc với mã thoát 0 (hoặc in văn bản trợ giúp khi có `--help`). Định dạng JSON có thứ tự khóa cố định: `matchId`, `winnerSide`, `reason`, `turnCount`, `finalStateHash`, `forfeitedSide`, `faults` (bộ đếm thật X và O), `eventLog` (đường dẫn tuyệt đối).
  - `stderr`: Dành riêng cho thông tin chẩn đoán, dòng lỗi cấu hình, `stderr` của từng bot chuyển tiếp với tiền tố `[bot X] ` / `[bot O] `, thông báo chẩn đoán bot (`[bot X] diagnostic: ...`), và dòng tóm tắt kết quả trận đấu cho người dùng.
- **Mã thoát (Exit codes)**:
  - `0`: Trận đấu hoàn tất và sinh kết quả hợp lệ (bao gồm cả trường hợp bot phạm lỗi bị skip hoặc forfeit).
  - `1`: Lỗi hạ tầng hoặc lỗi runtime ngăn cản trận đấu hoàn tất (schema không đọc được, không ghi được event log, hoặc lỗi bất biến của game engine).
  - `2`: Lỗi cú pháp dòng lệnh hoặc cấu hình không hợp lệ (thiếu cờ bắt buộc, cờ lạ, số nguyên không hợp lệ).
- **Ranh giới và dependency injection**:
  - `runCli` nhận `io: { stdout, stderr }` và `deps?: Partial<CliDeps>` (`createGame`, `createBot`, `readFile`, `writeEventLog`).
  - Cho phép inject `ScriptedBot` và double trong unit test mà không spawn tiến trình con.
  - `core-adapter.ts` là module duy nhất import runtime từ public API `@ott/game-core`; `cli.ts`/`config.ts` không chứa luật game và không import trực tiếp `node:child_process` (chỉ `bot-process.ts` quản lý tiến trình con).
  - Import `cli.ts` không gây bất kỳ tác dụng phụ (side effect) nào; khối thực thi entrypoint chỉ kích hoạt khi tệp được chạy trực tiếp.
- **P1-D09 — adapter core thật**:
  - `core-adapter.ts` forward trực tiếp `createGame`, `listLegalActions`, `applyAction`, `skipTurn`, `forfeitGame`, `getGameResult` và `hashGameState` từ public API `@ott/game-core`; MatchRunner không có bản sao luật game.
  - CLI dùng `CoreGameAdapter` cùng `DEFAULT_MAP` 18 quân của game-core. `FakeGame` chỉ còn là double cho unit test.
  - `tests/core-adapter.integration.test.ts` chạy một trận qua core thật và `ScriptedBot`, kiểm tra kết quả, event log và final hash.

### Bảng cờ dòng lệnh CLI (Flags)

| Cờ | Ý nghĩa | Quy tắc / Mặc định |
| --- | --- | --- |
| `--bot-x <executable>` | Lệnh thực thi bot X | Bắt buộc, không rỗng |
| `--bot-o <executable>` | Lệnh thực thi bot O | Bắt buộc, không rỗng |
| `--bot-x-arg <arg>` | Một đối số cho bot X (lặp lại được) | Không mặc định, giữ nguyên thứ tự và giá trị nguyên văn |
| `--bot-o-arg <arg>` | Một đối số cho bot O (lặp lại được) | Không mặc định, giữ nguyên thứ tự và giá trị nguyên văn |
| `--out <path>` | Đường dẫn tệp event log đầu ra | Bắt buộc, không rỗng |
| `--match-id <id>` | Định danh trận đấu | Mặc định: `local-match`; mẫu `^[A-Za-z0-9][A-Za-z0-9._:-]*$`, 1–128 ký tự |
| `--seed <s>` | Chuỗi seed gửi trong INIT | Mặc định: `'0'` |
| `--max-turns <n>` | Số lượt tối đa trước khi hòa (áp dụng cho cả `game` và `limits`) | Mặc định: `200` (`DEFAULT_LIMITS.maxTurns`); số nguyên ≥ 1 |
| `--turn-timeout-ms <n>` | Thời hạn phản hồi mỗi lượt (ms) | Mặc định: `3000` (`DEFAULT_LIMITS.turnTimeoutMs`); số nguyên ≥ 1 |
| `--startup-timeout-ms <n>` | Thời hạn khởi động bot (ms) | Mặc định: `5000` (`DEFAULT_LIMITS.startupTimeoutMs`); số nguyên ≥ 1 |
| `--schema <path>` | Đường dẫn tệp schema JSON của protocol | Mặc định: `docs/contracts/bot-protocol-v1.schema.json` giải quyết theo đường dẫn module |
| `-h`, `--help` | Hướng dẫn sử dụng và thoát mã 0 | — |

### Ví dụ chạy trận với bot Python của Nguyên

```bash
# Sử dụng --silent để npm không in banner lên stdout, giữ stdout sạch chỉ chứa JSON kết quả:
npm --prefix src/match-runner run --silent match -- \
  --bot-x python3 --bot-x-arg -I --bot-x-arg -u --bot-x-arg "$PWD/src/bots/python/first_legal_bot.py" \
  --bot-o python3 --bot-o-arg -I --bot-o-arg -u --bot-o-arg "$PWD/src/bots/python/capture_first_bot.py" \
  --max-turns 10 --out /tmp/match.json
```

## Lệnh

```bash
npm ci
npm run typecheck
npm test
npm --workspace @ott/match-runner test -- tests/core-adapter.integration.test.ts
npm --workspace @ott/match-runner run match -- --help
npm run build
```

> Dùng Node `^22.12.0` theo workspace root; `engine-strict=true` nên không bỏ qua
> kiểm tra engine khi cài dependency.

Runtime dependency chỉ là hai package workspace nội bộ (`@ott/game-core`, `@ott/bot-protocol`);
không có thư viện runtime ngoài nào khác. Công cụ chạy dòng lệnh `tsx` (pin chính xác 4.23.15)
được đặt trong root `devDependencies` theo convention §2.
