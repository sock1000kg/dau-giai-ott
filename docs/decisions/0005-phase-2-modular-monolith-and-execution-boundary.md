# ADR-0005: Modular monolith control plane và execution worker tách ranh giới

## Status

Accepted

## Date

2026-10-12

## Context

Phase 2 cần phục vụ portal đội, BTC và khán giả, đồng thời chạy bot không tin cậy. Code Phase 1 đã có package tách rõ `game-core`, `bot-protocol` và `match-runner`, trong đó MatchRunner tạo event log bất biến và kiểm tra replay được. Ta cần thêm persistence, queue, sandbox và web mà không để browser hoặc bot truy cập execution runtime.

## Decision

- Dùng Fastify modular monolith làm control plane, PostgreSQL làm nguồn transactional, SeaweedFS S3-compatible cho object immutable local, Redis/BullMQ cho session/rate-limit/queue và React/Vite cho clients. Xem ADR-0007 cho ranh giới S3 portable và đường chuyển AWS S3.
- Tách worker thành process execution plane riêng. Worker nhận `MatchJobV1` versioned, chạy hai bot OCI container tách biệt theo ADR-0006 và gọi public API của `@ott/match-runner`; worker không tạo luật game hoặc rating.
- PostgreSQL là nguồn sự thật status/finalization. API tạo match/outbox trong cùng transaction; dispatcher enqueue BullMQ. Worker/finalizer dùng conditional transition và unique constraints để chịu delivery at-least-once.
- Chỉ control plane được public. Bot container không có network, Docker socket hoặc quyền truy cập trực tiếp database/object storage; spectator chỉ đọc replay đã `PUBLISHED`.
- Giữ modular monolith trong Phase 2 local. Chỉ tách service khi một nhu cầu scale, trust boundary hoặc owner độc lập được chứng minh bằng metric/sự cố.

## Alternatives considered

### Một process API vừa chạy worker và bot

Không chọn: bot code không tin cậy sẽ cùng failure domain với HTTP/control operations; restart hoặc resource exhaustion ảnh hưởng portal/BTC.

### Microservices cho từng module ngay từ đầu

Không chọn: tăng network, deployment, tracing và transaction complexity trước khi có scale requirement. Module boundary/package contract hiện tại cho phép tách sau mà không đổi domain semantics.

### Browser hoặc spectator kết nối worker/sandbox trực tiếp

Không chọn: làm lộ execution plane, phức tạp retry/publication và mâu thuẫn ADR-0003 không live stream.

## Consequences

- `P2-T03` phải định nghĩa schema/invariant/outbox trước queue worker.
- `P2-T09` cung cấp job contract nhỏ, versioned, idempotent; `P2-T11` finalization là transaction boundary cho kết quả chính thức.
- `P2-T10` phải enforce sandbox policy ngoài `@ott/match-runner`; `P2-T15` benchmark resource profile trước khi mở nhận bot của đội thi.
- Contract HTTP và storage/object representation phải versioned, additive và không để consumer phụ thuộc private module.
- Kiến trúc chi tiết và delivery order tại [Solution Architecture Phase 2](../architecture/solution-architecture-phase-2.md).
