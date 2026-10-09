# Engine API v1

> Status: **LOCKED**
>
> Approval: `HIGH RECOMMEND` — tự động duyệt bởi Đinh Đức Thuận
>
> Owner triển khai: Long Trần
>
> Quyết định: `docs/decisions/0002-phase-1-engine-and-bot-protocol-v1.md`

## 1. Mục tiêu và ranh giới

Engine API v1 là nguồn sự thật duy nhất cho game rules. API phục vụ Human-vs-Human, MatchRunner và replay verifier qua cùng một state machine.

Core:

- Là TypeScript thuần và deterministic.
- Không đọc thời gian hệ thống, environment, filesystem, network hoặc random không seed.
- Không import React, Fastify, BullMQ, Docker, child process hoặc protocol transport.
- Không mutate object đầu vào.
- Không biết bot là process nào và không tự quản lý fault counter.

## 2. Nguồn hành vi

- Luật chuẩn: mục 6 trong `docs/tai-lieu-yeu-cau.md`.
- Hành vi tham chiếu: commit `2956f1601365274eb34d623a9c908900bf43baab` của `sock1000kg/rock-paper-scissor`.
- Do commit tham chiếu không có LICENSE đã xác minh, implementation mới chỉ đối chiếu hành vi; không copy source.

## 3. Domain types

```ts
export type PlayerSide = 'X' | 'O';
export type PieceType = 'ROCK' | 'PAPER' | 'SCISSORS';
export type GameStatus = 'PLAYING' | 'FINISHED';

export interface Position {
  readonly col: number; // integer 0..8
  readonly row: number; // integer 0..8
}

export interface Piece {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly type: PieceType;
  readonly position: Position;
}

export interface MapRef {
  readonly mapId: string;
  readonly version: number;
  readonly checksum: string; // lowercase SHA-256 hex
}

export interface MapDefinition extends MapRef {
  readonly schemaVersion: 1;
  readonly width: 9;
  readonly height: 9;
  readonly obstacles: readonly Position[];
  readonly spawns: readonly Piece[];
  readonly goals: Readonly<Record<PlayerSide, Position>>;
}

export interface GameConfig {
  readonly gameId: string;
  readonly engineVersion: string;
  readonly map: MapDefinition;
  readonly maxTurns: number; // Phase 1 default: 200
}

export interface GameAction {
  readonly pieceId: string;
  readonly to: Position;
}

export type GameResultReason =
  | 'REACHED_GOAL'
  | 'ELIMINATED_ALL_PIECES'
  | 'FORFEIT'
  | 'TURN_LIMIT';

export interface GameOutcome {
  readonly winnerSide: PlayerSide | null;
  readonly reason: GameResultReason;
  readonly turnCount: number;
  readonly forfeitedSide: PlayerSide | null;
}

export interface GameResult extends GameOutcome {
  readonly finalStateHash: string;
}

export interface GameState {
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly gameId: string;
  readonly map: MapRef;
  readonly status: GameStatus;
  readonly turn: PlayerSide;
  readonly turnNumber: number;
  readonly turnCount: number;
  readonly revision: number;
  readonly maxTurns: number;
  readonly pieces: readonly Piece[];
  readonly outcome: GameOutcome | null;
}
```

## 4. Public API

```ts
export type ActionErrorCode =
  | 'GAME_NOT_PLAYING'
  | 'NOT_YOUR_TURN'
  | 'PIECE_NOT_FOUND'
  | 'NOT_YOUR_PIECE'
  | 'ILLEGAL_MOVE';

export type SkipReason =
  | 'NO_LEGAL_ACTION'
  | 'BOT_TIMEOUT'
  | 'MALFORMED_JSON'
  | 'SCHEMA_VIOLATION'
  | 'MATCH_ID_MISMATCH'
  | 'TURN_ID_MISMATCH'
  | 'MESSAGE_TOO_LARGE'
  | 'ILLEGAL_ACTION';

export type ProcessFaultCode =
  | 'BOT_SPAWN_FAILED'
  | 'BOT_CRASHED'
  | 'BOT_EOF'
  | 'STDERR_LIMIT_EXCEEDED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'SANDBOX_VIOLATION';

export interface GameEvent {
  readonly sequence: number;
  readonly revision: number;
  readonly turnId: number;
  readonly type: 'ACTION_APPLIED' | 'TURN_SKIPPED' | 'MATCH_FINISHED';
  readonly side: PlayerSide;
  readonly action: GameAction | null;
  readonly reason: SkipReason | GameResultReason | null;
}

export type TransitionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly events: readonly GameEvent[];
      readonly result: GameResult | null;
    }
  | {
      readonly ok: false;
      readonly code: ActionErrorCode;
    };

export function createGame(config: GameConfig): GameState;

export function listLegalActions(
  state: GameState,
  side: PlayerSide,
): readonly GameAction[];

export function applyAction(
  state: GameState,
  side: PlayerSide,
  action: GameAction,
): TransitionResult;

export function skipTurn(
  state: GameState,
  side: PlayerSide,
  reason: SkipReason,
): TransitionResult;

export function forfeitGame(
  state: GameState,
  forfeitedSide: PlayerSide,
  fault: ProcessFaultCode | SkipReason,
): TransitionResult;

export function getGameResult(state: GameState): GameResult | null;

export function hashGameState(state: GameState): string;
```

## 5. State semantics

### Khởi tạo

- `status = 'PLAYING'`.
- `turn = 'X'`.
- `turnNumber = 1`.
- `turnCount = 0`.
- `revision = 0`.
- `outcome = null`.
- `pieces` là deep copy của map spawns.

### Một lượt hoàn tất

Một action hợp lệ hoặc skip hợp lệ:

- Tăng `turnCount` đúng 1.
- Tăng `revision` đúng 1.
- Nếu trận tiếp tục, tăng `turnNumber` đúng 1 và đổi `turn`.
- Nếu trận kết thúc, `turnNumber` giữ số lượt vừa phân xử và `turn` giữ side đã hành động.

`forfeitGame` không hoàn tất lượt hiện tại: `turnCount` không tăng, `revision` tăng 1 để ghi nhận state transition kết thúc.

### Turn limit

Sau action/skip, Engine kiểm tra theo thứ tự:

1. `REACHED_GOAL`.
2. `ELIMINATED_ALL_PIECES`.
3. `turnCount >= maxTurns` → hòa `TURN_LIMIT`.

Vì vậy action thắng đúng lượt cuối vẫn là thắng, không phải hòa.

### Không có legal action

Nếu `listLegalActions` trả mảng rỗng, MatchRunner gọi `skipTurn` với `NO_LEGAL_ACTION` mà không chờ `ACTION`. Đây không phải lỗi bot và không tăng fault counter.

## 6. Validation order

`applyAction` trả mã lỗi đầu tiên theo thứ tự cố định:

1. `GAME_NOT_PLAYING`.
2. `NOT_YOUR_TURN`.
3. `PIECE_NOT_FOUND`.
4. `NOT_YOUR_PIECE`.
5. `ILLEGAL_MOVE`.

Action lỗi không đổi state, revision, turn hoặc event sequence.

## 7. Deterministic ordering

`listLegalActions` trả kết quả theo thứ tự:

1. `pieceId` tăng dần theo Unicode code point.
2. `to.row` tăng dần.
3. `to.col` tăng dần.

`pieces` trong state/public message cũng được sort theo `id`. Không dùng thứ tự object/map insertion làm contract.

## 8. Hash contract

`finalStateHash` là lowercase SHA-256 hex của JSON Canonicalization Scheme
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) trên projection sau:

```ts
{
  schemaVersion,
  engineVersion,
  map,
  status,
  turn,
  turnNumber,
  turnCount,
  revision,
  maxTurns,
  pieces: [...pieces].sort(byId),
  outcome,
}
```

Không hash `gameId`, timestamp, player name, process metadata hoặc stderr. Cùng rule-state ở hai match ID khác nhau phải cho cùng hash.

## 9. Human-vs-Human compatibility

UI Human-vs-Human có thể giữ adapter:

```ts
applyMove(state, playerId, pieceId, to)
```

Adapter chỉ ánh xạ `playerId → side`, sau đó gọi `applyAction`. Adapter không được chứa movement, combat hoặc win logic.

## 10. Acceptance contract

Implementation chỉ được coi là tương thích v1 khi:

- 18 quân và vị trí khởi tạo khớp yêu cầu.
- Đủ 8 hướng, boundary, obstacle và ba quan hệ combat.
- Input state không bị mutate.
- Error precedence và action ordering đúng tài liệu này.
- Skip, max turn, forfeit và win priority đúng semantics.
- Hai lần chạy cùng input cho cùng events và final hash.
- Regression Human-vs-Human pass qua compatibility adapter.
