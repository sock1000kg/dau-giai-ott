# Bot Starter Kits & OCI Image Packaging Guide

Tài liệu hướng dẫn xây dựng và đóng gói bot thi đấu cho giải đấu OTT dưới dạng OCI Image Layout archive chuẩn (`.tar`), tối ưu hoá layer deduplication và tuân thủ các quy định về retention và duplicate review.

---

## 1. Official Base Images (Hình ảnh nền chính thức)

Ban Tổ Chức (BTC) cung cấp và duy trì 3 base images chính thức cho 3 ngôn ngữ lập trình phổ biến. Khi đội thi sử dụng đúng các base image này, các layer nền sẽ được hệ thống tự động nhận diện và tái sử dụng (deduplication) trên S3/MinIO, giúp giảm thời gian upload và tiết kiệm dung lượng lưu trữ:

| Ngôn ngữ | Base Image Tag | Manifest Digest | Số Layers nền |
| :--- | :--- | :--- | :--- |
| **Python** | `python:3.12-slim` | `sha256:d17ec283626e959ecbf8e1b6f0e9b9cf98544d642da652a9709f18b3cb3efd4c` | 4 |
| **Node.js** | `node:22-bookworm-slim` | `sha256:6909477e3c1532f6b864d293f0b2f654b9d07f311333e21074e2d3dcf3a89073` | 3 |
| **Go** | `golang:1.22-alpine` | `sha256:1a84b3967468fb7920ab7cbdd129ba0e30095908ef136fbccb780ea3b53f31cf` | 3 |

> [!NOTE]
> Tất cả các image phải được build cho target platform duy nhất: `linux/amd64`.

---

## 2. Hướng dẫn đóng gói OCI Image Layout Archive

Hệ thống nộp bài OTT chấp nhận bot đóng gói theo định dạng OCI Image Layout V1 (uncompressed tar).

### 2.1 Cấu trúc Dockerfile mẫu

#### Python Bot (`Dockerfile`):
```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY bot.py /app/bot.py
COPY sdk.py /app/sdk.py

ENTRYPOINT ["python3", "/app/bot.py"]
```

#### Node.js Bot (`Dockerfile`):
```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY bot.mjs ./

ENTRYPOINT ["node", "/app/bot.mjs"]
```

#### Go Bot (Multi-stage build cho binary nhỏ gọn):
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /bot main.go

FROM alpine:3.20
COPY --from=builder /bot /bot
ENTRYPOINT ["/bot"]
```

### 2.2 Quy trình Build Reproducible và Xuất Archive

Để đảm bảo tính tái lập (reproducible build) và digest ổn định:

1. **Build image cục bộ**:
   ```bash
   docker build --platform linux/amd64 -t my-bot:v1 .
   ```

2. **Chuyển đổi sang OCI Image Layout bằng `skopeo`** (khuyến nghị):
   ```bash
   mkdir -p ./oci-layout
   skopeo copy docker-daemon:my-bot:v1 oci:./oci-layout:latest
   tar -cf submission.tar -C ./oci-layout .
   ```

3. **Hoặc sử dụng `crane`**:
   ```bash
   crane export my-bot:v1 submission.tar
   ```

4. **Kiểm tra cấu trúc OCI Image Layout**:
   File `submission.tar` hợp lệ khi mở ra chứa:
   - `oci-layout` (`{"imageLayoutVersion":"1.0.0"}`)
   - `index.json`
   - Thư mục `blobs/sha256/<hash>`

---

## 3. Chính sách Duplicate Submission Flagging (AC-22)

Hệ thống tự động phân tích mỗi submission mới khi nộp bài:
- **So khớp manifest digest**: So sánh digest của manifest với các submission của các đội khác hoặc sample bot.
- **So khớp custom non-base layers**: Tự động bóc tách các layer nền (base layers) và so sánh các layer logic/custom với submission của các đội khác.

### Xử lý khi phát hiện trùng lặp:
- Submission được gắn cờ `duplicate_review_flag = true` cùng `duplicate_of_submission_id` và lý do so khớp.
- Ghi nhận `audit_event` với action `DUPLICATE_SUBMISSION_FLAGGED` gửi đến BTC.
- **Quan trọng**: Hệ thống **KHÔNG** tự động disqualify hay huỷ submission của đội. Cờ này phục vụ mục đích để BTC review thủ công trước vòng đấu nhằm đảm bảo tính công bằng và giải quyết tranh chấp (nếu có).

---

## 4. Chính sách OCI Retention & Layer Storage (D-18)

Nhằm tối ưu hóa dung lượng lưu trữ trên MinIO/S3 mà vẫn đảm bảo tính toàn vẹn kết quả giải đấu:

### 4.1 Quy tắc bảo toàn (Invariants)
1. **ACTIVE submissions**: Bản nộp đang ở trạng thái `ACTIVE` của mỗi đội **không bao giờ bị xóa**.
2. **Match submissions**: Bất kỳ bản nộp nào đã từng thi đấu trong các trận đấu chính thức (`matches.x_submission_id` hoặc `matches.o_submission_id`) **không bao giờ bị xóa**.
3. **Top 3 gần nhất**: Tối đa 3 bản nộp mới nhất của mỗi đội luôn được lưu trữ đầy đủ.

### 4.2 Garbage Collection & Pruning
- Các bản nộp cũ hơn (vượt quá 3 bản gần nhất, không active, không thi đấu) sẽ được đưa vào diện thu hồi (prune).
- Khi bản nộp bị xóa, các layer OCI thuộc về bản nộp đó sẽ được giảm reference count.
- Chỉ những layer **không còn được reference bởi bất kỳ submission nào** mới bị dọn dẹp khỏi storage.
- Hệ thống hỗ trợ chế độ **Dry-run report** cho phép BTC xem trước chính xác dung lượng và danh sách layer sẽ được giải phóng trước khi thực hiện dọn dẹp thật.

---

## 5. FAQ (Câu hỏi thường gặp)

**Q: Bot của tôi có thể dùng thư viện ngoài (pip, npm) không?**  
A: Có. Bạn có thể cài đặt thư viện vào image khi build Dockerfile. Tuy nhiên, hãy giữ kích thước archive dưới hạn mức (256MB) và uncompressed size dưới 512MB.

**Q: Tại sao manifest digest của tôi bị trùng với đội khác dù tôi tự code?**  
A: Nếu hai đội sử dụng cùng một starter kit mẫu và không có thay đổi nào trong code, các custom layer sẽ hoàn toàn trùng khớp. Để tránh bị cờ review, hãy tùy biến chiến thuật và logic bot của đội bạn.

**Q: Khi nào bot bị loại (disqualify) do duplicate?**  
A: Cờ `duplicate_review_flag` chỉ là cảnh báo kỹ thuật cho BTC. BTC sẽ đối chiếu thời gian nộp, cam kết bản quyền và phỏng vấn kỹ thuật nếu cần trước khi đưa ra bất kỳ quyết định kỷ luật nào.

