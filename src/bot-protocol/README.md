# @ott/bot-protocol

Types và hằng số cho **Bot Protocol v1** — contract giữa MatchRunner và bot process.
Module chỉ chứa **types**; runtime validator/parser nằm ở `P1-L04`.

## Nguồn sự thật (provenance)

- [`docs/contracts/bot-protocol-v1.md`](../../docs/contracts/bot-protocol-v1.md) (LOCKED).
- [`docs/contracts/bot-protocol-v1.schema.json`](../../docs/contracts/bot-protocol-v1.schema.json) (machine schema).
- [`docs/decisions/0002-phase-1-engine-and-bot-protocol-v1.md`](../../docs/decisions/0002-phase-1-engine-and-bot-protocol-v1.md).
- [`docs/contracts/bot-protocol-v2.md`](../../docs/contracts/bot-protocol-v2.md),
  [`bot-protocol-v2.schema.json`](../../docs/contracts/bot-protocol-v2.schema.json) và fixtures
  `docs/contracts/fixtures/bot-protocol-v2-*.{ndjson,json}` (`P3-L01`).
- [`docs/decisions/0008-phase-3-protocol-v2-and-game-adapter-boundary.md`](../../docs/decisions/0008-phase-3-protocol-v2-and-game-adapter-boundary.md).

Domain types (`PlayerSide`, `Piece`, `Position`, `MapRef`, `MapDefinition`, `GameAction`,
`GameResultReason`, `SkipReason`, `ProcessFaultCode`) được **tái sử dụng** từ `@ott/game-core`
qua dependency `file:../game-core`; không copy type sang module này.

## Phạm vi P1-L03

`messages.ts`:

- `MessageBase` + 5 message: `InitMessage`, `StateUpdateMessage`, `ActionMessage`,
  `TurnResultMessage`, `MatchResultMessage`, union `ProtocolMessage`.
- `PublicGameState` — projection gửi bot: **không có `gameId`**, `status: 'PLAYING'`, `outcome: null`.
- `Limits` + `DEFAULT_LIMITS` (5000/3000/200/65536/1048576/3/5).
- `FaultSummary`; hằng `PROTOCOL_VERSION = 1`.

`errors.ts`:

- `TurnErrorCode` (= `SkipReason` của engine), `ProcessFaultCode`, `FaultCode` (13 giá trị).
- Hằng mảng `TURN_ERROR_CODES`, `PROCESS_FAULT_CODES`, `FAULT_CODES`.

## Phạm vi P1-L04 (runtime validator)

`validate.ts`:

- `compileProtocolValidator(schema)` — biên dịch JSON Schema chuẩn (draft 2020-12) bằng **`ajv`**.
- `validateBotMessage(input, options)` — pipeline đầy đủ theo Bot Protocol v1 §7:
  size → parse → schema → `MATCH_ID_MISMATCH` → `TURN_ID_MISMATCH` → `ILLEGAL_ACTION`.
- `utf8ByteLength(text)` — đếm byte UTF-8 (không tính LF).

Schema **không** được sao chép vào module: caller nạp `docs/contracts/bot-protocol-v1.schema.json`
và truyền vào `compileProtocolValidator`. Test đọc trực tiếp schema + fixtures trong `docs/contracts/`.

Phụ thuộc runtime: `ajv@8.20.0` (lý do: validator JSON Schema chuẩn; convention module-package cho phép).

## Phạm vi P3-L01 (Bot Protocol v2)

`messages.ts` (chỉ thêm, type v1 không đổi):

- `PROTOCOL_VERSION_V2`, `PerTurnPolicyV2`, `TimeControlV2`, `LimitsV2`, `MessageBaseV2`.
- `InitMessageV2` — `botSeed` (không có `seed`/`engineSeed`), `limits.timeControl` pin budget.
- `TurnBudgetV2`, `StateUpdateMessageV2` — `timeBudget` theo từng lượt.
- `ActionMessageV2`, `TurnResultMessageV2`, `MatchResultMessageV2`, union `ProtocolMessageV2`,
  alias `AnyProtocolMessage = ProtocolMessage | ProtocolMessageV2`.

`validate.ts`:

- `validateTimeControlV2` — quan hệ số học `baseMs <= maxMs <= totalBotBudgetMs` (JSON Schema không so sánh
  được hai property) với mã lỗi `INVALID_MODE`, `INVALID_BUDGET`, `BASE_EXCEEDS_MAX`, `MAX_EXCEEDS_TOTAL_BUDGET`.
- `validateBotMessageV2` — cùng pipeline v1 (size → parse → schema → matchId → turnId → legal action) nhưng chạy
  trên schema v2; fail closed bằng `SCHEMA_VIOLATION` nếu bị truyền validator v1.

Ngoài phạm vi module này: runtime chess-clock (tính `turnLimitMs`/`remainingBotBudgetMs` theo monotonic clock và
ghi timing event) thuộc `P3-L02`; các ban riêng của qualification (`FIXED 30s`, `FIXED 1min`, `NONE`) do
`RoundRuleSet` validator sở hữu.


Quy ước: mọi object protocol dùng `additionalProperties: false`; thêm/đổi/bớt field là
**breaking change** và phải phát hành protocol v2.

## Lệnh

```bash
npm --prefix src/bot-protocol install
npm --prefix src/bot-protocol run typecheck
npm --prefix src/bot-protocol run build
```

> Máy có Node khác `^22.12.0` (ví dụ Node 24): cài bằng
> `npm --prefix src/bot-protocol install --engine-strict=false`.
