# @ott/match-runner

MatchRunner — điều phối **Engine API v1** và **Bot Protocol v1**: mỗi lượt hỏi đúng bot
đúng side, chấm action qua game, rồi gửi `TURN_RESULT`/`MATCH_RESULT`.

**Owner:** Phạm Tất Đạt.

## Phạm vi

Module này đã có ranh giới (P1-D02) và vòng lặp trận happy path (P1-D03).

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
  TURN_RESULT → X rồi O (cùng một object)
MATCH_RESULT → X rồi O
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
- **Lỗi bot hiện throw `UNHANDLED_BOT_FAILURE`** (reply `ok:false`, sai `matchId`, sai
  `turnId`, action không hợp lệ, `start` thất bại) — `P1-D04` sẽ thay bằng policy
  skip/forfeit. Lỗi invariant của engine throw `ENGINE_REJECTED_ACTION` /
  `ENGINE_NO_RESULT`; config lệch `maxTurns` giữa `game` và `limits` throw `INVALID_CONFIG`.
- `faults` trong `MATCH_RESULT` và `MatchReport` luôn là số 0 ở D03; bộ đếm là của D04.
- **Message outbound không chia sẻ reference mutable**: `INIT` deep-copy `map`/`limits` cho
  từng bot, `TURN_RESULT`/`MATCH_RESULT` mỗi bot nhận một bản `structuredClone` riêng, và
  `report.faults` là object graph độc lập với `MATCH_RESULT`. Một bot double sửa message của
  mình không ảnh hưởng bot kia, `config` của caller hay `MatchReport`.

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

## Lệnh

```bash
npm --prefix src/match-runner ci
npm --prefix src/match-runner run typecheck
npm --prefix src/match-runner test
npm --prefix src/match-runner test -- tests/ports.test.ts
npm --prefix src/match-runner test -- tests/happy-path.test.ts
npm --prefix src/match-runner run build
```

> Máy có Node khác `^22.12.0` (ví dụ Node 24): cài bằng
> `npm --prefix src/match-runner install --engine-strict=false`.

Runtime dependency chỉ là hai module `file:` (`@ott/game-core`, `@ott/bot-protocol`); không
có thư viện runtime nào khác.
