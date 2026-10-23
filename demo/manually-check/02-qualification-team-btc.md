# Qualification từ đầu đến cuối

Các case trong file này chạy nối tiếp trên cùng một round sạch. Ghi lại `roundId`, hai `submissionId`,
`seriesId` và ít nhất một `matchId` vào biên bản.

## MAN-QUAL-001 — Trạng thái ban đầu của cổng nộp

**Tiền điều kiện:** stack sạch; Team 01 đã đăng nhập; chưa mở round.

**Bước:** mở `/team/submissions` và quan sát danh sách/trạng thái; không chọn file.

**Mong đợi:** trang **Nộp bot dự thi** tải được; không có submission cũ; hệ thống không tự upload; nếu thử
nộp trước khi round mở thì thông báo rõ cổng chưa mở.

**Evidence:** ảnh trạng thái ban đầu.

## MAN-QUAL-002 — BTC tạo/mở qualification round

**Tiền điều kiện:** BTC đã đăng nhập; dùng `/admin/rounds`.

**Bước:**

1. Tạo hoặc chọn rule set qualification theo giá trị demo hợp lệ.
2. Tạo round `QUALIFICATION`.
3. Thực hiện thao tác mở nhận submission, nhập reason và xác nhận nếu UI yêu cầu.
4. Làm mới trang hoặc chạy `./scripts/demo.sh round status` để đối chiếu.

**Mong đợi:** round chuyển đúng trình tự từ draft sang `SUBMISSION_OPEN`; rule set đã chọn được pin vào
round; UI chỉ bật action hợp lệ và có phản hồi thành công.

**Evidence:** ảnh round ID, rule set ID, status và reason/audit reference nếu có.

## MAN-QUAL-003 — Validate file phía client

**Tiền điều kiện:** round đang mở; Team 01 ở form upload.

**Bước:** lần lượt chọn file rỗng, file không có đuôi `.tar`; nếu có fixture an toàn lớn hơn giới hạn thì
chọn file đó nhưng không upload qua cách khác.

**Mong đợi:** file rỗng bị từ chối; sai extension bị từ chối; file trên 256 MiB bị từ chối; không tạo
submission và có thông báo tiếng Việt rõ ràng.

**Evidence:** ảnh từng nhóm lỗi; có thể gộp trong video ngắn.

## MAN-QUAL-004 — Team 01 upload OCI archive

**Tiền điều kiện:** dùng fixture OCI thứ nhất; đã ghi SHA-256.

**Bước:** chọn archive `.tar`, nhấn nút nộp, quan sát tính SHA-256, giữ chỗ, upload và trạng thái danh sách;
không double-click.

**Mong đợi:** có progress/waiting state; chỉ tạo một submission; thông báo đã nhận; record mới xuất hiện với
hash/ID/trạng thái tương ứng.

**Evidence:** ảnh success và submission ID/status.

## MAN-QUAL-005 — Team 02 upload archive khác

**Tiền điều kiện:** dùng fixture OCI thứ hai, hash khác Team 01.

**Bước:** thực hiện cùng luồng tại context Team 02.

**Mong đợi:** submission thuộc Team 02; không thấy submission riêng của Team 01; không có cảnh báo duplicate
cho hai hash khác nhau.

**Evidence:** ảnh success, ID/status và hai SHA-256 đã rút gọn.

## MAN-QUAL-006 — Preflight lên ACTIVE

**Bước:** làm mới danh sách của cả hai đội theo chu kỳ hợp lý; quan sát log coordinator/worker nếu chờ lâu.

**Mong đợi:** cả hai submission đi qua trạng thái xử lý và đạt `ACTIVE` trong timeout của runbook; không có
submission `INVALID`, `REVOKED` hoặc `SUPERSEDED`; UI không cần refresh toàn trang liên tục để sửa dữ liệu.

**Evidence:** ảnh `ACTIVE` của từng đội và timestamp.

## MAN-QUAL-007 — Cô lập dữ liệu submission giữa đội

**Bước:** so sánh danh sách ở Team 01 và Team 02; thử thay ID trên URL nếu UI có link trực tiếp.

**Mong đợi:** mỗi đội chỉ thấy dữ liệu được phép; không thấy archive, ID riêng hoặc chi tiết preflight nhạy
cảm của đội kia; thao tác đoán ID không cấp quyền chéo.

**Evidence:** hai ảnh cùng thời điểm, che phần không cần thiết.

## MAN-QUAL-008 — BTC thấy trạng thái cần vận hành

**Bước:** BTC mở trang round và operations/review liên quan, làm mới dữ liệu.

**Mong đợi:** BTC thấy round đang mở và đủ hai submission active để có thể đóng/chạy; thông tin đội và trạng
thái nhất quán với hai browser team; không hiển thị mật khẩu hoặc archive content.

**Evidence:** ảnh admin summary.

## MAN-QUAL-009 — Chống thao tác start sai thời điểm

**Bước:** trước khi hết submission/grace window, thử action close/start nếu UI cho phép; không bypass UI.

**Mong đợi:** action không hợp lệ bị disable hoặc server từ chối với thông báo rõ; round không nhảy sai state;
không tạo match sớm.

**Evidence:** ảnh trạng thái/action hoặc thông báo từ chối.

## MAN-QUAL-010 — Đóng cổng và bắt đầu round

**Tiền điều kiện:** hai submission `ACTIVE`; đã tới thời điểm close theo rule set.

**Bước:** BTC đóng submission, sau đó start round theo action được server cho phép; nhập reason và xác nhận
hai bước nếu UI yêu cầu. Có thể dùng `./scripts/demo.sh round close` theo runbook khi mục tiêu là kiểm tra
luồng vận hành CLI, nhưng phải ghi rõ thay vì coi đó là thao tác UI.

**Mong đợi:** round đi qua `SUBMISSION_CLOSED` rồi `RUNNING`/trạng thái xử lý tương ứng; series/match được tạo
đúng cho hai đội; một thao tác xác nhận không tạo trùng round/job.

**Evidence:** ảnh từng state chính, round/series ID.

## MAN-QUAL-011 — Theo dõi match hoàn tất

**Bước:** quan sát `/admin/results` và `./scripts/demo.sh round status` đến khi series kết thúc; không sửa DB.

**Mong đợi:** các match của series đạt trạng thái kết thúc và series `FINALIZED`; có winner/draw/reason hợp
lệ; không còn job treo; số match phù hợp format qualification đổi phía.

**Evidence:** ảnh danh sách match/series và output status.

## MAN-QUAL-012 — Reconcile/rating/publish round

**Bước:** BTC dùng action hợp lệ để reconcile/finalize rating rồi publish round; nhập reason; refresh trang.

**Mong đợi:** round lần lượt đạt trạng thái rating/published theo state machine; leaderboard có cả hai đội;
rating/played-series thay đổi đúng một lần; publish lại hoặc double-click không nhân đôi dữ liệu.

**Evidence:** ảnh status cuối và leaderboard với hai đội.

## MAN-QUAL-013 — Chặn upload sau khi đóng

**Bước:** sau khi round đóng/published, Team 01 thử nộp lại một fixture hợp lệ.

**Mong đợi:** hệ thống từ chối với thông báo cổng đã đóng/quá hạn; không tạo reservation/submission active
mới và kết quả round cũ không đổi.

**Evidence:** ảnh thông báo và danh sách submission sau thao tác.
