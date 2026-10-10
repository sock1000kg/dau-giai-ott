# @ott/bot-protocol

Types và hằng số cho **Bot Protocol v1** — contract giữa MatchRunner và bot process.
Module chỉ chứa **types**; runtime validator/parser nằm ở `P1-L04`.

## Nguồn sự thật (provenance)

- [`docs/contracts/bot-protocol-v1.md`](../../docs/contracts/bot-protocol-v1.md) (LOCKED).
- [`docs/contracts/bot-protocol-v1.schema.json`](../../docs/contracts/bot-protocol-v1.schema.json) (machine schema).
- [`docs/decisions/0002-phase-1-engine-and-bot-protocol-v1.md`](../../docs/decisions/0002-phase-1-engine-and-bot-protocol-v1.md).

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

Chưa có (task sau): `P1-L04` — runtime validator/parser đọc trực tiếp schema + fixtures.

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
