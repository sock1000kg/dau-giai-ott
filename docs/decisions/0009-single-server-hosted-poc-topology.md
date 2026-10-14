# ADR-0009: Topology hosted PoC trên một server lab

## Status

Accepted

## Date

2026-10-14

## Context

Mục tiêu Phase 3 là UI và hệ thống giải đấu hoạt động tốt, hardening thực dụng và chi phí thấp. PoC nộp
chỉ có một server lab; chưa cần chứng minh cụm bốn laptop hay năng lực 4.000 đội, nhưng phải truy cập được
bằng URL public và xử lý tải vừa phải có kiểm soát.

## Decision

- Một server lab chạy Fastify API, PostgreSQL, Redis/BullMQ, S3-compatible storage và worker/sandbox.
- Static frontend/public snapshot được phát qua static hosting/CDN. Team/API traffic đi qua HTTPS reverse
  proxy hoặc secure tunnel có WAF; PostgreSQL, Redis, object storage và worker không mở public port.
- Default admission là tối đa 4 game đồng thời và tự giảm theo CPU/RAM. Overload trả queue position hoặc
  `Retry-After`, dừng job ưu tiên thấp trước, không drop submission/result.
- Acceptance target: khoảng 200 đội, 100 session đăng nhập, burst 50 upload/reservation và 1.000 public
  viewers qua CDN. Đây là PoC target, không phải SLA production.
- Hosted PoC bật TOTP, admin network allowlist, rate/body limit, audit và sandbox no-egress; cấu hình thiếu
  làm startup fail closed.

## Alternatives considered

### Cụm bốn laptop ngay trong PoC

Không chọn vì tăng orchestration/failover work trước khi luồng sản phẩm chính hoạt động và không có hạ tầng
được cam kết.

### Cho public browser đọc trực tiếp API/database

Không chọn vì traffic khán giả cạnh tranh tài nguyên với tournament/execution plane.

### Gọi PoC là production-ready

Không chọn. PoC không có HA, HSM, automated key rotation, 24/7 monitoring hoặc DR SLA.

## Consequences

- `P3-N02`, `P3-N06`, `P3-N07` kiểm chứng single-host admission/recovery thay vì multi-laptop failover.
- Public UI vẫn scale rẻ bằng immutable snapshot; control plane ưu tiên team/admin workflows.
- Kiến trúc giữ lease/heartbeat và module boundary để mở rộng worker sau này mà không hứa năng lực chưa đo.
