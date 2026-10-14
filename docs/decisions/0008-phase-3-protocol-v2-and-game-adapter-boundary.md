# ADR-0008: Protocol v2 và ranh giới game adapter Phase 3

## Status

Accepted

## Date

2026-10-14

## Context

Protocol v1 dùng timeout cố định và gửi `seed` của trận trong `INIT`. Phase 3 cần chess clock, giới hạn
từng lượt thay đổi theo rule set, không lộ seed nội bộ và cho phép thay game mà không viết lại UI/tournament.
Protocol v1 đã phát hành và vẫn cần cho regression/replay Phase 1–2.

## Decision

- Giữ Protocol v1 bất biến. Official match Phase 3 dùng Protocol v2 theo
  [Bot Protocol v2](../contracts/bot-protocol-v2.md).
- Server dùng monotonic clock. `RoundRuleSet` pin tổng ngân sách mỗi bot, per-turn policy và wall-clock cap;
  v2 gửi remaining/turn budget cần thiết cho bot.
- Không gửi `engineSeed`. Mỗi bot nhận `botSeed` riêng được HMAC từ secret server và context
  match/game/team/protocol; bot không thể suy ra seed đối thủ hoặc engine.
- Tournament platform không hard-code score của một game. Versioned game adapter trả winner hoặc ordered
  `scoreBreakdown`; finals domain/UI chỉ consume kết quả đã ký/persist, không tự diễn giải bàn cờ.

## Alternatives considered

### Sửa Protocol v1 tại chỗ

Không chọn vì schema v1 từ chối field lạ và thay nghĩa `seed`/timeout sẽ phá fixture, bot và replay cũ.

### Không gửi seed nào cho bot

Không chọn làm mặc định vì bot vẫn cần nguồn deterministic cho chiến thuật ngẫu nhiên có kiểm soát.

### Hard-code điểm ăn quân/ô cộng điểm trong tournament service

Không chọn vì game có thể thay đổi và UI sẽ trở thành nguồn luật thứ hai.

## Consequences

- `P3-L01` phải phát hành schema/types/fixtures v2 và giữ validator v1 độc lập.
- `P3-L02` thực thi clock bằng fake/monotonic clock và ghi timing decision vào replay.
- Finals contract pin adapter id/version và tiêu chí score; đổi tiêu chí chỉ có hiệu lực với rule set mới.
