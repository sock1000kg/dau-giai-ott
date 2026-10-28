# BTC quản lý bot tham chiếu

> Chạy trên local demo với tài khoản BTC_ADMIN và ít nhất một tài khoản TEAM_ACCOUNT. Dùng `demo/manually-check/artifacts/team-test-run-first-legal.oci.tar` để thử upload; file này là OCI archive hợp lệ và khác digest với bot demo `btc-baseline`. Không dùng archive chứa bí mật hay bot không được phép.

## MAN-REFBOT-01 — Menu và quyền truy cập

1. Đăng nhập bằng BTC_ADMIN.
2. Mở menu **Bot chạy thử**.
3. Mở trang `/admin/reference-bots`.
4. Đăng nhập bằng TEAM_ACCOUNT và thử mở URL trực tiếp.

**Kỳ vọng:** BTC thấy trang quản lý; đội thi không thấy menu BTC và URL trực tiếp trả về trang không được phép/điều hướng theo quy tắc auth hiện hành. API không trả catalog cho đội thi.

## MAN-REFBOT-02 — Tải OCI archive

1. Trên trang BTC, nhập tên bot và lý do tải lên.
2. Chọn OCI `.tar` hợp lệ không có trong catalog.
3. Nhấn **Tải lên OCI**.

**Kỳ vọng:** bot xuất hiện ở trạng thái **Chưa kích hoạt**; hiện archive, manifest, config digest và policy version. Không hiển thị object-storage key hoặc entrypoint. Refresh trang vẫn thấy bản ghi.

## MAN-REFBOT-03 — Từ chối archive sai và trùng

1. Tải lên một file `.tar` không phải OCI archive.
2. Thử tải lại archive đã có trong catalog.
3. Nếu có file lớn hơn 256 MiB, chọn file đó.

**Kỳ vọng:** archive không hợp lệ bị từ chối và không tạo bot; archive trùng nhận thông báo rõ ràng, không tạo bản ghi thứ hai; file quá lớn bị từ chối. Danh sách vẫn dùng được sau mỗi lỗi.

## MAN-REFBOT-04 — Kích hoạt và policy đội thi

1. Chọn bot chưa kích hoạt, nhập lý do, xác nhận **Kích hoạt**.
2. Có thể kích hoạt một bot khác để kiểm tra catalog hỗ trợ nhiều bot cùng hoạt động.
3. Đăng nhập bằng TEAM_ACCOUNT, mở **Chạy thử bot** và xem đối thủ BTC.

**Kỳ vọng:** BTC thấy trạng thái hoạt động và thời điểm cập nhật; đội chỉ thấy bot đã kích hoạt trong policy. Lý do và actor được ghi audit, không lộ thông tin nội bộ của artifact.

## MAN-REFBOT-05 — Tắt bot và kiểm tra lại

1. BTC chọn bot đang hoạt động, nhập lý do, xác nhận **Tắt bot**.
2. TEAM_ACCOUNT tải lại policy test-run.
3. Thử gửi API admission cho bot vừa tắt nếu môi trường có công cụ/API client.

**Kỳ vọng:** bot chuyển sang **Đã tắt** và biến mất khỏi policy của lượt chạy mới. Admission không chấp nhận bot đã tắt; worker cũng phải fail closed nếu bot bị tắt trước khi resolve archive cho job đã xếp hàng. Audit ghi nhận lý do tắt.

## Evidence

Ghi trạng thái từng case vào biên bản kiểm thử. Che thông tin đăng nhập/session. Với lỗi API, lưu status, error code và correlation ID; không chụp credential hoặc cookie.

Kết quả chạy browser ngày 2026-10-26 và screenshot nằm tại [artifacts/MAN-REFBOT-E2E-2026-10-26.md](artifacts/MAN-REFBOT-E2E-2026-10-26.md).
