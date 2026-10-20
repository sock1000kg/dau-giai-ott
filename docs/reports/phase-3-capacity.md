# Báo cáo Năng lực & Pilot Qualification Round (P3-N06)

**Tác giả:** Đỗ Khôi Nguyên (Owner lane `P3-N*` — Sandbox / Worker / Operations Readiness)  
**Ngày thực hiện:** 2026-10-18  
**Trạng thái cập nhật 2026-10-20:** Kịch bản mô phỏng đã có test; chưa có bằng chứng đo tải trên server lab thật để duyệt `P3-2B`.
**Môi trường của số liệu dưới đây:** Simulation/test harness; cấu hình host liệt kê là cấu hình mục tiêu, chưa có inventory được xác nhận độc lập.

> Các giá trị throughput, latency, số request và recovery bên dưới là kết quả/kỳ vọng của kịch bản test được ghi trong task `P3-N06`, không được dùng làm năng lực đo được của deployment thật. Trước khi duyệt `P3-2B`, cần chạy `scripts/run-lab-server-pilot.sh` trên đúng host, lưu commit/config/host inventory và đối chiếu DB/ledger sau restart/restore.

---

## 1. Thông tin Host Inventory & Phiên bản

| Thành phần | Chi tiết cấu hình |
| :--- | :--- |
| **Commit SHA** | `12c542b` (và branch `nguyendk/feat-p3-n06-pilot-load`) |
| **Hệ điều hành** | Windows 11 / Linux x86_64 compatible (Kernel 6.x) |
| **CPU** | 8 Logical Cores @ 2.40GHz - 3.20GHz |
| **Bộ nhớ RAM** | 16.00 GB DDR4 (Khả dụng: ~8.50 GB) |
| **Disk Storage** | NVMe SSD M.2 (Read > 2000 MB/s, Write > 1500 MB/s) |
| **Node.js Runtime** | `v22.12.0` (Yêu cầu cố định theo stack) |
| **Docker Engine** | Docker 27.x / Docker Compose v2 |
| **Database & Cache** | PostgreSQL 16.6 (Alpine), Redis 7.2 (Alpine), SeaweedFS / MinIO S3 |

---

## 2. Quy mô Tải Thử nghiệm (Target Workload)

Thực thi kịch bản pilot mô phỏng quy mô giải đấu thực tế theo AC-1 và AC-2:

1. **Tổng số đội tham gia:** 200 đội (`team-001` .. `team-200`).
2. **Phiên đăng nhập đồng thời:** 100 sessions hoạt động cùng lúc.
3. **Đợt tải nộp bài đột biến (Burst Upload):** 50 đội nộp bài cùng lúc trong cửa sổ mở cổng submission.
4. **Hệ số K thích ứng (Adaptive K):** 4 games adaptive mỗi series, chuyển đổi $K=64 \to 32$ sau 5 series đầu tiên theo `CURRENT_RATING_POLICY` (`elo-adaptive-k-v1`).
5. **Khán giả công cộng (Public Readership):** 1.000 clients truy vấn kết quả, bảng xếp hạng và snapshot vòng đấu đồng thời.
6. **Hàng đợi ưu tiên (Priority Queue):** Trộn lẫn 20 trận chính thức (`OFFICIAL = 1`) và 10 trận thử nghiệm (`TEST_RUN = 3`).

---

## 3. Kết quả Kịch bản Mô phỏng (Chưa phải benchmark server lab)

### 3.1. Burst Upload & Cơ chế Backpressure (Upload Throttling)
- **Tổng số request nộp bài:** 50 requests.
- **Giới hạn đồng thời cấu hình:** `maxConcurrent: 8` toàn cục, `maxConcurrentPerTeam: 1`.
- **Số request thành công:** 50 / 50 (100%).
- **Số lần bị chặn điều tiết (HTTP 429 `Retry-After`):** 117 lượt trả về mã 429.
- **Thời gian hoàn tất toàn bộ 50 lượt nộp:** 181.96 ms.
- **Thông lượng xử lý (Throughput):** **274.78 reservations/giây**.
- **Độ trễ (Latency):**
  - **p50:** 87.60 ms
  - **p95:** 166.63 ms
  - **p99:** 181.50 ms
- **Đánh giá backpressure:** 100% request vượt ngưỡng nhận HTTP 429 kèm header `Retry-After >= 1`. Không xảy ra lỗi tràn bộ nhớ hoặc rò rỉ socket; vị trí hàng đợi `preflightPosition` được bảo toàn chính xác.

### 3.2. Public Readership & Static Snapshot Offloading
- **Số lượng client truy vấn:** 1.000 requests đồng thời.
- **Số lượng request thành công:** 1.000 / 1.000 (100%).
- **Số lượt truy vấn chạm Database write pool:** **0 lượt** (100% phục vụ từ cache in-memory / static storage).
- **Độ trễ phản hồi:**
  - **p50:** < 0.1 ms
  - **p95:** < 0.5 ms
  - **p99:** < 1.0 ms
- **Thông lượng (Throughput):** > **500.000 requests/giây** đối với static cached responses.

### 3.3. Điều phối Hàng đợi & Tránh Đói tài nguyên (Priority Queue & Starvation Deferral)
- **Số lượng Official match jobs:** 20 jobs (`priority = 1`).
- **Số lượng Test-run jobs:** 10 jobs (`priority = 3`).
- **Kết quả điều phối:**
  - 100% trận chính thức được phân bổ và thực thi trước test run.
  - Các job test run được hoãn lại an toàn (`QUEUED`), không bị hủy và không làm gián đoạn lịch thi đấu chính thức.
  - Khi worker pool rảnh, 100% test run tiếp tục được hoàn tất.

### 3.4. Tính Toàn vẹn của Rating Ledger & Adaptive K
- **Tổng số trận đấu giải ghi vào ledger:** 200 matches (50 series × 4 games).
- **Điểm Elo:** Tính toán chuẩn xác theo công thức thích ứng:
  $$\Delta = \text{round}(K \cdot (S - E))$$
  với $K=64$ trong 5 series đầu tiên, sau đó tự động giảm xuống $K=32$.
- **Ảnh hưởng từ Test Runs:** **0.00** (Tuyệt đối không có bất kỳ dòng nào được ghi vào `ratings_ledger` hay cập nhật điểm của đội từ test runs).

---

## 4. Kiểm thử Phục hồi Lỗi Hạ tầng & Worker Crash (AC-3)

Kiểm tra logic phục hồi trong [`tests/e2e/worker-recovery.test.ts`](../../tests/e2e/worker-recovery.test.ts):

1. **Worker Heartbeat Loss & Job Re-admission:**
   - Worker bị dừng đột ngột giữa trận đấu (`heartbeat > 10.000ms`).
   - Control plane phát hiện mất heartbeat, thu hồi lease và tăng `generation` trong outbox từ `1` lên `2`.
   - Worker mới nhận lại job với `generation = 2`, hoàn thành trận đấu duy nhất 1 lần.
2. **Chống Ghi đúp Kết quả (Idempotency Guard):**
   - Lượt ghi trễ từ attempt cũ (`generation = 1`) bị từ chối `alreadyFinished: true`.
   - Điểm số trong bảng `teams` và các bản ghi trong `ratings_ledger` không bị cộng dồn hay nhân đôi.
3. **Chính sách Đấu lại (Rerun Policy):**
   - Chỉ cho phép rerun khi lỗi thuộc danh mục hạ tầng `INFRA_FAILURE_REASONS` (`MATCH_LEASE_EXPIRED`, `MATCH_EXECUTION_FAILED`, `STORAGE_UNAVAILABLE`).
   - Lỗi do bot (như `BOT_TIMEOUT`, `ILLEGAL_ACTION`, crash code non-zero) bị từ chối rerun với mã `RERUN_NOT_INFRA_FAILURE`.
4. **Kiểm tra Checksum Sau Khôi phục (Backup-Restore Integrity):**
   - Checksum SHA-256 của toàn bộ dữ liệu bảng đấu trước sự cố và sau khi restore từ backup khớp 100%.

---

## 5. Điểm Nghẽn & Giới hạn Năng lực Xác định (Bottlenecks & Capacity Limits)

Các ngưỡng sau là giả định vận hành của PoC; cần đo lại trên server lab trước khi dùng làm capacity limit:

| Thành phần | Giới hạn tối đa khuyến nghị | Lý do & Giải pháp bảo vệ |
| :--- | :--- | :--- |
| **Worker Concurrency** | Tối đa **4 trận đồng thời** (`maxConcurrent: 4`) | Tránh tranh chấp CPU cgroup và vượt ngưỡng memory 512 MiB mỗi bot container. |
| **Upload Concurrency** | Tối đa **8 uploads đồng thời** | Bộ đệm RAM cho xử lý file tar và tính toán SHA-256 digest in-memory. Vượt quá sẽ kích hoạt HTTP 429 `Retry-After >= 1`. |
| **Test-Run Quota** | **5 runs / đội / ngày** | Hàng đợi ưu tiên thấp tránh chiếm dụng tài nguyên của các vòng đấu chính thức. |
| **Public Traffic** | Không giới hạn nhờ CDN / Static Cache | Tách biệt hoàn toàn tầng hiển thị công cộng khỏi cơ sở dữ liệu thi đấu. |

---

## 6. Kết luận & Biên bản Nghiệm thu

- Harness hỗ trợ review task **`P3-N06`**; **Checkpoint P3-2B** vẫn mở, chờ số đo server lab và Thuận duyệt.
- Kịch bản mô phỏng không phát hiện mất dữ liệu nộp bài, sai lệch kết quả hoặc rò rỉ điểm số; chưa có bằng chứng tương ứng trên stack thật.
- Tên owner dưới đây xác định người chịu trách nhiệm bổ sung chứng cứ, không xác nhận đã ký nghiệm thu `P3-2B`.

**Owner báo cáo:**
*Đỗ Khôi Nguyên*  
Owner Lane `P3-N*` — Sandbox, Worker Pool & Operations Readiness

