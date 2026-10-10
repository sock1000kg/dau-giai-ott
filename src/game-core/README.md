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

Chưa có (các task sau):

- `P1-L02`: domain types/`GameState`/`createGame` đã khóa và map types.
- `P1-L05`: `listLegalActions`/`applyAction` theo `side`.
- `P1-L06`: `skipTurn`, `maxTurns`, `GameResult` (`FORFEIT`/`TURN_LIMIT`).
- `P1-L07`: transition event và `finalStateHash`.

## API baseline

| Export | Mô tả |
| --- | --- |
| `createInitialGame()` | State ban đầu: X đi trước, 18 quân deep-copy, `outcome = null`. |
| `getLegalMoves(state, pieceId)` | Ô đích hợp lệ của một quân, sort theo `row` rồi `col`. |
| `applyMove(state, side, pieceId, to)` | Áp dụng nước đi; không mutate input; trả `MoveResult`. |
| `beats(attacker, defender)` | Quan hệ ăn quân Búa–Bao–Kéo. |
| `samePosition(a, b)` | So sánh hai tọa độ. |
| `GOALS`, `BEATS`, `BOARD_WIDTH`, `BOARD_HEIGHT`, `ENGINE_VERSION` | Hằng số luật/map. |

`applyMove` trả mã lỗi theo đúng thứ tự Engine API v1 §6:
`GAME_NOT_PLAYING` → `NOT_YOUR_TURN` → `PIECE_NOT_FOUND` → `NOT_YOUR_PIECE` → `ILLEGAL_MOVE`.
Nước đi bị từ chối trả đúng reference `state` ban đầu và không đổi bàn cờ.

## Ranh giới

- Không import process, timer, clock, environment, filesystem, network, random, DB, UI hay framework.
- Không mutate object đầu vào; mọi transition trả object mới.
- Không chứa movement/combat/win ở nơi khác (adapter Human-vs-Human chỉ map `playerId → side`).

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
