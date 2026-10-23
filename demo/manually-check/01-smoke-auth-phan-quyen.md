# Smoke, đăng nhập và phân quyền

## MAN-SMOKE-001 — Gateway và readiness

**Tiền điều kiện:** stack vừa được `demo.sh up`; biết URL gateway.

**Bước:**

1. Chạy `./scripts/demo.sh status`.
2. Mở `<BASE_URL>/` bằng browser desktop.
3. Mở `<BASE_URL>/api/v1/health/ready` trong tab mới.

**Mong đợi:** service/container cần thiết healthy; trang đăng nhập hiển thị; ready endpoint trả trạng thái
`ready`; không có lỗi mixed-content, blank page hoặc vòng lặp reload.

**Evidence:** output status đã che thông tin nhạy cảm, ảnh trang login và ready response.

## MAN-SMOKE-002 — Đăng nhập sai

**Tiền điều kiện:** chưa có session.

**Bước:** nhập username hợp lệ với mật khẩu sai rồi chọn **Đăng nhập**.

**Mong đợi:** vẫn ở form login; hiển thị `Tên đăng nhập hoặc mật khẩu không đúng.`; không lộ chi tiết backend;
không tạo session đăng nhập.

**Evidence:** ảnh thông báo lỗi, không chụp giá trị password.

## MAN-SMOKE-003 — BTC đăng nhập và điều hướng

**Bước:** đăng nhập bằng tài khoản `btc`, mở lần lượt các mục **Đội thi**, **Round**, **Đặc quyền**,
**Kết quả**, **Replay**.

**Mong đợi:** landing page là **Khu vực BTC**; năm mục mở đúng `/admin/*`; không có trang trắng hoặc lỗi
quyền; menu đánh dấu đúng mục hiện tại.

**Evidence:** ảnh landing page và một ảnh thể hiện menu/URL admin.

## MAN-SMOKE-004 — Team 01 đăng nhập và điều hướng

**Bước:** trong browser context khác, đăng nhập `team01`; mở **Nộp bot** và **Kết quả**.

**Mong đợi:** landing page là **Cổng đội thi**; chỉ có các chức năng của đội; URL tương ứng
`/team/submissions` và `/team/results`.

**Evidence:** ảnh landing page Team 01.

## MAN-SMOKE-005 — Team 02 đăng nhập độc lập

**Bước:** trong context thứ ba, đăng nhập `team02`; refresh trang; quay lại `/team`.

**Mong đợi:** session tồn tại sau refresh; giao diện vẫn mang role đội; dữ liệu không bị lẫn với Team 01.

**Evidence:** ảnh sau refresh thể hiện đúng tài khoản/role.

## MAN-SMOKE-006 — Team không mở được trang BTC

**Tiền điều kiện:** đang đăng nhập Team 01.

**Bước:** nhập trực tiếp `<BASE_URL>/admin/teams`, sau đó thử `/admin/rounds`.

**Mong đợi:** hiển thị **Không có quyền truy cập**; không render dữ liệu quản trị và không tự đổi role.

**Evidence:** ảnh access denied với URL.

## MAN-SMOKE-007 — BTC không mở được trang riêng của team

**Tiền điều kiện:** đang đăng nhập BTC.

**Bước:** nhập trực tiếp `<BASE_URL>/team/submissions`.

**Mong đợi:** hiển thị **Không có quyền truy cập**; không có form upload.

**Evidence:** ảnh access denied với URL.

## MAN-SMOKE-008 — Đăng xuất và bảo vệ session

**Bước:** tại Team 02 chọn **Đăng xuất**; dùng nút Back hoặc nhập lại `/team/results`.

**Mong đợi:** quay về login; trang riêng không xuất hiện từ session cũ; refresh vẫn anonymous.

**Evidence:** ảnh login sau khi truy cập lại private URL.

## MAN-SMOKE-009 — Spectator anonymous

**Bước:** mở cửa sổ incognito chưa đăng nhập; truy cập `/public`, `/leaderboard`, `/finals`, rồi thử
`/team/submissions`.

**Mong đợi:** ba trang public mở được mà không yêu cầu login; trang team chuyển về form login và không lộ
dữ liệu riêng.

**Evidence:** ảnh một public page và form login khi vào private route.
