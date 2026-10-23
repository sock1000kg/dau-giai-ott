# Kiến trúc hệ thống — bản đơn giản

## 1. Có thể hình dung hệ thống như một sân vận động

| Trong sân vận động | Trong hệ thống |
| --- | --- |
| Quầy tiếp nhận đội thi | Trang đăng nhập và nộp bot |
| Ban tổ chức | Trang quản trị |
| Phòng điều hành | Máy chủ quản lý tài khoản, lịch và kết quả |
| Khu thi đấu cách ly | Máy chạy bot |
| Trọng tài | Game Engine |
| Kho lưu hồ sơ | Nơi lưu bot, kết quả và replay |
| Bảng điện tử cho khán giả | Trang công khai |

Đội thi và Ban tổ chức làm việc qua trang web. Bot được chuyển vào khu vực cách ly để thi đấu. Khán giả chỉ
xem thông tin đã được công bố trên “bảng điện tử”, không được đi vào phòng điều hành hoặc khu thi đấu.

Các “cửa” mà người dùng thực sự thấy trên Frontend được tổng hợp tại
[bản đồ chức năng UI](04-ban-do-chuc-nang-ui.md).

## 2. Các phần chính

```text
Đội thi / Ban tổ chức
          │
          ▼
   Hệ thống quản lý
   ├─ tài khoản và quyền
   ├─ luật và lịch thi đấu
   ├─ bản nộp và kết quả
   └─ lịch sử thao tác
          │
          ▼
    Hàng chờ thi đấu
          │
          ▼
 Máy chạy bot trong vùng cách ly
          │
          ▼
 Engine xác nhận kết quả

Khán giả ← Trang công khai ← Dữ liệu đã được kiểm tra
```

### Hệ thống quản lý

Quản lý tài khoản, đội, luật, lịch, kết quả và quyền truy cập. Đây là nơi Ban tổ chức điều hành giải.

### Hàng chờ

Giống như số thứ tự tại quầy dịch vụ. Khi có nhiều bot hoặc trận đấu, hệ thống xếp hàng thay vì cố chạy tất
cả cùng lúc.

### Máy chạy bot

Lấy từng trận từ hàng chờ, tạo khu vực riêng cho hai bot và yêu cầu Engine điều khiển trận. Phần này tách
khỏi trang web để một bot lỗi không làm sập toàn bộ hệ thống.

### Nơi lưu dữ liệu

- Cơ sở dữ liệu lưu tài khoản, lịch, trạng thái và kết quả chính thức.
- Kho file lưu các gói bot, dữ liệu trận và replay.
- Hàng chờ giữ các công việc chưa chạy.

### Trang công khai

Nhận một bản dữ liệu đã được chọn lọc rồi phục vụ cho khán giả. Khán giả không đọc trực tiếp từ nơi lưu dữ
liệu hoặc máy chạy bot.

**Mapping UI:**

- Đội thi dùng `/team/submissions` và `/team/results`.
- BTC dùng `/admin/teams`, `/admin/rounds`, `/admin/operations`, `/admin/results`, `/admin/replays`.
- Khán giả dùng `/public`, `/leaderboard`, `/finals` và replay đã phát hành.

## 3. Luồng vòng loại

```text
Ban tổ chức công bố luật
→ Đội nộp bot
→ Hệ thống kiểm tra bot
→ Khóa bản bot dùng cho vòng đấu
→ Xếp lịch
→ Chạy các trận
→ Kiểm tra kết quả
→ Tính điểm xếp hạng
→ Công bố kết quả
```

Điểm quan trọng:

- luật đã mở cho đội thi thì không được sửa giữa vòng;
- bot đã chọn cho một trận không được thay âm thầm;
- chạy lại một công việc không được tạo hai kết quả;
- khán giả xem bản dữ liệu riêng, không làm chậm máy chạy trận.

**Mapping UI:** BTC cấu hình/điều hành tại `/admin/rounds`; đội nộp bot tại `/team/submissions`; kết quả
được đọc ở `/team/results`, `/admin/results` hoặc trang công khai tùy quyền truy cập.

## 4. Luồng chung kết

Chung kết dùng một hệ thống riêng trong mạng nội bộ:

```text
Đội nộp bot trong mạng nội bộ
→ Chạy và lưu kết quả tại địa điểm thi đấu
→ Ban tổ chức tạo gói kết quả có chữ ký điện tử
→ Chuyển gói lên hệ thống online
→ Hệ thống online kiểm tra
→ Công bố kết quả và replay
```

Hệ thống chung kết và hệ thống online không dùng chung nơi lưu dữ liệu. Nhờ vậy, mất Internet không làm
dừng trận và người từ Internet không thể truy cập trực tiếp mạng thi đấu.

**Mapping UI:** trang `/finals` là màn hình xem công khai. Những thao tác LAN như nộp bot chung kết, khóa
bot, tạo và nhập gói kết quả chưa có giao diện Frontend riêng.

## 5. Vì sao không xây thành quá nhiều hệ thống nhỏ?

Phiên bản hiện tại ưu tiên dễ vận hành và chi phí thấp. Phần quản lý được xây thành một ứng dụng chính có
nhiều khu vực chức năng, còn phần chạy bot được tách riêng vì có rủi ro cao hơn.

Chỉ nên tách thêm thành nhiều dịch vụ khi có bằng chứng rõ ràng về nhu cầu tải, bảo mật hoặc đội phụ trách.
Làm quá phức tạp ngay từ đầu sẽ khiến việc triển khai và xử lý sự cố khó hơn.

## 6. Tài liệu kiến trúc chính thức

Phần trên chỉ là bản giải thích dễ hiểu. Không sao chép toàn bộ sơ đồ kỹ thuật vào đây để tránh hai tài liệu
mô tả khác nhau sau này.

- [Kiến trúc vòng loại local](../docs/architecture/solution-architecture-phase-2.md)
- [Kiến trúc vòng loại online và chung kết](../docs/architecture/solution-architecture-phase-3.md)
- [Thiết kế cách nộp và chạy bot](../docs/architecture/sad-oci-bot-submissions.md)
- [Danh sách các quyết định kiến trúc](../docs/README.md)

Các tài liệu trên mô tả thiết kế đã được chấp nhận. Muốn biết phần nào đã được làm và nghiệm thu, vẫn phải
xem [danh sách công việc](../tasks/todo.md).
