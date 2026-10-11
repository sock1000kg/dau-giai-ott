# @ott/game-core

Luật game và Engine API cho OTTv2. Module thuần TypeScript, deterministic, không phụ thuộc
I/O, thời gian hay framework. Đây là **nguồn sự thật duy nhất** về luật game; bot chỉ đề xuất
hành động và Engine luôn validate lại.

## Nguồn hành vi (provenance)

- Nguồn luật: [`docs/tai-lieu-yeu-cau.md`](../../docs/tai-lieu-yeu-cau.md) mục 6 (`game-rules`).
- Đối chiếu hành vi tham chiếu: `sock1000kg/rock-paper-scissor` tại commit
  `2956f1601365274eb34d623a9c908900bf43baab`.
- Commit tham chiếu chưa có LICENSE đã xác minh, nên module **triển khai lại** hành vi đã đặc tả;
  **không** sao chép source, tạo submodule hay đóng gói code tham chiếu.

## Phạm vi P1-L01 (behavior baseline)

Đã có:

- Khởi tạo quân (spawn) đúng 18 quân và vị trí theo đặc tả mục 6.2.
- Di chuyển 8 hướng (như quân vua), chặn biên, chặn quân cùng phe.
- Ăn quân Búa–Bao–Kéo; cùng loại chặn nhau; quân yếu không tự sát.
- Hai điều kiện thắng: `REACHED_GOAL` (ưu tiên) và `ELIMINATED_ALL_PIECES`.

## P1-L02 — Engine API đã khóa (domain + map types)

- `types.ts` chứa toàn bộ domain types theo `docs/contracts/engine-api-v1.md`:
  `PlayerSide`, `PieceType`, `GameStatus`, `Position`, `Piece`, `MapRef`,
  `MapDefinition`, `GameConfig`, `GameAction`, `GameResultReason`, `GameOutcome`,
  `GameResult`, `GameState`, `ActionErrorCode`, `SkipReason`, `ProcessFaultCode`,
  `GameEvent`, `TransitionResult`.
- `DEFAULT_MAP: MapDefinition` — map `default` v1, 9×9, obstacles rỗng, 18 spawns,
  goals `X → i9`, `O → a1`.
- `createGame(config): GameState` — khởi tạo deterministic, **deep-copy** spawns,
  `map` chỉ giữ projection `MapRef` (mapId/version/checksum).

## Phạm vi P1-L05–P1-L08 (Engine API đầy đủ)

- `P1-L05`: `listLegalActions`, `applyAction`.
- `P1-L06`: `skipTurn`, `forfeitGame`, `getGameResult`, turn limit (`maxTurns`).
- `P1-L07`: transition event (`events.ts`) và `finalStateHash` (`hash.ts`).
- `P1-L08`: regression + invariants + tài liệu này.

## Public API

| Export | Mô tả |
| --- | --- |
| `createGame(config)` | State ban đầu deterministic: X đi trước, `turnNumber 1`, `turnCount 0`, `revision 0`, deep-copy spawns, `map` là `MapRef`. |
| `listLegalActions(state, side)` | Action hợp lệ của `side`; rỗng nếu game kết thúc hoặc `side` không phải lượt. Order: `pieceId` → `to.row` → `to.col`. |
| `applyAction(state, side, action)` | Áp dụng action; trả `TransitionResult`. Không mutate input. |
| `skipTurn(state, side, reason)` | Bỏ lượt; `reason` thành `TURN_SKIPPED` event. |
| `forfeitGame(state, forfeitedSide, fault)` | Kết thúc ngay bằng `FORFEIT`; **không** tăng `turnCount`, `revision` +1. |
| `getGameResult(state)` | `GameResult` (winner/draw, reason, `turnCount`, `forfeitedSide`, `finalStateHash`) hoặc `null` khi đang chơi. |
| `hashGameState(state)` | SHA-256 hex (lowercase) trên projection rule-state, canonical hoá theo RFC 8785. |
| `canonicalSerialize(value)` | JSON canonical (sort key, không whitespace) cho integer/string/boolean/null/array/object. |
| `isReplaySafeEvent(event)` | Kiểm tra event chỉ chứa field replay-safe (không clock/process). |
| `beats(a, b)`, `samePosition(a, b)`, `GOALS`, `BEATS`, `DEFAULT_MAP`, `BOARD_WIDTH`, `BOARD_HEIGHT`, `ENGINE_VERSION` | Luật, map và hằng số. |

`applyAction` trả mã lỗi đầu theo đúng thứ tự Engine API v1 §6:
`GAME_NOT_PLAYING` → `NOT_YOUR_TURN` → `PIECE_NOT_FOUND` → `NOT_YOUR_PIECE` → `ILLEGAL_MOVE`.

## Invariants (test ở `tests/invariants.test.ts`)

1. **Không mutate input**: mọi API trả object mới; state gốc giữ nguyên.
2. **Deterministic**: cùng input → cùng state, event sequence và hash.
3. **Ordering**: `pieces` luôn sort theo `id`; `listLegalActions` sort theo `pieceId`/`row`/`col`.
4. **Counters**: action/skip hợp lệ tăng `turnCount` và `revision` đúng 1; `forfeitGame` chỉ tăng `revision`.
5. **Win priority**: `REACHED_GOAL` → `ELIMINATED_ALL_PIECES` → `TURN_LIMIT`.
6. **Replay-safe events**: không timestamp, random hay metadata process.
7. **Hash**: cùng rule-state (kể cả khác `gameId` hay thứ tự quân) → cùng hash.

## Ranh giới — phần core KHÔNG chịu trách nhiệm

- **Không** đọc thời gian, environment, filesystem, network hay random; chỉ dùng `node:crypto`
  cho SHA-256 (deterministic, không I/O).
- **Không** quản lý fault counter của bot và không biết bot là process nào (thuộc Runner).
- **Không** chứa transport, timeout, process hay line-buffering (thuộc MatchRunner/BotProcess).
- Không mutate input, không giữ state ẩn toàn cục; mọi transition là hàm thuần trên `GameState`.
- Adapter Human-vs-Human chỉ map `playerId → side` rồi gọi `applyAction`; **không** chứa luật.


## Lệnh

```bash
npm --prefix src/game-core install
npm --prefix src/game-core run typecheck
npm --prefix src/game-core test
npm --prefix src/game-core run test:coverage
npm --prefix src/game-core run build
```

> Ghi chú môi trường: `.npmrc` bật `engine-strict=true` và `package.json` pin Node `^22.12.0`.
> Trên máy có Node khác (ví dụ Node 24), cài dependency cho verification local bằng
> `npm --prefix src/game-core install --engine-strict=false`.
