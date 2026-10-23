# Kết quả, replay và public view

## MAN-VIEW-001 — BTC xem toàn bộ kết quả qualification

**Tiền điều kiện:** `MAN-QUAL-012` Pass.

**Bước:** BTC mở `/admin/results`, lọc stage qualification, xem series và match.

**Mong đợi:** thấy đủ series/match vừa chạy; team/side/winner/reason/status nhất quán; không có record trùng.

**Evidence:** ảnh bảng kết quả và ID.

## MAN-VIEW-002 — Mỗi đội chỉ xem kết quả được phép

**Bước:** mở `/team/results` ở Team 01 và Team 02; so sánh với BTC.

**Mong đợi:** mỗi đội thấy các match/series có đội mình; không thấy dữ liệu private ngoài phạm vi; kết quả
cùng match ID nhất quán với BTC.

**Evidence:** ảnh của hai context.

## MAN-VIEW-003 — Leaderboard anonymous

**Bước:** spectator incognito mở `/leaderboard`, chọn qualification và làm mới.

**Mong đợi:** không yêu cầu đăng nhập; có đúng hai đội của lượt test; rank/rating/eligibility hiển thị ổn định;
không lộ username đăng nhập, submission hash hoặc thông tin riêng.

**Evidence:** ảnh leaderboard anonymous.

## MAN-VIEW-004 — Public snapshot được cập nhật

**Bước:** chờ tối đa chu kỳ publish trong runbook, mở `/snapshots/latest.json` và `/public`.

**Mong đợi:** snapshot HTTP thành công và tham chiếu round vừa publish; public page hiển thị kết quả,
leaderboard/rules/schedule/status nhất quán; nếu stale thì UI cảnh báo rõ thay vì giả là live.

**Evidence:** ảnh public page và phần snapshot không chứa secret.

## MAN-VIEW-005 — Team 01 mở private replay

**Bước:** từ kết quả Team 01 mở replay của match vừa chạy.

**Mong đợi:** route `/team/replays/<matchId>` tải replay; checksum/schema được xác minh; trang có bàn cờ,
kết quả, dòng sự kiện, fault summary và điều khiển; không báo integrity error.

**Evidence:** ảnh replay cùng match ID.

## MAN-VIEW-006 — Team 02 mở cùng private replay

**Bước:** mở cùng match ID từ Team 02.

**Mong đợi:** Team 02 là participant nên xem được; nội dung và kết quả giống Team 01/BTC.

**Evidence:** ảnh replay Team 02.

## MAN-VIEW-007 — BTC mở private replay

**Bước:** BTC mở replay từ catalog `/admin/replays` hoặc result link.

**Mong đợi:** BTC xem được bản private; catalog/status đúng stage qualification; không có action phát hành
qualification thành public finals replay.

**Evidence:** ảnh catalog và replay.

## MAN-VIEW-008 — Anonymous không xem private qualification replay

**Bước:** sao chép URL private replay vào incognito; thử trực tiếp `/api/v1/replays/<matchId>`.

**Mong đợi:** UI yêu cầu login; API trả 401/`UNAUTHENTICATED`; không trả body replay hoặc checksum artifact.

**Evidence:** ảnh login và status/error code, không lưu header cookie.

## MAN-VIEW-009 — Qualification replay không được public hóa

**Bước:** incognito thử `/spectator/replays/<matchId>` và `/api/v1/public/replays/<matchId>`; BTC thử stage
replay qualification nếu UI có action.

**Mong đợi:** public route không trả replay (404 `REPLAY_NOT_FOUND`); stage attempt bị từ chối vì không phải
finals (409 tương ứng); replay vẫn private và không xuất hiện như replay công khai.

**Evidence:** URL, status/error code và ảnh admin từ chối.

## MAN-VIEW-010 — Điều khiển replay

**Tiền điều kiện:** ưu tiên match từ fixture Protocol v2 có `ACTION_APPLIED`; match không có nước đi phải hiển
thị note tương ứng và không được dùng để khẳng định animation đã pass.

**Bước:** dùng **Phát/Tạm dừng/Tiếp tục**, sự kiện trước/sau, seek slider, các tốc độ và **Bắt đầu lại**.

**Mong đợi:** board, turn, active side, move list, timing và caption đồng bộ tại mọi seek; không bỏ/nhân đôi
event; cuối replay đúng result. Với replay không có move, UI nói rõ trận không có nước đi hợp lệ.

**Evidence:** video ngắn từ đầu, seek giữa và kết thúc.

## MAN-VIEW-011 — Trình chiếu replay toàn màn hình

**Bước:** chọn **Trình chiếu toàn màn hình**, chạy replay, thoát bằng nút/Escape; thử một viewport mobile.

**Mong đợi:** board và controls vẫn đọc được, không bị cắt nội dung quan trọng; trạng thái fullscreen đổi đúng;
nếu browser từ chối fullscreen thì có cảnh báo và replay inline vẫn dùng được.

**Evidence:** ảnh/video fullscreen và viewport mobile.
