# Sổ tay Vận hành & Ứng phó Sự cố (Production Operations Runbook)

Tài liệu quy định chi tiết quy trình giám sát, xử lý cảnh báo, sao lưu phục hồi, và các kịch bản ứng phó sự cố khẩn cấp cho hạ tầng giải đấu OTT (Phase 3 — Wave 6: Operations Readiness, `P3-N05`).

---

## 1. Phân công Trách nhiệm Vận hành (Operational RACI)

| Vai trò | Nhân sự phụ trách | Trách nhiệm chính |
| :--- | :--- | :--- |
| **Trưởng Ban Tổ Chức (BTC)** | **Đinh Đức Thuận** (`thuandd`) | Quyết định tối cao về dừng/hoãn vòng đấu, ban bố sự cố công khai, phê duyệt đền bù thời gian nộp bài, ký biên bản diễn tập. |
| **Security & Compliance Lead** | **Phạm Tất Đạt** (`datpt`) | Quyết định xoay secret khẩn cấp, điều tra gian lận bot / cờ duplicate (AC-22), quản lý RBAC/TOTP và audit logs. |
| **Operations & Infrastructure Lead** | **Đỗ Khôi Nguyên** (`nguyendk`) | Trực dashboard/alerts, giám sát worker pool, thực hiện sao lưu/phục hồi off-host, kích hoạt Read-Only Mode khi có sự cố. |
| **Protocol & Engine Lead** | **Long Trần** (`longt`) | Triage lỗi runtime của MatchRunner, Bot Protocol v1/v2, game engine faults và dead-letter queue. |

---

## 2. Danh mục Cảnh báo Prometheus & Hướng dẫn Xử lý (Alert Catalog)

Tất cả alert rules được định nghĩa tại [`ops/prometheus/rules.yml`](file:///d:/5th%20semester/network_programming/dau-giai-ott/ops/prometheus/rules.yml).

### 2.1 `QueueAgeHigh` (Warning)
- **Điều kiện**: `ott_queue_oldest_job_age_seconds > 60s` duy trì trong 1 phút.
- **Hiện tượng**: Job thi đấu bị ứ đọng trong hàng đợi BullMQ, trận đấu không được gán cho worker kịp thời.
- **Tác động**: Vòng đấu bị kéo dài thời gian thi đấu, kết quả cập nhật chậm.
- **Hành động ngay**:
  1. Kiểm tra số lượng worker đang hoạt động trên Grafana panel *Active Worker Pool*.
  2. Kiểm tra log worker: `journalctl -u ott-worker -f` hoặc docker log worker container.
  3. Nếu worker đang bị quá tải CPU/RAM, kiểm tra panel *Adaptive Capacity* xem có bị tụt xuống 1 không.
  4. Cân nhắc bổ sung thêm worker node dự phòng hoặc tăng `maxConcurrency` nếu tài nguyên phần cứng cho phép.

### 2.2 `WorkerHeartbeatMissing` (Critical)
- **Điều kiện**: `(time() - ott_worker_last_heartbeat_timestamp_seconds) > 30s`.
- **Hiện tượng**: Worker node không gửi tín hiệu nhịp tim định kỳ về Redis.
- **Tác động**: Các trận đấu được lease bởi worker này có thể bị kẹt hoặc dở dang.
- **Hành động ngay**:
  1. Xác định worker ID từ nhãn alert `worker_id`.
  2. Kiểm tra tiến trình worker xem có bị OOM killer (cgroup v2), crash, hay treo I/O không.
  3. Khởi động lại service worker: `systemctl restart ott-worker`.
  4. Hệ thống worker pool sẽ tự động giải phóng lease và đưa trận đấu chưa hoàn tất vào cơ chế retry an toàn.

### 2.3 `InfraFailureSpike` (Critical)
- **Điều kiện**: Tỷ lệ match attempt thất bại do hạ tầng (`status="failed"`) vượt quá 5% trong 5 phút.
- **Hiện tượng**: Lỗi kết nối PostgreSQL, gián đoạn MinIO/SeaweedFS storage, hoặc lỗi docker runtime daemon.
- **Tác động**: Trận đấu bị hủy bất thường mà không phải do lỗi của bot.
- **Hành động ngay**:
  1. Kiểm tra ngay sức khỏe của PostgreSQL: `pg_isready -h localhost -p 5432`.
  2. Kiểm tra MinIO S3 endpoint: `curl -I http://localhost:9000/minio/health/live`.
  3. Kích hoạt **Playbook 1 (Pause Upload / Freeze)** nếu phát hiện storage đầy hoặc DB mất kết nối để tránh mất mát dữ liệu.

### 2.4 `FinalizeStuck` (Critical)
- **Điều kiện**: `ott_matches_pending_finalization_seconds > 120s`.
- **Hiện tượng**: Trận đấu đã hoàn tất lượt chạy trong sandbox nhưng giao dịch ghi kết quả và cập nhật rating Elo không thể commit.
- **Tác động**: Bảng xếp hạng bị đóng băng, series không thể chuyển sang trạng thái kết thúc (`SETTLING`).
- **Hành động ngay**:
  1. Kiểm tra lock table trên PostgreSQL: `SELECT pid, query, state FROM pg_stat_activity WHERE wait_event_type = 'Lock';`.
  2. Kill các transaction treo nếu có.
  3. Rà soát transaction rating update trong `platform-api`.

### 2.5 `SandboxResourcePressure` (Warning)
- **Điều kiện**: `ott_bot_memory_peak_bytes > 460 MiB` (> 90% giới hạn 512 MiB).
- **Hiện tượng**: Bot của thí sinh tiêu thụ bộ nhớ gần chạm trần quota cgroup v2.
- **Tác động**: Nguy cơ cao bot bị kernel cgroup OOM kill và xử thua lỗi `RESOURCE_LIMIT_EXCEEDED`.
- **Hành động ngay**: Ghi nhận mã submission và team ID để sẵn sàng cung cấp log / thông tin hỗ trợ khi đội tuyển có khiếu nại.

### 2.6 `DeadLetterQueueNotEmpty` (Critical)
- **Điều kiện**: `ott_dead_letter_queue_size > 0`.
- **Hiện tượng**: Trận đấu gặp lỗi nghiêm trọng vượt quá số lần retry và bị đẩy vào `match_execution_dead_letter`.
- **Hành động ngay**:
  1. Sử dụng script kiểm tra payload dead letter: `scripts/inspect-dlq.sh` hoặc truy vấn Redis stream dead-letter.
  2. Thu thập error code và context trận đấu, bàn giao cho Long Trần (`longt`) kiểm tra payload bot contract.

---

## 3. Các Kịch bản Ứng phó Khẩn cấp (Emergency Incident Playbooks)

### Kịch bản 1: Tạm dừng nộp bài khẩn cấp (Pause Upload / Freeze Submissions)
- **Trường hợp áp dụng**: Phát hiện lỗ hổng zero-day trong sandbox, phát hiện hành vi tấn công từ chối dịch vụ (DDoS) vào API nộp bài, hoặc có tranh chấp bản quyền bot nghiêm trọng.
- **Owner**: **Phạm Tất Đạt** (phát hiện/đề xuất) & **Đinh Đức Thuận** (phê duyệt).
- **Quy trình hành động**:
  1. Gọi API chuyển trạng thái vòng đấu hoặc dùng cờ freeze:
     ```bash
     curl -X POST "http://localhost:3000/api/v1/admin/rounds/${ROUND_ID}/pause" \
       -H "Authorization: Bearer ${BTC_ADMIN_TOKEN}" \
       -H "Content-Type: application/json" \
       -d '{"reason": "Tam dung khan cap do su co ha tang", "correlationId": "'$(uuidgen)'"}'
     ```
  2. Khóa cổng upload trên reverse proxy (Nginx/Traefik) nếu cần can thiệp tầng mạng:
     ```bash
     # Redirect /api/v1/submissions to 503 Maintenance
     sed -i 's/return 200/return 503/g' /etc/nginx/conf.d/submissions.conf
     systemctl reload nginx
     ```
  3. Ghi nhận `audit_event` với action `ROUND_SUBMISSION_PAUSED`.
  4. Thông báo cho các đội qua kênh Discord/Telegram chính thức: "Hệ thống tạm dừng tiếp nhận bài nộp trong 30 phút để xử lý kỹ thuật".

---

### Kịch bản 2: Chuyển sang Chế độ Chỉ đọc Công khai (Read-Only Public Mode)
- **Trường hợp áp dụng**: Control Plane API hoặc PostgreSQL gặp sự cố trong khi giải đấu đang diễn ra, cần đảm bảo khán giả và thí sinh vẫn xem được bảng xếp hạng và các trận đấu đã hoàn thành mà không làm sập server.
- **Owner**: **Đỗ Khôi Nguyên** (`nguyendk`).
- **Quy trình hành động**:
  1. Kích hoạt CDN / Web fallback trỏ trực tiếp vào snapshot tĩnh cuối cùng:
     - Public static snapshot lưu tại: `/data/storage/snapshots/standings-latest.json` và `matches-latest.json`.
     - File snapshot đã có sha256 checksum và hoàn toàn độc lập với API/DB.
  2. Bật cờ `VITE_PUBLIC_READ_ONLY=true` trên frontend portal:
     - Ẩn toàn bộ form nộp bài, form đăng nhập đội thi.
     - Giữ nguyên hiển thị bảng xếp hạng, bracket và replay viewer cho các trận đã publish.
  3. Khi control plane phục hồi, kiểm tra tính toàn vẹn dữ liệu trước khi tắt Read-Only mode.

---

### Kịch bản 3: Xoay Secret & Thông tin Xác thực Khẩn cấp (Emergency Secret Rotation)
- **Trường hợp áp dụng**: Rò rỉ credential quản trị BTC, lộ JWT session secret, rò rỉ S3 access keys hoặc phát hiện truy cập trái phép.
- **Owner**: **Phạm Tất Đạt** (`datpt`).
- **Quy trình 4 bước**:
  1. **Tạo secret mới**:
     ```bash
     NEW_SESSION_SECRET=$(openssl rand -hex 32)
     NEW_S3_SECRET=$(openssl rand -hex 32)
     ```
  2. **Cập nhật cấu hình dịch vụ**:
     - Cập nhật `.env` của `platform-api` và `platform-worker`.
     - Khởi động lại `platform-api` với secret mới.
  3. **Hủy toàn bộ phiên làm việc cũ (Session Invalidation)**:
     - Xóa toàn bộ active sessions trong Redis:
       ```bash
       redis-cli -u "${REDIS_URL}" --eval "return redis.call('del', unpack(redis.call('keys', 'sess:*')))"
       ```
     - Thu hồi toàn bộ session tokens trong PostgreSQL:
       ```sql
       UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
       ```
  4. **Yêu cầu đăng nhập lại**:
     - Tất cả tài khoản BTC_ADMIN bắt buộc nhập lại TOTP MFA.
     - Đội thi thực hiện đăng nhập lại tài khoản `TEAM_ACCOUNT`.

---

### Kịch bản 4: Thông báo Sự cố & Đền bù Thời gian (Incident Communication & Grace Window Compensation)
- **Trường hợp áp dụng**: Bất kỳ sự cố hạ tầng nào khiến hệ thống ngừng tiếp nhận bài nộp > 5 phút trong thời gian nộp bài chính thức.
- **Owner**: **Đinh Đức Thuận** (`thuandd`).
- **Quy tắc đền bù (D-18 / RuleSet Policy)**:
  - Thời gian gia hạn bù: $T_{\text{bù}} = T_{\text{downtime}} + 15 \text{ phút (buffer)}$.
  - Cập nhật `grace_ends_at` và `submission_deadline_at` trong `qualification_rounds` và publish phiên bản mới của RuleSet.
- **Mẫu thông báo chính thức**:
  > [!IMPORTANT]
  > **THÔNG BÁO TỪ BAN TỔ CHỨC GIẢI ĐẤU OTT**  
  > *Thời gian*: [HH:MM DD/MM/2026]  
  > *Nội dung*: Hệ thống nộp bài gặp gián đoạn kỹ thuật từ [HH:MM] đến [HH:MM] (khoảng [X] phút).  
  > *Khắc phục*: Sự cố đã được đội ngũ kỹ thuật xử lý hoàn tất, toàn bộ bài nộp trước đó được bảo toàn nguyên vẹn.  
  > *Đền bù*: BTC quyết định gia hạn thời hạn nộp bài thêm **[X + 15] phút**, hạn nộp bài mới là **[HH:MM DD/MM/2026]**.  
  > Trân trọng cảm ơn các đội thi!

---

## 4. Quy trình Sao lưu & Phục hồi Thảm họa (Backup & Disaster Recovery)

### 4.1 Chỉ số Mục tiêu
- **RPO (Recovery Point Objective)**: = 0 (Không làm mất bất kỳ trận đấu chính thức nào đã commit).
- **RTO (Recovery Time Objective)**: < 15 phút (Khôi phục toàn bộ hệ thống sang laptop dự phòng sẵn sàng hoạt động).

### 4.2 Thực hiện Sao lưu Định kỳ (`scripts/backup-local.sh`)
- Chạy trước mỗi mốc quan trọng (trước giờ mở nộp bài, trước khi bắt đầu vòng đấu, sau khi kết thúc lượt thi đấu):
  ```bash
  ./scripts/backup-local.sh /path/to/usb-drive/ott_backup_$(date +%Y%m%d_%H%M%S)
  ```
- Kết quả tạo ra thư mục chứa:
  - `data/database.sql`: Toàn bộ database schema và data.
  - `data/storage.tar.gz`: Toàn bộ file bot OCI layer, match replays.
  - `checksums.sha256`: Mã băm SHA-256 xác thực.
  - `manifest.json`: Siêu dữ liệu số lượng bản ghi audit, submission, match.

### 4.3 Khôi phục sang Máy Dự phòng (`scripts/restore-local.sh`)
- Trong trường hợp laptop/server chính gặp sự cố phần cứng không thể tiếp tục vận hành:
  1. Cắm USB backup vào máy dự phòng (đã cài đặt sẵn Docker, Node.js 22, PostgreSQL, Redis).
  2. Thực hiện lệnh khôi phục:
     ```bash
     ./scripts/restore-local.sh /path/to/usb-drive/ott_backup_YYYYMMDD_HHMMSS
     ```
  3. Script tự động:
     - Kiểm tra toàn vẹn SHA-256 (fail-fast nếu có file bị hỏng).
     - Khôi phục PostgreSQL database và storage artifacts.
     - So khớp số lượng `audit_events`, `submissions`, `matches` khớp chính xác với `manifest.json`.

---

## 5. Bảng Tự Đánh giá An toàn OWASP Top 10 (OWASP Self-Assessment)

| Hạng mục OWASP | Rủi ro tiềm ẩn trong OTT | Biện pháp Phòng vệ Đã triển khai | Trạng thái |
| :--- | :--- | :--- | :---: |
| **A01: Broken Access Control** | Đội này tải về code bot hoặc replay của đội khác trong vòng loại | Enforce RBAC tại service layer; chỉ trả replay riêng tư cho 2 đội trong trận; trigger SQL chặn publish replay non-FINALS | ✅ **ĐẠT** |
| **A02: Cryptographic Failures** | Lộ seed ngẫu nhiên, lộ credentials lưu trữ S3 | Hash mật khẩu Argon2id; botSeed phân tách per-bot HMAC qua SHA-256; không ghi credentials vào logs/metrics | ✅ **ĐẠT** |
| **A03: Injection** | SQL Injection qua input trận đấu hoặc bot name | 100% truy vấn dùng Parameterized Queries (`$1, $2`); kiểm tra regex nghiêm ngặt định dạng UUID và SHA-256 | ✅ **ĐẠT** |
| **A04: Insecure Design** | Bot thực hiện fork bomb, chiếm dụng RAM làm sập host | Sandbox cgroup v2 giới hạn 512MB RAM, pids=64, cpu quota; memory.peak được ghi nhận liên tục | ✅ **ĐẠT** |
| **A05: Security Misconfiguration** | Bật debug mode hoặc lộ stacktrace nhạy cảm trên production | Middleware bắt lỗi tập trung; sanitization lọc bỏ credential, stderr và mã nguồn bot khỏi Prometheus metrics | ✅ **ĐẠT** |
| **A06: Vulnerable Components** | Lỗ hổng trong npm dependencies hoặc Python starter kits | Chạy `npm audit` định kỳ; khóa chặt version lockfile; quét dependency định kỳ | ✅ **ĐẠT** |
| **A07: Identification & Auth** | Brute force mật khẩu BTC Admin hoặc chiếm đoạt session | Rate limiting trên IP và username; TOTP MFA bắt buộc cho admin; session token lưu Redis với TTL | ✅ **ĐẠT** |
| **A08: Software & Data Integrity** | Thí sinh nộp bot giả mạo digest hoặc sửa đổi image sau khi nộp | OCI Image Layout bất biến; trigger PostgreSQL `submissions_identity_immutable` ngăn sửa digest | ✅ **ĐẠT** |
| **A09: Security Logging & Monitoring** | Không phát hiện được tấn công hoặc gian lận | Toàn bộ thao tác nhạy cảm ghi vào bảng `audit_events` bất biến; cảnh báo Prometheus tự động báo sự cố | ✅ **ĐẠT** |
| **A10: SSRF** | Bot gọi network ra ngoài để lấy trộm dữ liệu hoặc nhận lệnh điều khiển | Sandbox cấu hình `--network none` (hoàn toàn ngắt egress internet/LAN); chỉ giao tiếp qua stdout NDJSON | ✅ **ĐẠT** |

---

## 6. Biên bản Diễn tập Vận hành (Tabletop Incident Drill Sign-off)

- **Ngày diễn tập**: 18/10/2026
- **Địa điểm / Môi trường**: Local lab server & cold standby laptop
- **Kịch bản đã diễn tập**:
  1. [x] Giả lập mất kết nối worker node (`kill -9 ott-worker`) → Alert `WorkerHeartbeatMissing` kích hoạt sau 30s → Worker tự động tái kết nối và phục hồi job.
  2. [x] Giả lập 100 bài nộp đồng thời → Queue age tăng → Alert `QueueAgeHigh` hiển thị trên Grafana → Hệ thống điều tiết hàng đợi và áp dụng adaptive capacity thành công.
  3. [x] Chạy `backup-local.sh` xuất dữ liệu ra USB và `restore-local.sh` sang laptop thứ hai → Xác thực SHA-256 100% khớp, số dòng `audit_events` và `matches` nguyên vẹn.
  4. [x] Giả lập tình huống phát hiện duplicate submission → Cờ `duplicate_review_flag` bật đúng theo AC-22, audit log ghi nhận, trận đấu tiếp tục bình thường không bị dừng đột ngột.

**Chữ ký xác nhận:**

| Người lập biên bản (Ops Lead) | Người kiểm tra (Security Lead) | Người duyệt (Trưởng Ban Kỹ Thuật) |
| :---: | :---: | :---: |
| *(Đã ký điện tử)* | *(Đã ký điện tử)* | *(Đã ký điện tử)* |
| **Đỗ Khôi Nguyên** | **Phạm Tất Đạt** | **Đinh Đức Thuận** |

