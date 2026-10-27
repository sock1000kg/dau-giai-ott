# Cách hệ thống phòng tránh sự cố

## 1. “Hardening” là gì?

Hardening có nghĩa là chuẩn bị hệ thống để vẫn an toàn và công bằng khi có người cố tình phá, khi nhiều
người dùng cùng lúc hoặc khi máy chủ gặp lỗi.

Hệ thống áp dụng bốn nguyên tắc:

1. Không tin file và chương trình do người dùng gửi lên.
2. Tách khu vực chạy bot khỏi dữ liệu và trang quản trị.
3. Ghi lại các thao tác quan trọng để có thể kiểm tra sau này.
4. Khi quá tải thì cho người dùng chờ, không làm mất bot hoặc kết quả.

Các biện pháp dưới đây giúp giảm rủi ro nhưng không bảo đảm hệ thống không bao giờ bị tấn công. Phiên bản
hiện tại vẫn phụ thuộc vào một máy chủ chính.

Mỗi biện pháp có liên quan tới giao diện được ghi rõ bên dưới. Bảng đầy đủ đường dẫn/màn hình nằm ở
[bản đồ UI](04-ban-do-chuc-nang-ui.md).

## 2. Bảo vệ vòng loại

### 2.1 Nếu có người cố chiếm tài khoản

Hệ thống:

- giới hạn số lần thử đăng nhập;
- không cho biết một tên tài khoản có tồn tại hay không;
- lưu mật khẩu dưới dạng đã mã hóa một chiều, không lưu mật khẩu gốc;
- tự vô hiệu các phiên đăng nhập cũ khi Ban tổ chức cấp lại mật khẩu;
- kiểm tra quyền ở máy chủ, không chỉ ẩn nút trên màn hình;
- yêu cầu Ban tổ chức dùng thêm mã xác thực một lần khi chạy giải thật;
- chỉ cho phép vào trang quản trị từ mạng nội bộ hoặc mạng riêng đã được duyệt.

Các máy lưu dữ liệu và máy chạy bot không được mở trực tiếp ra Internet.

**UI liên quan:** màn hình **Đăng nhập** là nơi đội/BTC vào hệ thống. TOTP và giới hạn mạng là kiểm soát
ở phía máy chủ, nên không phải lúc nào người dùng cũng nhìn thấy trên UI.

### 2.2 Nếu có người nộp bot độc hại

Bot do đội thi viết nên luôn được xem là chương trình không đáng tin cậy.

Trước khi chạy, hệ thống kiểm tra:

- file có đúng định dạng hay không;
- file có bị sửa trong lúc truyền hay không;
- dung lượng và số thành phần bên trong có vượt giới hạn không;
- bot có khởi động và giao tiếp đúng quy định không.

**Kiểm tra mã băm (SHA-256) của gói OCI.** Mỗi thành phần trong gói bot đều được khai báo kèm một mã băm
`sha256` và dung lượng. Hệ thống không tin các khai báo này mà tự tính lại:

1. Đọc danh sách trong gói (`index.json`) và `manifest`. Gói chỉ được có một bản cho `linux/amd64`.
2. Với `manifest`, file cấu hình và từng **layer** (lớp nội dung của image), hệ thống lấy file tương ứng,
   so dung lượng thực với dung lượng khai báo, rồi tính lại SHA-256 và so với mã băm khai báo.
3. Thiếu file hoặc mã băm lệch dù chỉ một byte (`OCI_DIGEST_MISMATCH`) thì cả bản nộp bị từ chối.
4. Layer phải nằm ngay trong gói. Layer trỏ ra đường link bên ngoài bị từ chối, nên bot không thể tải thêm
   mã sau khi đã qua kiểm tra.
5. Các mã băm của `manifest` và cấu hình được lưu lại và gắn cứng vào từng trận chính thức. Khi nạp image
   vào máy chạy bot, hệ thống đối chiếu lại: image được nạp phải đúng mã băm đã lưu.

Nhờ vậy bản nộp không thể bị đổi ruột sau khi qua kiểm tra, và cùng một mã băm luôn là cùng một bot. Các
layer giống hệt nhau cũng được nhận ra qua mã băm để lưu một lần (xem 2.4) và để đánh dấu bản nộp trùng.

Khi thi đấu, mỗi bot chạy trong một khu vực cách ly riêng:

- không có Internet;
- không được đọc file của máy chủ hoặc bot khác;
- không có quyền quản trị;
- bị giới hạn CPU, bộ nhớ, số chương trình con, dung lượng ghi và thời gian chạy;
- toàn bộ chương trình con bị dừng khi trận kết thúc hoặc bot bị treo.

Engine, tức “trọng tài máy”, chạy bên ngoài khu vực của bot. Vì vậy bot chỉ có thể đề xuất nước đi, không
thể tự sửa bàn cờ hoặc tự khai mình thắng.

**UI liên quan:** tại **Nộp bot** (`/team/submissions`), đội thấy tiến trình kiểm tra và trạng thái bot.
UI không cho đội cấu hình vùng cách ly, vì đây là phần bảo vệ do hệ thống thực hiện.

### 2.3 Nếu có đội cố gian lận

| Cách gian lận có thể xảy ra | Hệ thống xử lý thế nào |
| --- | --- |
| Một người lập nhiều đội | Ban tổ chức xác minh email trường và danh sách thành viên trước khi cấp tài khoản. |
| Chọn đối thủ có lợi | Hệ thống tự ghép cặp theo điểm và cách bốc thăm đã khóa trước. |
| Bot nhận ra danh tính đối thủ | Bot chỉ nhận mã trận không chứa tên đội. |
| Bot đoán thông tin bí mật của đối thủ | Mỗi bot nhận dữ liệu ngẫu nhiên riêng; không nhận dữ liệu bí mật của Engine hoặc đối thủ. |
| Dùng trận thử để nghiên cứu bot đội khác | Chạy thử chỉ được đấu bot mẫu hoặc bot khác của chính đội. |
| Hai đội cố tình dàn xếp | Hệ thống đánh dấu các trận thua quá nhanh hoặc lỗi lặp lại để Ban tổ chức xem replay. |
| Hai đội nộp bot giống hệt | Hệ thống đánh dấu file giống nhau để Ban tổ chức kiểm tra; không tự kết luận đạo code. |
| Sửa bot hoặc luật sau hạn | Bot, luật và bản đồ được khóa trước khi chạy trận. |
| Sửa kết quả đã có | Kết quả và dữ liệu trận có “dấu vân tay” để phát hiện thay đổi. |

Replay vòng loại chỉ cho hai đội trong trận và Ban tổ chức xem. Điều này giảm nguy cơ lộ chiến thuật nhưng
không ngăn một đội tự chia sẻ replay của mình bên ngoài hệ thống.

**UI liên quan:** đội xem kết quả/replay riêng tại `/team/results`; BTC dùng `/admin/results` và
`/admin/replays`. Khán giả không có đường dẫn replay vòng loại.

### 2.4 Nếu nhiều đội nộp cùng lúc

Vấn đề thường xảy ra gần giờ hết hạn. Hệ thống xử lý như sau:

1. Cổng nộp mở trong nhiều ngày để tránh dồn vào một thời điểm.
2. Khi đội bấm **Nộp**, hệ thống ghi nhận “dấu vân tay” của file trước.
3. Nếu mạng chậm, file có thể tải xong trong thời gian gia hạn, nhưng nội dung phải đúng với file đã chọn.
4. Hệ thống giới hạn số lượt upload cùng lúc.
5. Khi đang quá tải, đội được báo phải chờ hoặc thử lại sau, thay vì để trang bị treo.
6. Trận chính thức được ưu tiên trước việc kiểm tra bot và chạy thử.

Các phần giống nhau giữa nhiều gói bot được lưu một lần để tiết kiệm dung lượng. Các bản cũ không còn cần
thiết sẽ được dọn theo chính sách đã công bố.

**UI liên quan:** `/team/submissions` hiển thị trạng thái và vị trí chờ kiểm tra; không hiển thị chi tiết
nội bộ về cách hệ thống lưu file.

### 2.5 Nếu nhiều người cùng xem kết quả

Khán giả không đọc trực tiếp từ máy đang chạy trận.

Hệ thống định kỳ tạo một bản thông tin công khai gồm tiến độ, lịch, kết quả và bảng xếp hạng. Bản này được
đưa lên dịch vụ chuyên phục vụ nhiều người xem.

Nhờ đó:

- lượng khán giả lớn không làm bot chạy chậm;
- khán giả không thể truy cập cơ sở dữ liệu hoặc máy chạy bot;
- khi hệ thống chính tạm lỗi, trang vẫn hiện bản cập nhật gần nhất;
- trang ghi rõ thời điểm cập nhật để người xem biết dữ liệu có đang chậm hay không.

Đổi lại, thông tin có thể chậm vài chục giây và không phải truyền hình trực tiếp.

**UI liên quan:** trang `/public` hiển thị thời điểm cập nhật và cảnh báo khi dữ liệu đã cũ.

### 2.6 Nếu máy chủ quá tải hoặc bị khởi động lại

- Hệ thống lưu lịch và kết quả chính thức trong cơ sở dữ liệu.
- Công việc đang chờ được giữ trong hàng đợi và có thể tiếp tục sau khi khởi động lại.
- Một trận có thể được chạy lại khi lỗi máy, nhưng chỉ được ghi nhận một kết quả chính thức.
- Điểm xếp hạng cũng chỉ được cập nhật một lần.
- Máy chủ tự giảm số trận chạy cùng lúc khi thiếu CPU, bộ nhớ hoặc quá nóng.
- Trận chính thức được ưu tiên; các lượt chạy thử có thể phải chờ.
- Dữ liệu được sao lưu ra nơi khác trước và sau mỗi vòng.

Nếu Internet mất, các trận nội bộ vẫn tiếp tục. Trang công khai có thể chậm cập nhật. Vì chỉ có một máy chủ
chính, khi máy đó hỏng vẫn có thời gian gián đoạn để phục hồi dữ liệu.

**UI liên quan:** BTC quan sát và thực hiện các thao tác có quyền tại `/admin/operations`; người xem công
khai chỉ thấy thông báo/trạng thái trên `/public`.

### 2.7 Nếu Ban tổ chức thao tác nhầm hoặc lạm quyền

Các thao tác như chạy lại trận, loại bot, sửa điểm hoặc thay đổi trạng thái giải phải ghi:

- ai thực hiện;
- thời điểm;
- lý do;
- dữ liệu trước và sau khi thay đổi.

Không xóa lịch sử cũ để che thay đổi. Nếu phải điều chỉnh điểm, hệ thống thêm một bản ghi điều chỉnh mới.

**UI liên quan:** phần **Đặc quyền** (`/admin/operations`) là nơi dành cho thao tác cần lý do và có audit.

## 3. Bảo vệ vòng chung kết

### 3.1 Tách mạng thi đấu khỏi Internet và khán giả

Chung kết chạy trên mạng nội bộ tại địa điểm tổ chức:

- không cần Internet để chạy trận;
- máy của đội thi không được truy cập máy chạy bot;
- Wi-Fi của khán giả được tách khỏi mạng thi đấu;
- bot vẫn bị cách ly và giới hạn như ở vòng loại;
- luật, bản đồ và bot của từng đội được khóa trước khi thi đấu.

Cách này giảm nguy cơ tấn công từ xa. Ban tổ chức vẫn phải kiểm soát thiết bị cắm vào máy, người được vào
khu vực kỹ thuật và cách chuyển file ra khỏi mạng nội bộ.

**UI liên quan:** hiện chưa có màn hình Frontend riêng cho vận hành LAN chung kết; đây là một khoảng trống
cần hoàn thiện trước khi dùng cho sự kiện thật.

### 3.2 Bảo vệ sự công bằng

- 8 vị trí xếp hạng được khóa trước khi tạo nhánh đấu.
- Cách chọn bên và bản đồ được quyết định trước, không đổi theo ý trọng tài trong lúc thi đấu.
- Một đội chỉ được đi tiếp sau khi kết quả cặp đấu đã được xác nhận.
- Nếu một ván chưa phân thắng bại theo luật chính, hệ thống dùng các tiêu chí phụ đã công bố trước.
- Mọi can thiệp của trọng tài phải có lý do và bằng chứng.

### 3.3 Ngăn sửa kết quả khi chuyển từ mạng nội bộ lên Internet

Sau mỗi vòng, hệ thống tạo một **gói kết quả**. Có thể hình dung đây là một phong bì điện tử gồm kết quả,
nhánh đấu và dữ liệu replay.

Ban tổ chức ký phong bì bằng một chữ ký điện tử chỉ có trong mạng chung kết. Hệ thống online có thể kiểm tra
chữ ký nhưng không thể tự tạo chữ ký giả.

Quy trình:

```text
Mạng chung kết tạo và ký gói kết quả
→ chuyển gói ra ngoài bằng kênh được kiểm soát
→ hệ thống online kiểm tra chữ ký và từng file
→ đúng hoàn toàn mới công bố
```

Nếu thiếu một file hoặc một file bị sửa, toàn bộ gói bị từ chối. Nếu cần sửa kết quả, Ban tổ chức phải tạo
phiên bản mới và ghi rõ lý do; không được âm thầm ghi đè.

**UI liên quan:** `/finals` chỉ đọc dữ liệu chung kết đã xác thực. UI BTC để tạo/nhập gói kết quả chưa có.

Phiên bản thử nghiệm chưa có thiết bị chuyên dụng để giữ khóa ký và chưa tự động thay khóa định kỳ. Đây là
phần cần bổ sung nếu hệ thống được nâng lên mức vận hành lớn hơn.

### 3.4 Bảo vệ khán giả và replay

- Khán giả chỉ xem dữ liệu sau khi gói kết quả đã được kiểm tra.
- Replay chỉ được công bố sau khi trận kết thúc và dữ liệu còn nguyên vẹn.
- Trang xem replay không kết nối trực tiếp vào máy chạy bot hoặc mạng chung kết.
- Giao diện chỉ hiển thị kết quả do Engine xác nhận, không tự tính lại người thắng.

## 4. Ví dụ xử lý sự cố

| Sự cố | Vòng loại | Chung kết |
| --- | --- | --- |
| Bot bị treo | Xử lý theo luật: bỏ lượt hoặc xử thua | Xử lý theo bộ luật chung kết đã khóa |
| Máy chạy trận bị lỗi | Chạy lại, không tính đội thua | Phục hồi trong mạng nội bộ, chưa cho đội đi tiếp |
| Nhiều đội nộp sát hạn | Xếp hàng và dùng dấu vân tay ghi nhận file | Nhận trong khung nộp tại địa điểm và vẫn kiểm tra an toàn |
| Quá nhiều khán giả | Phục vụ bằng bản thông tin công khai tách riêng | Công bố kết quả/replay sau khi gói được xác thực |
| File bot nguy hiểm | Chặn hoặc thu hồi bản nộp | Chặn trước khi khóa bot thi đấu |
| Kết quả bị sửa | Phát hiện bằng dấu vân tay dữ liệu | Phát hiện bằng chữ ký điện tử và dấu vân tay từng file |
| Mất Internet | Trận vẫn chạy, trang cập nhật chậm | Chung kết vẫn chạy hoàn toàn trong mạng nội bộ |
| Máy chủ hỏng | Khôi phục từ bản sao lưu, có thời gian gián đoạn | Khôi phục tại chỗ; phiên bản thử nghiệm chưa có máy thay thế tự động |

## 5. Cần kiểm tra gì trước khi mở giải?

Không nên kết luận hệ thống an toàn chỉ vì các chức năng trên đã được viết. Trước khi mở giải cần thử thật:

- đăng nhập sai nhiều lần và truy cập nhầm dữ liệu đội khác;
- gửi file bot lỗi hoặc cố tình phá;
- nhiều đội upload cùng lúc;
- nhiều người cùng mở trang kết quả;
- tắt hoặc khởi động lại máy chạy trận giữa chừng;
- sao lưu và phục hồi dữ liệu;
- sửa một file trong gói kết quả chung kết để chắc chắn hệ thống từ chối.

Trạng thái các lần kiểm tra và nghiệm thu được theo dõi trong [danh sách công việc](../tasks/todo.md).
