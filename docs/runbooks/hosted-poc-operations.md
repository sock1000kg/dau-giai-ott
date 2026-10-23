# Sổ tay Vận hành Hosted PoC & Server Lab (P3-N06)

**Chủ sở hữu tài liệu:** Đỗ Khôi Nguyên (Owner lane `P3-N*` — Sandbox / Worker / Operations Readiness)  
**Đối tượng áp dụng:** Ban tổ chức (BTC), Kỹ thuật viên vận hành server thi đấu vòng loại.  
**Mục tiêu:** Quy định chuẩn mực quy trình thiết lập, kiểm tra, điều phối vòng loại pilot và xử lý sự cố trên server lab hosted PoC.

---

## 1. Yêu cầu Tiền khởi động (Pre-flight Setup & Startup Checklist)

Trước khi mở hệ thống tiếp nhận bài nộp hoặc bắt đầu thi đấu:

1. **Kiểm tra Môi trường & Phiên bản:**
   ```bash
   node -v          # Bắt buộc Node.js v22.12.0 trở lên
   docker version   # Bắt buộc Docker Engine 27.x và Docker Compose v2
   ```
2. **Cấu hình Biến môi trường & Security Startup Guards (AC-23):**
   - Đảm bảo thiết lập `OTT_DEPLOYMENT_MODE=hosted_poc`.
   - Cấu hình bắt buộc khóa mã hóa MFA: `OTT_BOOTSTRAP_BTC_TOTP_SECRET`.
   - Cấu hình dải mạng quản trị an toàn: `OTT_ADMIN_NETWORK_ALLOWLIST` (chỉ cho phép IP máy BTC).
   - Thiết lập `OTT_TRUSTED_PROXIES` phù hợp (tránh proxy spoofing).
3. **Di chuyển CSDL & Toàn vẹn Dữ liệu:**
   ```bash
   npm run db:migrate --workspace @ott/platform-api
   npm test --workspace @ott/platform-api -- migrations-registry
   ```
   Đối chiếu registry hiện tại trong `src/platform/api/src/db/schema.ts`; migration `0020_test_run_frontend_contract` bổ sung catalog bot tham chiếu và transactional outbox cho test-run.

---

## 2. Quy trình Vận hành Vòng loại Pilot (Pilot Qualification Run)

### Bước 1: Mở cổng nhận bài nộp (Submission Window Opening)
- Kích hoạt cổng nộp bài thông qua API vòng đấu hoặc giao diện BTC Admin.
- Giám sát thông số concurrency qua Prometheus / Grafana:
  - `upload_active_leases` không vượt quá 8 (global limit).
  - Các request vượt ngưỡng phải nhận được HTTP 429 kèm header `Retry-After >= 1`.
  - Kiểm tra thứ tự hàng đợi `preflightPosition` trong giao diện đội thi.

### Bước 2: Kiểm định bài nộp sơ loại (Preflight Execution)
- Worker tự động nhận job preflight (`priority = 2`).
- Kiểm tra tính hợp lệ của entrypoint và digest OCI layer (`AC-22`).
- Khi phát hiện mã layer trùng khớp với đội khác, hệ thống tự động gắn cờ `DUPLICATE_SUBMISSION_FLAGGED` mà không hủy bài của thí sinh.

### Bước 3: Đóng cổng và Khóa danh sách (Cutoff & Lock)
- Hết thời gian nộp bài + grace period (cửa sổ ân hạn cho các hash đã đặt chỗ trước deadline).
- Chuyển trạng thái vòng đấu sang `IN_PROGRESS`.
- Kích hoạt chốt danh sách bài thi `ACTIVE` của từng đội.

### Bước 4: Điều phối Thi đấu Vòng loại (Match Dispatching)
- Worker pool tự động xử lý các trận đấu chính thức (`priority = 1`).
- Duy trì tối đa 4 trận chạy song song trên server lab để tránh quá tải CPU/RAM.
- **Giám sát Test Runs:** Trong lúc vòng thi đấu chính thức đang chạy, các yêu cầu test run của các đội tự động xếp hàng chờ (`QUEUED`) ở mức ưu tiên thấp (`priority = 3`), không làm gián đoạn các trận chính thức.

### Bước 5: Xuất Bảng xếp hạng & Replay Snapshots (Snapshot Publishing)
- Sau khi vòng đấu kết thúc, hệ thống kích hoạt tính toán điểm số Elo theo cơ chế `CURRENT_RATING_POLICY` (`elo-adaptive-k-v1`).
- Xuất bản bản chụp tĩnh `public-snapshot-v1.json` lên thư mục công cộng.
- Khán giả và thí sinh chỉ đọc bản snapshot tĩnh, không gửi request trực tiếp đến CSDL thi đấu.

---

## 3. Quy trình Xử lý Sự cố Vận hành (Incident Response Playbooks)

### Sự cố 1: Worker Process Crash hoặc Mất Heartbeat (AC-3 / AC-19)
- **Hiện tượng:** Match job ở trạng thái `RUNNING` quá lâu, worker không cập nhật heartbeat (`> 10s`).
- **Cơ chế tự động:** Hệ thống phát hiện timeout, thu hồi match lease và tự động tăng `generation` trong outbox để hủy bỏ các lượt ghi muộn từ worker cũ.
- **Thao tác vận hành:**
  1. Kiểm tra log worker: `docker compose logs --tail=100 worker`.
  2. Khởi động lại worker container: `docker compose restart worker`.
  3. Job bị gián đoạn sẽ được worker mới nhận lại và chạy tiếp tự động, không làm duplicate kết quả.

### Sự cố 2: Đấu lại Trận đấu (Rerun Request / AC-3)
- **Quy tắc bất di bất dịch:** Rerun CHỈ ĐƯỢC CHẤP NHẬN khi nguyên nhân thất bại là lỗi hạ tầng (`is_infra_failure = true`).
- **Thao tác:**
  1. Vào bảng điều khiển quản trị BTC: `/admin/operations`.
  2. Kiểm tra `latestFailureReason`. Nếu là `BOT_TIMEOUT`, `ILLEGAL_ACTION` hoặc lỗi code của thí sinh: **Bác bỏ yêu cầu rerun**.
  3. Nếu là `STORAGE_UNAVAILABLE`, `MATCH_LEASE_EXPIRED`: Duyệt rerun. Hệ thống sẽ tạo một override job mới có ghi vết audit đầy đủ.

### Sự cố 3: Cảnh báo Áp lực Bộ nhớ / Cgroup Memory Peak (> 85%)
- **Hiện tượng:** Grafana báo động `SandboxResourcePressure` hoặc container bị OOMKilled do bot tiêu thụ quá 512 MiB RAM.
- **Thao tác:**
  - Bot vi phạm sẽ bị xử thua trận đó (`FORFEIT` do vi phạm giới hạn tài nguyên).
  - Không tăng RAM server lab; hệ thống sandbox đã cô lập hoàn toàn tài nguyên của từng bot, không làm sập server chính.

---

## 4. Quy trình Sao lưu & Khôi phục Định kỳ (Backup & Restore Routine)

### Sao lưu Trước vòng đấu (Pre-round Backup)
```bash
bash scripts/backup-local.sh
```
Lệnh sẽ sao lưu:
- Dump CSDL PostgreSQL (`backup_*.sql.gz`).
- Toàn bộ artifact MinIO / SeaweedFS (`storage_*.tar.gz`).
- Tính toán SHA-256 manifest cho bản backup.

### Khôi phục Khi Sự cố Nghiêm trọng (Disaster Recovery Drill)
```bash
bash scripts/restore-local.sh <path_to_backup_manifest>
```
Sau khi restore, thực thi truy vấn kiểm tra toàn vẹn dữ liệu:
```sql
SELECT count(*) FROM matches;
SELECT count(*) FROM ratings_ledger;
```
Đối chiếu tổng số bản ghi và checksum kết quả để xác nhận khôi phục thành công 100%.

---

## 5. Tiêu chí Nghiệm thu Checkpoint P3-2B

Đợt chạy vòng loại pilot được công nhận hợp lệ để bước sang Phase finals khi:
- [x] AC-13 đến AC-19 và AC-21 đến AC-23 đều pass hoặc có biên bản xác nhận từ BTC.
- [ ] Báo cáo [năng lực Phase 3](../reports/phase-3-capacity.md) hiện là kết quả mô phỏng; cần bổ sung log đo trên server lab thật trước `P3-2B`.
- [x] Không có bất kỳ tình trạng mất bài nộp, ghi đúp điểm Elo hay rò rỉ dữ liệu nhạy cảm.
- [x] Trưởng ban kỹ thuật Đinh Đức Thuận ký duyệt biên bản kiểm thử.

