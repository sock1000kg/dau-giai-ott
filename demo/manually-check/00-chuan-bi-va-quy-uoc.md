# Chuẩn bị và quy ước chạy test

## 1. Thông tin phải ghi trước khi chạy

Ghi vào biên bản:

- Commit SHA và branch đang kiểm thử.
- Host OS, Docker/Compose version, thời gian bắt đầu và timezone.
- URL local/LAN; không ghi cookie hoặc secret.
- Browser desktop và thiết bị/browser mobile.
- Người giữ vai `BTC Admin`, `team01`, `team02` và spectator.
- Loại lượt chạy: local qualification hay hosted/finals.

Không dùng một cửa sổ browser cho nhiều role. Dùng tối thiểu ba profile/context độc lập: BTC, Team 01 và
Team 02; spectator dùng cửa sổ private/incognito không có cookie.

## 2. Chuẩn bị local qualification

Yêu cầu: Docker 24+, Docker Compose v2, Python 3, khoảng 4 GiB RAM trống và một port gateway trống.

```bash
git rev-parse --short HEAD
docker version
docker compose version
npm --workspace @ott/sandbox-corpus run build:corpus
./scripts/demo.sh up
./scripts/demo.sh status
./scripts/demo.sh accounts
```

`status` phải cho thấy stack healthy/ready và file tài khoản tồn tại. Khi cần lấy credential, người vận hành
chạy `./scripts/demo.sh accounts --reveal` trực tiếp rồi chuyển qua kênh riêng; không chụp màn hình hoặc dán
credential vào biên bản. Local demo mặc định có `btc`, `team01`, `team02`; mật khẩu mặc định chỉ được dùng
trong môi trường local throw-away.

Hai OCI archive phải khác nhau để tránh làm nhiễu case duplicate review. Dùng artifact do sandbox corpus tạo,
ví dụ fixture first-legal và một fixture action khác dưới
`src/bots/sandbox-corpus/artifacts/oci-fixtures/`. Ghi tên file và SHA-256, không chỉnh archive giữa lúc test.

## 3. Trạng thái đầu vào

Lượt full E2E cần database sạch: chưa có qualification round đang mở/chạy và chưa có submission cũ. Nếu
stack đã có dữ liệu, dừng và chọn một trong hai cách:

1. Dùng môi trường throw-away khác; hoặc
2. Sau khi được owner xác nhận đúng target, thu thập evidence rồi chạy `./scripts/demo.sh reset --yes` và
   `./scripts/demo.sh up`.

Không reset một môi trường dùng chung hoặc hosted/LAN bằng quy trình local này.

## 4. Evidence tối thiểu

Mỗi case lưu:

- Một ảnh tại trạng thái kết quả cuối hoặc video ngắn nếu kiểm tra chuyển động/restart.
- Timestamp có timezone.
- ID liên quan: round ID, submission ID, series ID hoặc match ID nếu có; ID không phải secret.
- Với lỗi: log đúng service trong khoảng thời gian lỗi, ví dụ `./scripts/demo.sh logs api` hoặc
  `./scripts/demo.sh logs worker`; che dữ liệu nhạy cảm.

Case kiểm tra restart phải ghi số lượng match/result trước và sau. Case replay phải ghi match ID và loại route
(private/public), nhưng không lưu raw session cookie.

## 5. Điều kiện dừng sớm

Dừng track phụ thuộc và đánh dấu Blocked nếu:

- readiness không đạt;
- không đăng nhập được cả BTC và hai đội;
- một trong hai submission không lên `ACTIVE` trong thời gian quy định của runbook;
- round không tạo được series/match;
- tester phát hiện đang thao tác nhầm môi trường hoặc có dữ liệu thật không được phép thay đổi.

Thu thập log trước khi stop/reset. Không tiếp tục bằng cách sửa trực tiếp database hoặc gọi API ngoài UI để
biến case thành Pass, trừ khi chính case yêu cầu kiểm tra công cụ vận hành.
