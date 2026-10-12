# ADR-0003: Chỉ phát hành replay sau khi trận kết thúc

## Status

Accepted

## Date

2026-10-12

## Context

BTC cần chọn những trận phù hợp để trình chiếu cho khán giả. Hai phương án đã được
thảo luận là phát tiến trình trận đang chạy, hoặc phát replay của trận đã được phân xử.
Bot là code không tin cậy và chạy trong sandbox; hệ thống phải không để audience/client
kết nối trực tiếp vào worker hoặc sandbox. Event log và kết quả authoritative đã là
artifact bất biến của một trận terminal.

## Decision

- Không phát live stream, không cho BTC hay khán giả can thiệp vào trận đang chạy.
- Chỉ trận `terminal` có event log đã được kiểm tra integrity mới có thể được BTC đưa vào
  catalog replay.
- BTC dùng console để đưa replay vào `STAGED` và công bố thành `PUBLISHED`; spectator chỉ
  đọc replay `PUBLISHED` bằng `matchId` qua control plane.
- Spectator UI dựng trạng thái từ event index/snapshot và event log đã phát hành; không tự
  tính kết quả và không đọc source bot, seed chưa công bố, stderr riêng tư hay worker log.
- Authorization và audit cụ thể dùng policy của P2-T01/P2-T04; mỗi transition publication
  phải server-side và ghi audit.

## Alternatives considered

### Live spectator stream

- Ưu điểm: khán giả xem ngay khi trận đang diễn ra.
- Không chọn: tăng bề mặt realtime, khả năng lộ state/seed, và rủi ro ghép spectator với
  sandbox/worker. Nó cũng làm phức tạp retry, delayed publication và vận hành sự kiện.

### Truy cập worker hoặc sandbox trực tiếp

- Không chọn: phá ranh giới execution plane/control plane và không chấp nhận với code bot
  không tin cậy.

## Consequences

- Thêm API publication, console BTC và spectator replay UI sau P2-T11.
- Qualification E2E phải xác minh terminal match → stage/publish → spectator replay.
- Không thêm websocket, live-feed endpoint hoặc control action giữa trận trong Phase 2.
