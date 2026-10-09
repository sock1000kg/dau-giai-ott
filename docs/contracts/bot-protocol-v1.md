# Bot Protocol v1

> Status: **LOCKED**
>
> Approval: `HIGH RECOMMEND` — tự động duyệt bởi Đinh Đức Thuận
>
> Owner triển khai: Long Trần
>
> Consumers: Đỗ Khôi Nguyên, Phạm Tất Đạt
>
> Machine schema: `docs/contracts/bot-protocol-v1.schema.json`

## 1. Phạm vi

Bot Protocol v1 là contract giữa MatchRunner và một bot process trong Phase 1. Protocol chỉ truyền state/action; Engine là nguồn sự thật duy nhất và luôn validate lại action.

Protocol có đúng năm message:

| Message | Hướng | Thời điểm |
| --- | --- | --- |
| `INIT` | Runner → Bot | Một lần sau khi spawn |
| `STATE_UPDATE` | Runner → Bot | Khi tới lượt bot |
| `ACTION` | Bot → Runner | Tối đa một lần cho `STATE_UPDATE` có legal action |
| `TURN_RESULT` | Runner → cả hai bot còn sống | Sau khi phân xử mỗi lượt |
| `MATCH_RESULT` | Runner → cả hai bot còn sống | Khi trận kết thúc |

## 2. Transport và encoding

- STDIO, UTF-8 không BOM, NDJSON.
- Mỗi message là một JSON object trên đúng một dòng kết thúc bằng LF (`\n`).
- Runner ghi protocol vào bot `stdin`.
- Bot chỉ ghi protocol vào `stdout`; log chỉ ghi vào `stderr`.
- Không dùng shell để spawn bot.
- Không chấp nhận `NaN`, `Infinity`, comment JSON, trailing comma hoặc top-level value không phải object.
- Mọi object dùng `additionalProperties: false` theo JSON Schema.
- `maxMessageBytes` tính theo byte UTF-8 của JSON, không gồm LF.

## 3. Runtime baseline

| Giá trị | Phase 1 |
| --- | ---: |
| Python | `3.12.x` |
| Entrypoint | `bot.py` |
| Local argv | `python3 -I -u <absolute-path>/bot.py` |
| Startup timeout | `5000 ms` |
| Turn timeout | `3000 ms` |
| Max turns | `200` |
| Max message | `65536 bytes` |
| Max stderr/bot/match | `1048576 bytes` |
| Recoverable faults liên tiếp | `3` |
| Recoverable faults toàn trận | `5` |

Startup timeout được tính từ khi spawn tới khi process tồn tại và Runner ghi xong `INIT`. V1 không có `READY`; lỗi spawn/exit trong giai đoạn này là forfeit ngay. Timeout lượt đầu chỉ bắt đầu sau khi Runner ghi xong `STATE_UPDATE` đầu tiên.

## 4. Common fields

Mọi message có:

```ts
interface MessageBase {
  type: 'INIT' | 'STATE_UPDATE' | 'ACTION' | 'TURN_RESULT' | 'MATCH_RESULT';
  protocolVersion: 1;
  matchId: string;
}
```

- `matchId`: 1–128 ký tự, pattern `[A-Za-z0-9][A-Za-z0-9._:-]*`.
- Message theo lượt có `turnId`: integer dương, bắt đầu từ 1 và tăng đúng 1 sau mỗi action/skip.
- Bot phải echo chính xác `protocolVersion`, `matchId`, `turnId` trong `ACTION`.

## 5. Message schemas

### 5.1 INIT

```ts
interface InitMessage extends MessageBase {
  type: 'INIT';
  engineVersion: string;
  side: 'X' | 'O';
  seed: string;
  map: MapDefinition;
  limits: {
    startupTimeoutMs: number;
    turnTimeoutMs: number;
    maxTurns: number;
    maxMessageBytes: number;
    maxStderrBytes: number;
    maxConsecutiveFaults: number;
    maxTotalFaults: number;
  };
}
```

Bot nhận đúng một `INIT`. Nhận message khác trước `INIT` hoặc nhận `INIT` lần hai là lỗi lifecycle của Runner.

### 5.2 STATE_UPDATE

```ts
interface StateUpdateMessage extends MessageBase {
  type: 'STATE_UPDATE';
  turnId: number;
  state: PublicGameState;
  legalActions: GameAction[];
}
```

- Chỉ bot có `side === state.turn` nhận message này.
- `legalActions` được sort theo Engine API v1.
- Bot phải chọn action đúng nguyên dạng trong `legalActions`; Runner vẫn validate lại.
- Nếu `legalActions` rỗng, bot không gửi `ACTION`. Runner tự skip `NO_LEGAL_ACTION` và gửi `TURN_RESULT`.

### 5.3 ACTION

```ts
interface ActionMessage extends MessageBase {
  type: 'ACTION';
  turnId: number;
  action: {
    pieceId: string;
    to: { col: number; row: number };
  };
}
```

Bot gửi tối đa một `ACTION` cho mỗi `STATE_UPDATE`. Dòng hoàn chỉnh đầu tiên nhận được trong request window là response cần phân xử; stdout ngoài request window bị discard và ghi `UNEXPECTED_MESSAGE` vào technical log.

### 5.4 TURN_RESULT

```ts
interface TurnResultMessage extends MessageBase {
  type: 'TURN_RESULT';
  turnId: number;
  actorSide: 'X' | 'O';
  outcome: 'APPLIED' | 'SKIPPED';
  action: GameAction | null;
  errorCode: TurnErrorCode | null;
  revision: number;
  nextSide: 'X' | 'O' | null;
}
```

- `APPLIED`: `action` bắt buộc, `errorCode = null`.
- `SKIPPED`: `action = null`, `errorCode` bắt buộc.
- `nextSide = null` khi trận đã kết thúc.
- Runner gửi cùng một message cho cả hai bot còn sống.

### 5.5 MATCH_RESULT

```ts
interface MatchResultMessage extends MessageBase {
  type: 'MATCH_RESULT';
  winnerSide: 'X' | 'O' | null;
  reason: 'REACHED_GOAL' | 'ELIMINATED_ALL_PIECES' | 'FORFEIT' | 'TURN_LIMIT';
  turnCount: number;
  finalStateHash: string;
  faults: {
    X: FaultSummary;
    O: FaultSummary;
  };
}
```

Runner cố gửi `MATCH_RESULT` cho mọi bot còn sống rồi đóng stdin/process. Bot đã crash hoặc bị kill không cần nhận message này.

## 6. Error codes và policy

### Recoverable turn errors

| Code | Khi nào |
| --- | --- |
| `NO_LEGAL_ACTION` | Engine không có action hợp lệ; không tính lỗi bot |
| `BOT_TIMEOUT` | Không nhận đủ một ACTION hợp lệ trước deadline |
| `MALFORMED_JSON` | Dòng không parse được JSON object |
| `SCHEMA_VIOLATION` | JSON không khớp schema hoặc có extra field |
| `MATCH_ID_MISMATCH` | `matchId` khác INIT |
| `TURN_ID_MISMATCH` | `turnId` không phải lượt đang chờ |
| `MESSAGE_TOO_LARGE` | Dòng vượt `maxMessageBytes` |
| `ILLEGAL_ACTION` | Action đúng schema nhưng không nằm trong legal actions |

Trừ `NO_LEGAL_ACTION`, các lỗi trên:

1. Không gọi `applyAction`.
2. Gọi `skipTurn` đúng một lần.
3. Tăng recoverable total và consecutive của bot đúng một lần.
4. Forfeit nếu consecutive đạt 3 hoặc total đạt 5.

Action hợp lệ reset consecutive về 0. Timeout rồi nhận action muộn chỉ tính một `BOT_TIMEOUT`; action muộn bị discard và không được dùng cho lượt sau.

### Immediate-forfeit process faults

| Code | Khi nào |
| --- | --- |
| `BOT_SPAWN_FAILED` | Không spawn được entrypoint |
| `BOT_CRASHED` | Process exit non-zero khi trận còn chạy |
| `BOT_EOF` | stdout/stdin đóng bất ngờ khi trận còn chạy |
| `STDERR_LIMIT_EXCEEDED` | stderr vượt quota |
| `RESOURCE_LIMIT_EXCEEDED` | Vượt CPU/RAM/PID/output quota do sandbox báo |
| `SANDBOX_VIOLATION` | Vi phạm filesystem/network/process policy |

Process fault dẫn đến `FORFEIT` ngay, không skip thêm một lượt trước khi kết thúc.

## 7. Timeout algorithm

1. Runner serialize và ghi toàn bộ `STATE_UPDATE` cùng LF.
2. Sau khi write/flush hoàn tất, ghi nhận monotonic deadline `now + turnTimeoutMs`.
3. Line buffer thu stdout tới LF nhưng không vượt `maxMessageBytes`.
4. Parser → schema validator → match/turn validator → legal action validator.
5. Chỉ một kết quả được settle: applied, skipped hoặc process fault.
6. Timer/listener/pending promise được cleanup trong `finally`.

Không dùng timestamp, duration hoặc clock từ bot.

## 8. Message sequence

```text
spawn X/O
  ├─ INIT → X
  └─ INIT → O

loop while PLAYING:
  STATE_UPDATE → active bot
  ├─ legalActions empty: no ACTION expected
  └─ otherwise: ACTION ← active bot
  TURN_RESULT → X and O if alive

MATCH_RESULT → X and O if alive
close stdin → wait grace period → terminate remaining process
```

## 9. Versioning và change control

- v1 bị khóa theo schema đi kèm tài liệu này.
- Vì schema từ chối extra fields, thêm/xóa/đổi field hoặc enum là breaking change và phải phát hành v2.
- Sửa mô tả không đổi behavior có thể giữ v1.
- Mọi thay đổi phải do owner protocol cập nhật đồng thời tài liệu, TypeScript types, JSON Schema, fixtures và contract tests.
- Nguyên và Đạt review thay đổi trước merge.

## 10. Fixtures

- Valid transcript: `docs/contracts/fixtures/bot-protocol-v1-valid.ndjson`.
- Invalid matrix: `docs/contracts/fixtures/bot-protocol-v1-invalid-cases.json`.
- JSON Schema: `docs/contracts/bot-protocol-v1.schema.json`.

## 11. Acceptance criteria

- Schema chấp nhận toàn bộ valid transcript và từ chối schema-invalid cases.
- Semantic validator phát hiện mismatch match/turn và illegal action.
- Chunked stdout và nhiều dòng trong một chunk vẫn được tách đúng.
- Malformed, oversize, timeout và late action không làm poison lượt sau.
- Threshold 3 consecutive/5 total và immediate forfeit hoạt động đúng.
- Cùng transcript/input tạo cùng event sequence và `finalStateHash`.
