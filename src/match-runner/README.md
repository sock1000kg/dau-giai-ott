# @ott/match-runner

MatchRunner — điều phối **Engine API v1** và **Bot Protocol v1**: mỗi lượt hỏi đúng bot
đúng side, chấm action qua game, rồi gửi `TURN_RESULT`/`MATCH_RESULT`.

**Owner:** Phạm Tất Đạt.

## Phạm vi P1-D02

Module này ở giai đoạn ports + fakes, chưa có vòng lặp trận:

`src/ports.ts` (chỉ type):

- `GamePort` — seam mỏng trên Engine API v1 §4: `create`, `listLegalActions`, `apply`,
  `skip`, `forfeit`, `result`, `hash`.
- `BotPort` — `start`, `requestAction`, `sendTurnResult`, `finish`, `stop`.
- `BotReply`, `BotReplyErrorCode`, `BotStartResult`.

`src/fakes.ts` (runtime, chỉ `node:crypto`):

- `FakeGame implements GamePort` — scripted, deterministic, **không** có luật movement/combat/goal.
- `ScriptedBot implements BotPort` — trả reply theo kịch bản, **không** có timer, **không** có child process.

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
npm --prefix src/match-runner run build
```

> Máy có Node khác `^22.12.0` (ví dụ Node 24): cài bằng
> `npm --prefix src/match-runner install --engine-strict=false`.

Runtime dependency chỉ là hai module `file:` (`@ott/game-core`, `@ott/bot-protocol`); không
có thư viện runtime nào khác.
