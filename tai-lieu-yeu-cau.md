# Tổng quan Kiến trúc Hệ thống (High-Level Architecture)
Hệ thống được chia thành 4 service độc lập, tuân thủ nguyên tắc Decoupled Architecture:

- Tournament REST API: Quản lý tài khoản, danh tính đội thi, nhận file code .py, cập nhật Elo và quản lý Leaderboard.

- Matchmaking Queue (Hàng đợi xử lý): Sử dụng Message Broker (RabbitMQ hoặc Redis) để xếp hàng các trận đấu, đảm bảo hệ thống không bị quá tải.

- Sandbox Execution & Game Engine: Cụm Worker chịu trách nhiệm khởi tạo Docker container cô lập, chạy code của người chơi (không có internet) và chạy Game Engine nội bộ để xử lý luật chơi, phân xử thắng/thua.

- Replay & Spectator UI: Giao diện Web (tái sử dụng từ thư viện hiện có) có nhiệm vụ đọc file Log để render lại trận đấu cho khán giả xem với tốc độ tùy chỉnh.


## Phase 1: Core Game & API Backend (Kiểm thử Đầu cuối)
Mục tiêu: Đưa logic game lên một Authoritative Server độc lập, đảm bảo bot có thể giao tiếp, nhận trạng thái lưới (grid) và gửi lệnh di chuyển/tấn công.

### IMPORTANT REFERENCE
Logic game kế thừa trực tiếp từ game trong repo sau, đảm bảo game cốt lõi phải giống y hệt logic: https://github.com/sock1000kg/rock-paper-scissor/

1. Cơ chế Game & Game Engine:

Trạng thái (State): Board 9x9 với các quân cờ (Búa, Bao, Kéo) được phép di chuyển trong phạm vi 8 ô xung quanh nó. Engine quản lý vị trí, số lượng, điểm (nếu có).

Turn-based Flow:

Engine gửi GameState hiện tại cho Bot A.

Bot A có 3 giây (Timeout) để tính toán và gửi mảng Action.

Engine xử lý Action của Bot A, cập nhật trạng thái, sau đó gửi GameState cho Bot B.

Xử lý Timeout: Nếu quá 3 giây (đếm từ lúc Engine phát tin) mà Bot không trả kết quả hoặc trả về kết quả lỗi (Crash/Exception), Engine tự động ghi nhận mất lượt (Skip Turn) và chuyển quyền điều khiển sang Bot đối phương.

2. API Backend Giao tiếp:

Thay vì dùng WebSocket mở ra mạng ngoài, Game Engine và các bot sẽ giao tiếp thông qua Local WebSocket hoặc Standard Input/Output (STDIO) bên trong cụm Server của Ban tổ chức (BTC).

Gói tin giao tiếp chuẩn (JSON):

INIT: Gửi cấu hình Map (kích thước, vị trí chướng ngại vật) ở lượt đầu.

STATE_UPDATE: Vị trí các quân cờ hiện tại.

ACTION: Cú pháp bot gửi lại (VD: Di chuyển quân ở [1,2] sang [1,3]).

## Phase 2: Cơ chế đấu giải, Matchmaking và Sandbox (Vận hành hàng tuần)
Mục tiêu: Tự động hóa việc thi đấu, tính điểm Elo và đảm bảo bảo mật mã nguồn thông qua Sandbox.

1. Hệ thống Nộp Code & Môi trường Sandbox:

Người chơi gửi file bot.py (hoặc file nén) lên cổng API của BTC.

Khi có lệnh chạy trận đấu, hệ thống sinh ra 2 Docker Container (một cho Đội A, một cho Đội B) sử dụng image Python thuần.

Cách ly mạng (Network Isolation): Các container này bị ngắt hoàn toàn kết nối Internet ngoại bộ (--network none hoặc chỉ cho phép mạng internal kết nối đến Game Engine nội bộ). Điều này đảm bảo bot không thể gọi API LLM trực tiếp (nếu dùng AI, phải dùng các thuật toán học máy hoặc pre-trained model nhẹ nhúng thẳng vào code).

Giới hạn tài nguyên (CPU/RAM) cho mỗi container để tránh việc code treo làm đứng server.

2. Hàng đợi Xử lý Trận đấu (Matchmaking Queue):

Hệ thống lấy danh sách bot, nhóm vào các Bracket (0-1000, 1000-2000, v.v.).

Tự động bắt cặp ngẫu nhiên các bot trong cùng Bracket và đẩy Job vào Message Queue (ví dụ Redis Queue).

Cụm Sandbox Worker sẽ kéo từng Job ra chạy tuần tự. Máy chủ có thể chạy 5-10 trận cùng lúc tùy cấu hình, không chạy dồn dập hàng trăm trận để tránh giật lag hay sai lệch timing.

Tính điểm Elo: Điểm Elo được tính và cập nhật ngay vào Database ngay sau khi trận đấu trong Sandbox kết thúc. Bảng xếp hạng frontend sẽ được update tự động.

3. Bản đồ Động (Dynamic Maps) & Tách biệt Logic:

Đầu tuần, BTC cung cấp file map_config.json (chứa vị trí tường, ô bonus). Các đội tải về để huấn luyện bot.

Logic của Game Engine được viết sao cho Map chỉ là một file input đầu vào. Xếp hạng và Tournament là một module riêng lẻ chỉ ghi nhận kết quả cuối cùng (Thắng/Thua) trả về từ Game Engine, giúp hệ thống dễ dàng gắn các trò chơi khác vào sau này.

## Phase 3: Tuần Chung kết & Hệ thống Replay (Live Event)
Mục tiêu: Chọn lọc hạt giống xuất sắc, thi đấu loại trực tiếp BO3 với map ẩn, phục vụ nhu cầu trình diễn (Spectating).

1. Thể thức Top 8/16 & BO3:

Chốt sổ Leaderboard, chọn ra 8 hoặc 16 bot có Elo cao nhất xếp vào nhánh đấu loại trực tiếp (Single/Double Elimination Bracket).

Map Pool: BTC công bố danh sách 5 hoặc 7 Maps có thể xuất hiện, nhưng không cho biết thứ tự.

Khi trận đấu diễn ra, Game Engine sẽ chọn ngẫu nhiên một map trong Pool. Bot của người chơi chỉ biết map thực tế đang đánh khi nhận được gói tin INIT đầu tiên trong trận.

2. Giải pháp Spectator (Phát lại trận đấu):

Vấn đề: Máy chủ tính toán cực nhanh, trận đấu 200 turns có thể kết thúc trong 1-2 giây. Không thể chiếu Live Realtime.

Giải pháp (Replay Architecture):

Game Engine không stream diễn biến ra ngoài. Thay vào đó, sau khi container chạy xong toàn bộ trận đấu, Engine xuất ra một file match_log.json. File này chứa một mảng tuần tự toàn bộ các sự kiện từ turn 1 đến turn N (nước đi, máu bị trừ, ai thắng).

Giao diện Khán giả (Spectator UI - xây dựng bằng React/Vite từ repo) sẽ load file match_log.json này.

Frontend cài đặt một bộ đếm setInterval (1 giây hoặc 0.5 giây/lần) để duyệt qua từng phần tử trong JSON và render hiệu ứng đồ họa di chuyển trên lưới. Khán giả và Caster (Bình luận viên) sẽ xem trận đấu thông qua UI này như đang xem một trận đấu cờ trực tiếp.