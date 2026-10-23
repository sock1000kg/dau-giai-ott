# ADR-0004: Tài khoản đội được BTC provision cho Phase 2

## Status

Accepted

## Date

2026-10-12

## Context

Đội cần một portal để đăng nhập và nộp bot, nhưng không được tự đăng ký. BTC cần tạo đội nhanh
trong console bằng tên đội và gửi credential qua kênh chat ngoài hệ thống. Platform chưa có identity
provider bên ngoài; bot source và dữ liệu submission phải luôn bị giới hạn theo team.

## Decision

- Dùng username/password nội bộ. Không có sign-up, OAuth/email login, API tự đăng ký hay unauthenticated
  password reset trong Phase 2. `TEAM_ACCOUNT` đã đăng nhập có thể đổi mật khẩu sau khi xác minh mật khẩu hiện tại.
- Mỗi team có đúng một `TEAM_ACCOUNT` dùng chung. Khi `BTC_ADMIN` tạo team, server tạo username duy nhất
  và password ngẫu nhiên; plaintext credential chỉ nằm trong response create/reset một lần.
- Password được hash bằng Argon2id. Session là opaque server-side record ở Redis; browser nhận cookie
  `HttpOnly`, `SameSite=Lax` và `Secure` khi chạy HTTPS. Login bị rate-limit và error không xác nhận
  username có tồn tại.
- BTC đầu tiên được bootstrap từ biến môi trường local, không commit vào repository. BTC có thể reset
  credential team; reset thu hồi toàn bộ session của account đó. Audit không bao giờ chứa password.
- Đổi mật khẩu của đội giữ nguyên username/team binding, dùng Argon2id và thu hồi toàn bộ session account.
  Audit ghi loại thao tác và team target, không lưu secret. Đội quên mật khẩu liên hệ BTC để reset.
- Công cụ tự động đưa mật khẩu về mặc định chỉ dành cho account demo local/test, mặc định tắt và ngoài
  API chính thức. Nó yêu cầu opt-in, demo/deployment mode hợp lệ, allowlist username tường minh, và từ chối
  public demo/hosted/finals/production. Mặc định chạy 03:00 `Asia/Ho_Chi_Minh`; password lấy từ
  `OTT_DEMO_TEAM_PASSWORD`. Public demo không bật job này.
- Server kiểm tra `TEAM_ACCOUNT.teamId` cho mọi thao tác submission/read riêng tư; UI chỉ là consumer,
  không phải ranh giới authorization.

## Alternatives considered

### Đội tự đăng ký

Không chọn vì BTC cần kiểm soát danh sách đội, xác minh danh tính ngoài hệ thống và tránh account rác.

### BTC tự nhập hoặc lưu plaintext password

Không chọn vì tạo mật khẩu yếu/dùng lại và làm server hoặc log có thể giữ secret không cần thiết.

### Identity provider bên ngoài

Không chọn cho Phase 2 local vì tăng vận hành và không giải quyết nhu cầu account dùng chung theo đội.
Có thể bổ sung sau bằng ADR mới mà không thay đổi authorization theo `teamId`.

## Consequences

- `P2-T04` cung cấp login/session/RBAC; `P2-T06` provision/reset team credential server-side.
- Portal của đội có đăng nhập, đổi mật khẩu đã xác thực và submission; không có đăng ký hoặc tự reset khi
  quên mật khẩu. BTC console hiển thị credential một lần để gửi ngoài hệ thống.
- Cần integration tests cho brute-force/rate-limit, generic login failure, one-time secret response,
  session revocation và cross-team authorization.
