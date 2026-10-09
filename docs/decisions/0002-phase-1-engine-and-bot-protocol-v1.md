# ADR-0002: Khóa Engine API và Bot Protocol v1 cho Phase 1

## Status

Accepted — `HIGH RECOMMEND`, tự động duyệt bởi Đinh Đức Thuận

## Date

2026-10-09

## Context

Phase 1 cần ba nhánh có thể triển khai độc lập:

- Long Trần triển khai game core và protocol.
- Đỗ Khôi Nguyên viết bot Python từ schema/fixtures.
- Phạm Tất Đạt viết MatchRunner bằng ports/fakes trước khi tích hợp core và bot thật.

Repository tham chiếu `sock1000kg/rock-paper-scissor` tại commit
`2956f1601365274eb34d623a9c908900bf43baab` có luật và implementation Human-vs-Human nhưng không có LICENSE tại commit đã kiểm tra. Contract cần giữ hành vi game mà không đưa source chưa rõ quyền sử dụng vào repository này.

## Decision

### Source và cấu trúc

- Commit tham chiếu chỉ dùng để đối chiếu hành vi, test case và vị trí khởi tạo.
- Không copy source, tạo submodule hoặc đóng gói code tham chiếu cho đến khi có xác nhận quyền sử dụng bằng văn bản hoặc LICENSE phù hợp.
- Game core được triển khai lại từ đặc tả tại `docs/contracts/engine-api-v1.md`.
- Source root là `src/` với các module:
  - `src/game-core/`
  - `src/bot-protocol/`
  - `src/match-runner/`
  - `src/bots/python/`
  - `src/platform/` cho Phase 2.
- Node.js 22, TypeScript, Vitest và npm workspaces là baseline Phase 1.

### Engine API

- Core là module thuần, không import UI, process, timer, network, database hoặc framework.
- API chính gồm `createGame`, `listLegalActions`, `applyAction`, `skipTurn`, `forfeitGame`, `getGameResult` và `hashGameState`.
- Human-vs-Human dùng compatibility adapter gọi chung `applyAction`; không duy trì bộ luật thứ hai.
- State transition không mutate input và có thứ tự kết quả deterministic.
- Hash dùng SHA-256 trên JSON Canonicalization Scheme RFC 8785 của rule-state projection.

### Bot Protocol v1

- Transport là STDIO/NDJSON, UTF-8, mỗi message đúng một dòng.
- Có đúng năm message: `INIT`, `STATE_UPDATE`, `ACTION`, `TURN_RESULT`, `MATCH_RESULT`.
- `STATE_UPDATE` luôn chứa `legalActions`; Engine vẫn validate lại `ACTION`.
- Extra field bị từ chối ở mọi object protocol (`additionalProperties: false`). Thêm field vào message v1 là breaking change và phải phát hành protocol version mới.
- `TURN_RESULT` được gửi cho cả hai bot còn sống sau mỗi lượt; `STATE_UPDATE` chỉ gửi cho bot đang đến lượt.

### Runtime baseline Phase 1

- Python `3.12.x`.
- Entrypoint bot: `bot.py`.
- Runner spawn trực tiếp, không qua shell: `python3 -I -u <absolute-path>/bot.py`.
- `startupTimeoutMs = 5000`.
- `turnTimeoutMs = 3000`, đo bằng monotonic clock từ khi ghi xong `STATE_UPDATE` tới khi nhận đủ một dòng `ACTION` hợp lệ.
- `maxTurns = 200`.
- `maxMessageBytes = 65536` byte UTF-8, không tính ký tự LF kết thúc dòng.
- `maxStderrBytes = 1048576` byte cho mỗi bot mỗi trận.

### Fault policy

- Lỗi theo lượt có thể phục hồi làm skip lượt: timeout, malformed JSON, schema violation, sai match/turn, message quá lớn và illegal action.
- Bot bị forfeit khi có 3 lỗi phục hồi liên tiếp hoặc 5 lỗi phục hồi trong một trận.
- Một action hợp lệ reset bộ đếm liên tiếp, không reset tổng lỗi.
- Crash, EOF không mong đợi, spawn failure, vượt stderr quota, resource limit hoặc sandbox violation dẫn đến `FORFEIT` ngay.
- Action đến muộn bị bỏ; timeout chỉ được đếm một lần, action muộn không được tính thành lỗi thứ hai và không được dùng cho lượt sau.
- `NO_LEGAL_ACTION` tạo skip nhưng không tính là lỗi bot.

## Contract artifacts

- `docs/contracts/engine-api-v1.md`
- `docs/contracts/bot-protocol-v1.md`
- `docs/contracts/bot-protocol-v1.schema.json`
- `docs/contracts/fixtures/bot-protocol-v1-valid.ndjson`
- `docs/contracts/fixtures/bot-protocol-v1-invalid-cases.json`

## Alternatives considered

### Copy hoặc submodule repository tham chiếu

Không chọn vì commit tham chiếu chưa có LICENSE. Có thể xem xét lại bằng ADR mới nếu quyền sử dụng được xác nhận.

### WebSocket cho bot local

Không chọn trong v1. STDIO/NDJSON đơn giản hơn, dễ sandbox và không cần mở port.

### Để bot tự tính legal actions

Không chọn. Cách này buộc bot test sao chép luật và dễ lệch version; `legalActions` được gửi nhưng chỉ Engine có quyền quyết định.

### Mọi lỗi đều chỉ skip, không forfeit

Không chọn vì bot crash hoặc vi phạm quota có thể làm trận không thể tiếp tục và tạo rủi ro tài nguyên.

## Consequences

- Nguyên và Đạt có thể triển khai từ schema/fixtures sau khi artifact được phát hành mà không chờ implementation của Long.
- Long phải giữ TypeScript types, JSON Schema, examples và fixtures đồng bộ trong cùng pull request.
- Breaking change phải dùng protocol version mới; không âm thầm sửa v1.
- `P1-L01` là triển khai mới theo behavior contract, không phải sao chép source tham chiếu.
- CPU/RAM/PID quota của sandbox Phase 2 vẫn phải benchmark trước khi nhận submission; đây không phải blocker của Phase 1 contract.
