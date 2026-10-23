# Dự án tổ chức giải đấu bot OTTv2

Thư mục này giúp người không làm kỹ thuật hiểu dự án.

Hãy đọc theo thứ tự:

1. [Tổng quan cuộc thi](01-tong-quan.md): luật chơi, cách tính điểm, đội thi làm gì và Ban tổ chức làm gì.
2. [Cách hệ thống phòng tránh sự cố](02-hardening.md): chống tấn công, gian lận, quá tải và sửa kết quả.
3. [Kiến trúc đơn giản](03-kien-truc.md): các phần chính của hệ thống phối hợp với nhau như thế nào.
4. [Bản đồ chức năng trên giao diện](04-ban-do-chuc-nang-ui.md): mỗi việc nằm ở màn hình nào, kèm ảnh chụp trực tiếp từ Frontend.

## Dự án này làm gì?

Đây là hệ thống tổ chức một cuộc thi mà mỗi đội viết chương trình máy tính, gọi là **bot**, để tự chơi game
OTTv2 với bot của đội khác.

Cuộc thi có hai phần:

- **Vòng loại:** thi online theo từng tuần. Các đội tích lũy điểm xếp hạng.
- **Vòng chung kết:** 8 đội đứng đầu thi đấu loại trực tiếp tại địa điểm của Ban tổ chức.

Hệ thống hỗ trợ toàn bộ quá trình:

```text
Cấp tài khoản → Nhận bot → Kiểm tra bot → Chạy trận
→ Tính điểm → Công bố kết quả → Phát lại trận đấu
```

Nếu muốn biết “bấm ở đâu trên giao diện”, hãy đọc [bản đồ chức năng UI](04-ban-do-chuc-nang-ui.md) trước.

## Lưu ý

Các tài liệu trong thư mục này chỉ giải thích dự án bằng ngôn ngữ đơn giản. Nếu cần thông tin chính xác để
lập trình hoặc vận hành, hãy đọc [tài liệu chính thức](../docs/README.md).

Muốn biết tính năng nào đã hoàn thành và được nghiệm thu, xem [danh sách công việc](../tasks/todo.md).
Một tính năng có trong thiết kế chưa chắc đã được triển khai hoặc đưa lên môi trường thật.

Hệ thống hiện được thiết kế ở mức thử nghiệm thực tế trên một máy chủ. Đây chưa phải hệ thống lớn có thể
hoạt động liên tục khi máy chủ hỏng.
