# Recovery, security và UX

## MAN-OPS-001 — Restart API giữ session/data đúng cách

**Tiền điều kiện:** round đã published; ghi số match, series, leaderboard và ID.

**Bước:** restart riêng container API theo runbook; chờ readiness; refresh các browser.

**Mong đợi:** gateway phục hồi; có thể cần đăng nhập lại theo session policy nhưng dữ liệu vẫn còn; số lượng và
ID không đổi; không tạo duplicate result/rating.

**Evidence:** before/after counts, timestamp và status containers.

## MAN-OPS-002 — Restart worker và coordinator

**Bước:** restart lần lượt worker rồi coordinator; chờ mỗi service healthy trước service kế tiếp; xem logs.

**Mong đợi:** service reconnect Redis/PostgreSQL/Docker; published data không đổi; không enqueue/chạy lại
match đã finalized; leaderboard không cộng rating lần hai.

**Evidence:** before/after counts và log recovery đã lọc secret.

## MAN-OPS-003 — Stop/up giữ volume

**Bước:** chạy `./scripts/demo.sh stop`, xác nhận UI không truy cập được; chạy `./scripts/demo.sh up`, chờ
ready và mở lại public/admin/team views.

**Mong đợi:** downtime rõ ràng; sau up dữ liệu đã publish còn nguyên; credentials/env được giữ; không có
round/job trùng.

**Evidence:** status trước stop và sau up, ảnh dữ liệu sau phục hồi.

## MAN-OPS-004 — Session hết hạn hoặc cookie không hợp lệ

**Bước:** trong môi trường test, xóa cookie session hoặc dùng session đã invalid; mở private page.

**Mong đợi:** trở về login/401; không render cache dữ liệu riêng; đăng nhập lại dùng được.

**Evidence:** ảnh trước và sau login lại, không chụp cookie value.

## MAN-OPS-005 — Chống đoán/tamper replay ID

**Bước:** anonymous và một team thay `matchId` bằng UUID không tồn tại; team không tham gia (nếu có account
thứ ba) thử replay thật.

**Mong đợi:** ID giả trả not found an toàn; non-participant không lấy được replay; lỗi không phân biệt quá mức
để lộ dữ liệu private; không có stack trace.

**Evidence:** status/error code theo actor.

## MAN-OPS-006 — Không lộ credential trong quản lý đội

**Bước:** BTC tạo một đội test hoặc reset credential của đội throw-away; quan sát credential một lần, dismiss,
refresh và mở lại trang. Không thực hiện trên account đang dùng nếu chưa được phép.

**Mong đợi:** credential chỉ hiển thị/tải một lần; sau dismiss/refresh không truy xuất lại plaintext; credential
cũ mất hiệu lực sau reset; UI nhắc chuyển/xóa file an toàn.

**Evidence:** ảnh đã che toàn bộ password/token; ghi việc login cũ bị từ chối và login mới thành công.

## MAN-OPS-007 — Audit thao tác đặc quyền

**Bước:** thực hiện một thao tác an toàn được owner cho phép với reason; mở audit viewer và tìm record.

**Mong đợi:** thao tác yêu cầu xác nhận/reason; audit có actor, action, timestamp, target và correlation ID;
refresh vẫn còn; không ghi secret vào audit.

**Evidence:** ảnh audit record đã che dữ liệu nhạy cảm.

## MAN-OPS-008 — Responsive desktop/mobile

**Bước:** kiểm tra login, team submission, admin round/results, public leaderboard và replay ở tối thiểu
1440×900, 768×1024 và 390×844; cuộn ngang/dọc như người dùng thật.

**Mong đợi:** không mất action chính, chữ không chồng/cắt, table có cách xem/scroll rõ, focus/modal không nằm
ngoài viewport và touch target sử dụng được.

**Evidence:** ảnh mỗi viewport, ưu tiên các trang có lỗi layout nếu Fail.

## MAN-OPS-009 — Keyboard và focus

**Bước:** không dùng chuột, Tab/Shift+Tab qua login, menu, upload, filter kết quả và replay controls; dùng
Enter/Space; đóng menu/modal bằng Escape.

**Mong đợi:** focus nhìn thấy, thứ tự hợp lý, label/nút có tên dễ hiểu, không keyboard trap; action nguy hiểm
không được kích hoạt ngoài ý muốn.

**Evidence:** video ngắn thể hiện focus order.

## MAN-OPS-010 — LAN spectator từ thiết bị thứ hai

**Tiền điều kiện:** thiết bị thứ hai cùng mạng; firewall cho phép port demo; đây không phải test Internet.

**Bước:** mở URL LAN do `demo.sh up` in ra; truy cập public/leaderboard; đăng nhập team test nếu được phép;
xem một private replay rồi đăng xuất.

**Mong đợi:** tải được qua LAN, dữ liệu giống host, replay/controls hoạt động; sau logout private route được bảo
vệ. Không mở port datastore/worker ra LAN.

**Evidence:** ảnh trên thiết bị thứ hai và URL chỉ chứa IP/port không nhạy cảm.
