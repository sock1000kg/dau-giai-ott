# Chạy thử bot — kiểm tra thủ công

Chạy các case này sau khi API/worker `P3-N09` và UI `P3-D11` đã được tích hợp trên stack demo. Ghi trạng thái, thời gian, run ID và ảnh/log đã che thông tin nhạy cảm vào biên bản riêng; không đánh dấu Pass nếu chạy bằng mock/fixture.

## MAN-TEST-001 — Menu và phân quyền

**Tiền điều kiện:** có tài khoản Team 01, Team 02 và BTC.

**Bước:** đăng nhập từng vai trò; xem menu, mở trực tiếp `/team/test-runs` và đường dẫn replay của một test-run.

**Mong đợi:** Team thấy mục **Chạy thử bot**; BTC và anonymous không truy cập được route team; Team 02 không đọc được run/replay của Team 01.

**Evidence:** ảnh menu và trạng thái từ chối truy cập; ghi role và URL.

## MAN-TEST-002 — Policy, quota và đối thủ

**Tiền điều kiện:** Team 01 có ít nhất một submission `VALID` hoặc `ACTIVE`. Để chạy case reference bot thật, cấu hình artifact và digest theo `docs/contracts/test-run-v1.md`; nếu chưa có catalog entry, xác nhận UI giải thích bot BTC chưa cấu hình và nút submit bị khóa. Có ít nhất hai submission hợp lệ nếu muốn kiểm tra opponent cùng đội.

**Bước:** mở `/team/test-runs`; so quota, giờ reset, trạng thái pause và opponent với policy API; thử đổi giữa BTC reference và submission khác.

**Mong đợi:** chỉ submission hợp lệ được chọn; opponent khớp policy; khi catalog reference rỗng, quota bằng 0 hoặc admission pause thì action phù hợp bị khóa kèm thông báo; UI không tự suy ra quota.

**Evidence:** ảnh policy UI và response đã loại bỏ cookie/token.

## MAN-TEST-003 — Tạo, retry và theo dõi lượt chạy

**Tiền điều kiện:** quota còn; queue/worker hoạt động; BTC reference bot thật đã được cấu hình.

**Bước:** gửi một lượt với reference bot; ghi request/run ID; thử click nhanh hai lần; quan sát danh sách và refresh trang. Lặp lại với submission khác cùng đội nếu policy cho phép.

**Mong đợi:** một intent chỉ tạo một run; trạng thái chuyển `QUEUED` → `RUNNING` → terminal; kết quả hiển thị; lượt thử không làm thay đổi Elo/rating. Lỗi hạ tầng hiện đúng trạng thái và quota theo policy.

**Evidence:** run ID, trạng thái theo thời gian và đối chiếu quota/rating trước-sau.

## MAN-TEST-004 — Replay integrity và quyền riêng tư

**Tiền điều kiện:** có test-run hoàn tất, replay sẵn sàng.

**Bước:** mở link replay từ lịch sử; thử mở cùng URL ở Team 02; trong môi trường kiểm thử riêng, kiểm tra response checksum/version sai.

**Mong đợi:** owner xem replay sau khi xác minh checksum/schema/media type; đội khác nhận từ chối/không tồn tại; replay sai integrity/version không được render.

**Evidence:** ảnh replay verified và kết quả negative access/integrity test; không lưu payload bí mật.
