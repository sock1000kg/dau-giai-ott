# @ott/match-runner

MatchRunner — điều phối **Engine API v1** và **Bot Protocol v1**: mỗi lượt hỏi đúng bot
đúng side, chấm action qua game, rồi gửi `TURN_RESULT`/`MATCH_RESULT`.

**Owner:** Phạm Tất Đạt.

## Phạm vi

Module này đã có ranh giới (P1-D02), vòng lặp trận happy path (P1-D03), policy lỗi/skip/
cleanup (P1-D04) và event log / replay verifier (P1-D07).

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

## Lệnh

```bash
npm --prefix src/match-runner ci
npm --prefix src/match-runner run typecheck
npm --prefix src/match-runner test
npm --prefix src/match-runner test -- tests/ports.test.ts
npm --prefix src/match-runner test -- tests/happy-path.test.ts
npm --prefix src/match-runner test -- tests/error-paths.test.ts
npm --prefix src/match-runner test -- tests/event-log.test.ts tests/replay.test.ts
npm --prefix src/match-runner run build
```

> Máy có Node khác `^22.12.0` (ví dụ Node 24): cài bằng
> `npm --prefix src/match-runner install --engine-strict=false`.

Runtime dependency chỉ là hai module `file:` (`@ott/game-core`, `@ott/bot-protocol`); không
có thư viện runtime nào khác.
