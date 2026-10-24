# Tổng quan cuộc thi

## 1. Các khái niệm cần biết

| Từ dùng trong dự án | Hiểu đơn giản |
| --- | --- |
| **Giải đấu** | Toàn bộ cuộc thi, từ đăng ký đến khi có nhà vô địch. |
| **Giai đoạn** | Một phần lớn của giải, ví dụ vòng loại hoặc chung kết. |
| **Vòng** | Một đợt thi đấu. Ở vòng loại, mỗi tuần là một vòng. |
| **Cặp đấu** | Hai đội gặp nhau. |
| **Ván đấu** | Một lần hai bot chơi với nhau. Một cặp đấu có thể gồm nhiều ván. |
| **Bot** | Chương trình do đội thi viết để tự quyết định nước đi. |
| **Bản nộp** | Gói bot mà đội gửi lên hệ thống. |
| **Bộ luật** | Luật, bản đồ, thời gian suy nghĩ và giới hạn áp dụng cho một vòng. |
| **Engine** | “Trọng tài máy”: kiểm tra nước đi, cập nhật bàn cờ và quyết định kết quả. |
| **Replay** | Bản phát lại một trận đã kết thúc. |

## 2. Luật game OTTv2

### Bàn cờ và quân

- Bàn cờ có 9 hàng và 9 cột.
- Mỗi bên có 9 quân: 3 Búa, 3 Bao và 3 Kéo.
- Bên Đỏ đi trước.
- Mỗi lượt, một quân được đi một ô theo 8 hướng xung quanh.
- Quân không được đi ra ngoài bàn cờ, vào chướng ngại vật hoặc vào ô có quân cùng đội.

Luật ăn quân giống trò Oẳn tù tì:

- Búa thắng Kéo.
- Kéo thắng Bao.
- Bao thắng Búa.

### Cách thắng một ván

Một đội thắng khi:

- đưa được một quân tới đích của đối phương; hoặc
- ăn hết quân của đối phương.

Bot cũng có thể bị xử thua nếu bị lỗi nghiêm trọng, ví dụ bị treo, chạy quá giới hạn hoặc cố vi phạm vùng
an toàn của hệ thống.

Ở vòng loại, một ván có thể hòa nếu đã đi hết số lượt cho phép. Ở chung kết, mỗi ván phải tìm ra đội thắng
theo các tiêu chí phụ đã công bố trước.

## 3. Cách tính điểm vòng loại

Mỗi cặp đấu gồm 2 ván. Hai đội đổi bên Đỏ/Xanh sau ván đầu để giảm lợi thế đi trước.

| Kết quả một ván | Điểm |
| --- | ---: |
| Thắng | 1 |
| Hòa | 0,5 |
| Thua | 0 |

Sau 2 ván:

- đội có tổng điểm cao hơn thắng cặp đấu;
- hai đội bằng điểm thì cặp đấu hòa.

Kết quả cặp đấu được dùng để cập nhật điểm xếp hạng Elo. Có thể hiểu Elo như sau:

- thắng đội mạnh được thưởng nhiều hơn;
- thua đội yếu bị trừ nhiều hơn;
- đội mới được điều chỉnh điểm nhanh hơn trong 5 cặp đấu đầu tiên;
- toàn bộ điểm của một vòng chỉ được cập nhật sau khi các cặp đấu trong vòng đã hoàn thành.

Khi chọn đội vào chung kết, hệ thống lần lượt xét:

1. Điểm Elo.
2. Số cặp đấu thắng.
3. Hiệu số điểm giữa các ván thắng và thua.
4. Kết quả đối đầu trực tiếp nếu sau ba tiêu chí trên vẫn chỉ có hai đội bằng nhau.
5. Bốc thăm bằng cách đã được hệ thống ghi lại và có thể kiểm tra.

**Đối đầu trực tiếp** nghĩa là xem lại cặp đấu mà chính hai đội đó đã gặp nhau. Ví dụ đội A và đội B bằng
nhau về Elo, số cặp thắng và hiệu số điểm: nếu A đã thắng B thì A được xếp trên B. Nếu cặp đấu giữa A và B
hòa, hệ thống chuyển sang bước bốc thăm ở mục 5.

Tiêu chí này chỉ dùng khi còn đúng hai đội bằng nhau. Nếu có ba đội trở lên, có thể xảy ra trường hợp A
thắng B, B thắng C nhưng C lại thắng A, nên kết quả đối đầu không tạo được thứ tự rõ ràng.

Một đội thường cần hoàn thành ít nhất 5 cặp đấu để được xét vào chung kết. Ban tổ chức có thể công bố một
ngưỡng thấp hơn nếu giải có ít vòng.

## 4. Cách thi đấu chung kết

- Có 8 đội đứng đầu vòng loại.
- Không chia bảng; đội thua bị loại.
- Các cặp tứ kết là hạng 1 gặp 8, 4 gặp 5, 2 gặp 7 và 3 gặp 6.
- Mỗi cặp thi đấu tối đa 3 ván. Đội thắng 2 ván trước sẽ đi tiếp.
- Sau tứ kết là bán kết và chung kết.
- Có thể tổ chức trận tranh hạng ba.

Luật, bản đồ, bot được sử dụng và giới hạn thời gian đều được khóa trước khi thi đấu. Ban tổ chức không
được tự ý đổi giữa chừng.

## 5. Đội thi tham gia vòng loại như thế nào?

**Tóm tắt một câu:** đội không tự ngồi chơi game. Đội *viết một "người chơi máy tính" (bot)*, nộp lên hệ
thống, rồi bot đó tự thi đấu thay đội với bot của các đội khác. Đội chỉ cần chờ và xem kết quả.

Có thể hình dung như thi đấu cờ bằng cách cử "robot đại diện": đội dạy robot cách chơi, gửi robot cho Ban
tổ chức, còn trận đấu do trọng tài máy tổ chức.

Toàn bộ hành trình gồm 6 bước:

```
Đăng ký → Viết bot → Đóng gói → Nộp bot → Chạy thử → Xem kết quả
```

### Bước 1: Đăng ký và nhận tài khoản

Đội **không tự tạo tài khoản**. Quy trình giống đăng ký tham gia một cuộc thi ở trường:

1. Đội điền thông tin vào biểu mẫu hoặc gửi qua kênh do Ban tổ chức thông báo.
2. Ban tổ chức kiểm tra các thành viên có đúng là sinh viên của trường hay không (qua email của trường).
3. Nếu đủ điều kiện, Ban tổ chức duyệt đội và tạo tài khoản cho đội.
4. Tên đăng nhập và mật khẩu được gửi riêng qua email hoặc kênh liên lạc khác, không hiện trên hệ thống.
5. Đội dùng tài khoản này để vào trang web dành cho đội thi.

Nếu quên mật khẩu, đội báo Ban tổ chức để được cấp lại.

**Trên giao diện:** đội bắt đầu tại màn hình **Đăng nhập** (`/`), sau đó vào **Cổng đội thi** (`/team`).
Xem ảnh và đường đi chi tiết trong [bản đồ UI](04-ban-do-chuc-nang-ui.md#2-đội-thi-bắt-đầu-từ-đâu).

### Bước 2: Viết bot

**Bot là gì?** Là một chương trình máy tính do đội tự viết, có nhiệm vụ *chọn nước đi* khi đến lượt mình.
Mỗi lượt, hệ thống cho bot biết bàn cờ đang như thế nào và những nước nào được phép đi. Bot suy nghĩ rồi
trả lời "tôi đi quân này sang ô kia". Chất lượng của bot, tức là nó chọn nước đi khôn hay dở, quyết định đội
thắng hay thua.

Điều quan trọng: bot **không cần biết kiểm tra luật**. Hệ thống đã có "trọng tài máy" (Engine) lo việc đó.
Nếu bot đề xuất nước đi sai luật, trọng tài sẽ phát hiện.

Ban tổ chức hỗ trợ các đội bằng:

- tài liệu giải thích bot nhận thông tin và gửi nước đi theo cách nào (giống một bản "hướng dẫn giao tiếp");
- bot mẫu để xem và luyện tập;
- bộ khởi đầu (starter kit) cho các ngôn ngữ lập trình phổ biến, để đội không phải bắt đầu từ con số 0;
- quy định giới hạn: bot được nghĩ tối đa bao lâu mỗi nước, dùng bao nhiêu bộ nhớ, file nặng tối đa bao nhiêu.

**Mapping tới UI hiện tại:**

- Luật của round (gồm thời gian và các giới hạn) được xem tại trang công khai **Thông tin giải đấu**
  (`/public`) và được BTC soạn tại **Round** (`/admin/rounds`).
- Tài liệu giao tiếp bot, bot mẫu và hướng dẫn starter kit được tải ngay tại **Thông tin giải đấu**
  (`/public`), thẻ **Tài nguyên làm bot**, nút **Tải bộ tài nguyên làm bot (.zip)**.
- Gói tải gồm Bot Protocol v2, JSON Schema, dữ liệu giao tiếp mẫu, bot mẫu Python/Node.js/Go và hướng
  dẫn đóng gói file OCI `.tar` để nộp.
- Chức năng **chạy thử bot** cũng chưa có mục riêng trên menu của đội thi.

![Nút tải bộ tài nguyên làm bot trên trang công khai](images/ui-public-bot-resources.png)

Xem đầy đủ phần nào đã có UI và phần nào cần bổ sung tại [bản đồ UI](04-ban-do-chuc-nang-ui.md#3-nội-dung-hỗ-trợ-người-viết-bot-nằm-ở-đâu).

### Bước 3: Đóng gói bot để nộp

Bot không được nộp dưới dạng vài file mã lẻ tẻ. Đội phải **đóng gói mọi thứ bot cần vào một file duy nhất**,
giống như cho cả bộ đồ nghề vào một chiếc vali kín: có chương trình, có các thư viện đi kèm, mở ra là chạy
được ngay trên máy của Ban tổ chức mà không cần cài thêm gì.

Về mặt kỹ thuật, loại "vali" này gọi là OCI image (giống gói Docker), file nộp có đuôi `.tar`. Đội không cần
hiểu sâu; chỉ cần làm theo hướng dẫn của Ban tổ chức.

Hai điều cần nhớ:

- Bot **không được lên mạng tải thêm gì** khi đang thi đấu. Mọi thứ phải có sẵn trong gói.
- Ban tổ chức **không chấp nhận** các cách nộp khác: gửi riêng file mã nguồn, gửi đường link tải, hoặc nhờ
  Ban tổ chức kết nối vào máy tính của đội.

**Trên giao diện:** chọn file `.tar` tại **Nộp bot** (`/team/submissions`), rồi bấm **Nộp bot**. Màn hình
đồng thời hiển thị lịch sử và trạng thái từng bản nộp.

### Bước 4: Nộp bot và hệ thống kiểm tra

Mỗi vòng, cổng nộp bài mở trong **nhiều ngày**, nên đội không phải vội vàng. Khi đội bấm **Nộp**, hệ thống
làm lần lượt các việc sau:

1. **Ghi "dấu vân tay" của file.** Trình duyệt tính ra một dãy ký tự đặc trưng cho nội dung file (nếu sửa
   dù một chút, dãy này đổi hoàn toàn). Nhờ vậy hệ thống chứng minh được đội đã chọn đúng file nào, vào
   lúc nào, và không thể đổi file sau hạn.
2. **Tải file lên hệ thống.**
3. **Kiểm tra sơ bộ:** đúng định dạng chưa, có quá nặng không, có dấu hiệu nguy hiểm không.
4. **Chạy thử trong "phòng cách ly".** Bot được chạy trong một môi trường khép kín, không ra Internet, không
   đụng được vào phần còn lại của hệ thống, để chắc chắn bot chạy được và không gây hại.
5. **Kết quả:** nếu đạt, bản nộp chuyển sang trạng thái *sẵn sàng thi đấu*. Nếu không đạt, đội thấy trạng
   thái lỗi và có thể sửa rồi nộp lại.

**Nếu mạng chậm sát giờ đóng cổng?** Chỉ cần đội đã bấm nộp và hệ thống đã ghi nhận dấu vân tay *trước* hạn,
file vẫn được phép tải xong trong một khoảng thời gian gia hạn ngắn, với điều kiện nội dung không bị thay
đổi. Như vậy đội không bị thiệt vì đường truyền chậm.

**Được nộp nhiều lần không?** Có. Khi cổng còn mở, đội có thể nộp lại để cải tiến bot. Khi cổng đóng, hệ
thống tự lấy **bản hợp lệ nộp muộn nhất** làm bot thi đấu cho vòng đó.

### Bước 5: Chạy thử

Trước khi tới vòng thi thật, đội có thể cho bot đấu thử để biết nó có chạy ổn không. Giống tập đá bóng
giao hữu trước giải. Số lượt chạy thử của mỗi đội là **có giới hạn** để máy chủ không bị quá tải.

Khi chạy thử, đội chỉ được chọn đối thủ là:

- bot mẫu do Ban tổ chức cung cấp; hoặc
- một phiên bản bot khác của chính đội mình.

Đội **không** được dùng chạy thử để đấu với bot của đội khác (vì như vậy sẽ lộ chiến thuật của đội bạn).
Kết quả chạy thử **không tính vào bảng xếp hạng**, và chỉ đội sở hữu mới xem được.

**Lưu ý về UI:** đây là yêu cầu của sản phẩm; Frontend hiện chưa có màn hình/nút chạy thử riêng để đội thi
tự sử dụng.

### Bước 6: Thi đấu và theo dõi kết quả

Sau khi cổng nộp đóng, hệ thống **tự động ghép cặp** các đội và cho bot đấu với nhau; đội không phải làm gì
thêm. Mỗi tuần là một vòng (xem mục 1). Sau mỗi vòng, đội có thể xem:

- bản nộp của mình đã được chấp nhận hay chưa;
- bản nộp đang chờ kiểm tra hay chờ tới lượt thi đấu;
- kết quả từng ván và từng cặp đấu (cách tính điểm ở mục 3);
- bảng xếp hạng;
- **replay**: bản phát lại các trận có đội mình, để xem bot đã chơi thế nào và rút kinh nghiệm cho lần nộp
  sau.

Còn **khán giả** thì chỉ xem được luật, tiến độ, lịch thi, kết quả và bảng xếp hạng. Replay của vòng loại
**không công khai**, để các đội không xem lén chiến thuật của nhau.

**Trên giao diện:** đội mở **Kết quả** (`/team/results`) và replay riêng từ danh sách kết quả. Khán giả dùng
`/public` và `/leaderboard`; họ không có nút xem replay vòng loại.

## 6. Đội thi tham gia chung kết như thế nào?

1. Ban tổ chức công bố 8 đội, thứ hạng và luật chung kết.
2. Các đội kết nối vào mạng nội bộ tại địa điểm thi đấu.
3. Đội được nộp lại bot nếu luật chung kết có thay đổi.
4. Bot vẫn phải qua bước kiểm tra an toàn như ở vòng loại.
5. Bản hợp lệ cuối cùng được khóa để dùng trong toàn bộ chung kết.
6. Đội theo dõi lịch, nhánh thi đấu và kết quả tại địa điểm tổ chức.

Chung kết không cần Internet để chạy trận. Sau mỗi vòng, Ban tổ chức chuyển kết quả đã được xác thực lên
trang web để khán giả theo dõi.

**Trên giao diện:** trang `/finals` hiển thị thông tin chung kết công khai. Các màn hình vận hành trong mạng
nội bộ, nộp bot chung kết và chuyển gói kết quả chưa có UI riêng trong Frontend hiện tại.

## 7. Ban tổ chức quản lý vòng loại như thế nào?

### Chuẩn bị

- Duyệt danh sách và cấp tài khoản cho các đội.
- Chọn Engine, bản đồ, thời gian suy nghĩ, số lượt tối đa và giới hạn tài nguyên.
- Chạy thử luật bằng bot mẫu.
- Công bố luật và lịch trước khi mở cổng nộp.

Khi cổng nộp đã mở, bộ luật của vòng đó bị khóa. Muốn thay đổi, Ban tổ chức phải tạo bộ luật mới cho vòng
sau, không sửa kết quả của vòng đang chạy.

**Trên giao diện:** BTC dùng **Đội thi** (`/admin/teams`) để cấp tài khoản và **Round** (`/admin/rounds`) để
soạn, khóa và điều hành bộ luật/vòng loại.

### Trong khi vòng đang chạy

Ban tổ chức có thể:

- xem số bot đang chờ kiểm tra và số trận đang chờ chạy;
- xem máy chạy trận có khỏe hay không;
- tạm dừng nhận trận mới khi máy quá tải;
- chạy lại trận bị lỗi do hạ tầng;
- loại một bản nộp nguy hiểm;
- đình chỉ đội vi phạm;
- đăng thông báo khi có sự cố.

Hệ thống phân biệt lỗi của bot và lỗi của máy chủ. Đội không bị xử thua chỉ vì máy chủ gặp sự cố.

Mọi thao tác quan trọng đều ghi lại ai làm, làm lúc nào, lý do gì và giá trị trước/sau. Khiếu nại được tiếp
nhận qua kênh riêng như email hoặc hệ thống quản lý công việc; hành động xử lý trên nền tảng vẫn phải có lý
do và lịch sử.

**Trên giao diện:** các việc này được tách thành **Đặc quyền** (`/admin/operations`), **Kết quả**
(`/admin/results`) và **Replay** (`/admin/replays`).

### Kết thúc vòng

- Kiểm tra các cặp đấu đã hoàn thành.
- Tính điểm xếp hạng đúng một lần.
- Công bố kết quả và bảng xếp hạng.
- Mở vòng tiếp theo sau khi kết quả vòng trước đã được chốt.

## 8. Ban tổ chức quản lý chung kết như thế nào?

- Khóa 8 đội, nhánh thi đấu, luật, bản đồ và bot của từng đội.
- Chuẩn bị mạng nội bộ, máy chủ, bản sao dữ liệu dự phòng và quy trình phục hồi.
- Kiểm tra hệ thống bằng bot mẫu trước giờ thi đấu.
- Theo dõi và điều phối từng cặp đấu.
- Chỉ cho đội thắng đi tiếp sau khi kết quả đã được xác nhận.
- Ghi rõ lý do và bằng chứng nếu trọng tài phải can thiệp.
- Sau mỗi vòng, tạo một gói kết quả có chữ ký điện tử rồi chuyển lên hệ thống online.

Hệ thống online kiểm tra chữ ký và toàn bộ file trước khi công bố. Nếu một file bị thiếu hoặc bị sửa, cả gói
kết quả sẽ bị từ chối. Chức nâng này sẽ không có trên website demo public do đặc thù của luồng vận hành.

**Trên giao diện:** `/finals` là màn hình công khai để xem dữ liệu đã được xác thực. Frontend hiện chưa có
màn hình BTC riêng cho việc tạo hoặc nhập gói kết quả chung kết.

## 9. Những việc hệ thống không làm

- Không cho bot truy cập Internet trong trận.
- Không cho đội tự sửa kết quả.
- Không phát trực tiếp dữ liệu từ máy chạy bot ra Internet.
- Không dùng bảng tính online làm nơi quyết định thứ tự chạy trận.
- Không tự kết luận hai đội đạo code; hệ thống chỉ đánh dấu các bản nộp giống hệt để Ban tổ chức xem xét.
- Không hứa hệ thống vẫn hoạt động khi máy chủ duy nhất bị hỏng.

## 10. Muốn đọc chi tiết hơn

- [Đặc tả yêu cầu đầy đủ](../docs/tai-lieu-yeu-cau.md)
- [Quy định nộp và chạy bot](../docs/architecture/sad-oci-bot-submissions.md)
- [Quy định vòng chung kết](../docs/contracts/finals-format-v1.md)
