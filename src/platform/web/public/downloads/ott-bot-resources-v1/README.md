# Bộ tài nguyên làm bot OTT

Đây là gói tài nguyên công khai để đội thi bắt đầu làm bot.

## Trong gói có gì?

- `protocol/`: tài liệu, JSON Schema và ví dụ giao tiếp của Bot Protocol v2.
- `samples/python/`: SDK và hai bot Python mẫu theo Protocol v2.
- `samples/node/`: bot Node.js mẫu theo Protocol v2.
- `samples/go/`: bot Go mẫu theo Protocol v2.
- `starter-kits/README.md`: hướng dẫn đóng gói bot thành file OCI `.tar` để nộp.

Các bot mẫu chỉ chọn một nước đi hợp lệ đơn giản. Đội thi cần tự viết chiến thuật của mình.

## Bắt đầu nhanh

1. Mở trang `/public` và đọc phần **Luật hiện tại** để biết round dùng Protocol nào và giới hạn tài nguyên.
2. Đọc tài liệu Protocol tương ứng trong thư mục `protocol/`.
3. Chọn một bot mẫu gần với ngôn ngữ đội muốn dùng.
4. Sửa chiến thuật nhưng giữ nguyên cách đọc `STDIN` và gửi một dòng JSON qua `STDOUT`.
5. Làm theo `starter-kits/README.md` để tạo file OCI `.tar`.
6. Đăng nhập tài khoản đội và nộp file tại `/team/submissions` trước giờ đóng cổng.

## Lưu ý quan trọng

- Giới hạn thời gian, bộ nhớ và dung lượng không được đóng cứng trong gói này vì có thể thay đổi theo round.
- `legalActions` là danh sách nước đi hệ thống cho phép. Bot chọn một nước trong danh sách này; hệ thống vẫn kiểm tra lại trước khi thực hiện.
- Chỉ ghi message giao tiếp vào `STDOUT`. Ghi log hỗ trợ tìm lỗi vào `STDERR`.
- Xem tên gói `ott-bot-resources-v1` là phiên bản của bộ tài nguyên, không phải phiên bản Protocol bắt buộc của round.
