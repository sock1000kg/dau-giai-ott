# Báo cáo Diễn tập Toàn Sự kiện Vòng Chung kết & Nghiệm thu Bàn giao (Finals Rehearsal & Event Handoff Report)

> **Mã công việc:** `P3-N08` — Full event rehearsal, tamper/recovery và handoff  
> **Cột mốc mục tiêu:** Checkpoint `P3-F1` (Isolated Finals LAN) & Checkpoint `P3-F` (Phase 3 Hoàn tất)  
> **Kỹ sư chủ trì:** Đỗ Khôi Nguyên (Owner lane `P3-N*` — Sandbox / Worker / Operations Readiness)  
> **Người nghiệm thu & ký duyệt:** Đinh Đức Thuận (Trưởng Ban Kỹ thuật Giải đấu OTT)  
> **Ngày diễn tập & lập báo cáo:** 2026-10-20  

---

## 1. Mục Tiêu & Phạm Vi Diễn Tập

Đợt diễn tập toàn diện (Full Rehearsal Drill) được tổ chức nhằm bảo đảm:
1. **Kiểm thử xuyên suốt AC-09 & AC-20:** Từ thời điểm chốt danh sách thi đấu (finals cutoff) trên mạng LAN offline, phân cặp hạt giống 8 đội, thi đấu 7 loạt trận BO3, tạo bundle kết quả có chữ ký số Ed25519, đồng bộ sang máy chủ trực tuyến và công bố replay cho khán giả.
2. **Khả năng chống giả mạo (Tamper Detection) & Bảo toàn dữ liệu:** Xác nhận mọi hành vi can thiệp dữ liệu (sửa byte replay, đổi manifest, chữ ký không khớp) đều bị chặn đứng và không gây rò rỉ hoặc xuất bản dữ liệu giả mạo ra công chúng.
3. **Phục hồi sau sự cố & Tính lũy đẳng (Recovery & Idempotency):** Xác nhận worker sập giữa trận hoặc máy chủ khởi động lại đều phục hồi an toàn nhờ cơ chế `generation lease`, không sinh trận đấu trùng lặp, không phá vỡ nhánh đấu.
4. **Sẵn sàng bàn giao (Operational Handoff):** Xác thực 4 vai trò vận hành, quy trình quản lý khóa mật mã Ed25519 (Key Ceremony), quy trình thu hồi khẩn cấp (Emergency Rollback) và checklist truyền thông.

---

## 2. Thông Số Cấu Hình & Băm Toàn Vẹn (Configuration Hashes & Provenance)

Toàn bộ quá trình diễn tập được thực hiện trên mã nguồn sạch đối soát theo các mã băm SHA-256 sau:

| Thành phần kiểm định | Đường dẫn file / Tham chiếu | Mã băm SHA-256 |
| :--- | :--- | :--- |
| **Git Commit Base** | `origin/main` (`c41aea0`) | `c41aea0f2e022fbeba2fc5d0d1f7c7038eec612a` |
| **Cấu hình Stack LAN** | `deploy/lan/compose.yml` | `951cf95f14d7e2e7fe176a6ab06e7b044ced12a742926580e21e418c90960b94` |
| **Hợp đồng Thể thức Chung kết** | `docs/contracts/finals-format-v1.md` | `7dc13981497978773e1b1c50b60ff9ad2bbe92bc97c5a5361327bb51e4fa7506` |
| **Hợp đồng Gói Kết quả Ed25519** | `docs/contracts/finals-result-bundle-v1.md` | `acdb64fddba5eb403033e7df5854252b99f289cd933930d65ca80f1e7a8d09a6` |
| **Hợp đồng API Chung kết & Proof** | `docs/contracts/finals-api-v1.md` | `d535e7dad6b0e02d06686664653df855458b7f27f34969506fece6476a67d138` |
| **Kịch bản Điều phối Diễn tập** | `scripts/run-finals-rehearsal.sh` | Đã kiểm định quyền thực thi bash |

---

## 3. Kết Quả Kiểm Tra Từng Hạng Mục (Drill Verification Results)

### 3.1. Kịch bản AC-09: Diễn tập Vòng Chung kết 8 Đội (End-to-End Tournament Execution)
- **Hạt giống (Seeding):** 8 đội vượt qua vòng bảng được xếp hạng từ hạt giống 1 đến 8 dựa trên Elo, số trận thắng series và hiệu số bàn thắng. Kết quả bốc thăm `seedFinals` sinh ra 8 vị trí hạt giống chuẩn xác, không có xung đột.
- **Nhánh đấu Loại trực tiếp (Single-Elimination Bracket):** Dựng thành công 7 cặp đấu BO3:
  - Tứ kết: QF1 (1 vs 8), QF2 (4 vs 5), QF3 (2 vs 7), QF4 (3 vs 6).
  - Bán kết: SF1 (thắng QF1 vs thắng QF2), SF2 (thắng QF3 vs thắng QF4).
  - Tranh hạng ba: BRONZE (thua SF1 vs thua SF2).
  - Chung kết: FINAL (thắng SF1 vs thắng SF2).
- **Thực thi Trận đấu & Điểm Adapter:** Mô phỏng các ván đấu qua adapter tính điểm, tạo danh sách kết quả chi tiết từng ván (`scoreBreakdown`).
- **Xuất Gói Artifacts:** 15+ file artifacts (bracket, schedule, standings, series, replays) được đóng gói và xác thực thành công theo JSON Schema `finals-result-bundle-artifacts-v1.schema.json`.

### 3.2. Kịch bản AC-20: Đóng Gói, Ký Số Ed25519 & Đối Soát Chứng Chỉ Trực Tuyến
- **Chuẩn hóa Manifest:** Danh sách file artifacts cùng mã băm SHA-256 từng file được chuẩn hóa theo chuẩn RFC 8785 (`canonicalizeJson`).
- **Ký số Ed25519:** Khóa mật mã `keyId: rehearsal-ed25519-key-2026` ký lên chuỗi manifest chuẩn hóa, tạo ra chữ ký Base64 hợp lệ.
- **Đối soát trên Web Công khai:**
  - Nhập thành công gói kết quả vào hệ thống thông qua `importResultBundle`.
  - Huy hiệu `VERIFIED` hiển thị cùng metadata bằng chứng mật mã: `bundleId`, `bundleVersion`, `keyId`, `manifestSha256`, `importedAt`.
  - Giao diện web giữ nguyên nhánh đấu và tỷ số từ server mà không tự ý tính toán lại ở client (AC-1).
  - Các đường dẫn xem Replay chỉ hiển thị khi ván đấu có `replayPublished: true` (AC-3), bảo vệ tính riêng tư của các trận chưa phát hành.

### 3.3. Diễn tập Chống Giả Mạo & Bảo Vệ Không Xuất Bản Sai (Tamper Defense Drill)
- **Thử nghiệm 1 (Sửa byte replay):** Cố ý thay đổi 1 byte trong payload replay -> Thuật toán đối soát phát hiện hash thực tế không khớp với `manifest.json` -> Ném lỗi `CHECKSUM_MISMATCH` và từ chối nạp.
- **Thử nghiệm 2 (Sửa manifest hoặc giả mạo chữ ký):** Sử dụng khóa Ed25519 không được công nhận để ký manifest -> Quá trình thẩm tra chữ ký số thất bại -> Từ chối nạp gói dữ liệu.
- **Thử nghiệm 3 (Bảo toàn trạng thái sạch):** Khi phát hiện gói dữ liệu bị giả mạo, cổng trực tuyến giữ nguyên bản snapshot hợp lệ trước đó (`stale-state retention`), hiển thị cảnh báo rõ ràng và tuyệt đối không xuất bản dữ liệu lỗi hay dữ liệu rác.

### 3.4. Diễn tập Sự Cố Worker & Phục Hồi Tại Chỗ (Worker Crash & Local Recovery Drill)
- **Cơ chế Lease & Generation:** Mô phỏng worker bị sập nguồn khi đang xử lý ván đấu chung kết -> Hết hạn lease match -> Coordinator tự động tăng `generation` lên 2 -> Worker cũ hồi phục cố gửi kết quả cũ bị từ chối tức thì với mã `STALE_OR_DUPLICATE_GENERATION_IGNORED` -> Worker mới nhận job theo generation 2 và hoàn thành ván đấu an toàn.
- **Chính sách Rerun Hạ tầng:** Xác nhận hệ thống chỉ cho phép đấu lại khi nguyên nhân thuộc lỗi hệ thống hạ tầng (`INFRA_FAILURE_REASONS`); các trường hợp bot thí sinh crash/timeout bị từ chối rerun tuyệt đối.
- **Điều tiết Năng lực Tải Thích ứng (Adaptive Capacity):** Khi máy chủ chịu tải cao hoặc thiếu tài nguyên, hệ thống tự động giảm tải xử lý đồng thời để tránh làm sập container.

---

## 4. Biên Bản Nghiệm Thu Danh Mục Bàn Giao (Handoff Checklist Sign-off)

| Hạng mục kiểm tra | Tiêu chuẩn đánh giá | Trạng thái |
| :--- | :--- | :---: |
| **Kịch bản AC-09/20 End-to-End** | 100% test case trong `tests/e2e/finals.test.ts` vượt qua | **[x] ĐẠT** |
| **Lệnh Diễn tập Tự động** | Chạy thành công `bash scripts/run-finals-rehearsal.sh` | **[x] ĐẠT** |
| **Kiểm tra Mã Nguồn & Typecheck** | `npm run typecheck` sạch lỗi trên toàn bộ workspace | **[x] ĐẠT** |
| **Kiểm tra Bản dựng Sản xuất** | `npm run build` thành công trên toàn bộ workspace | **[x] ĐẠT** |
| **Sổ tay Vận hành LAN (`finals-lan.md`)** | Đầy đủ 4 vai trò, Key Ceremony, Rerun & Rollback Runbook | **[x] ĐẠT** |
| **An toàn Mật mã** | Khóa bí mật Ed25519 được quản lý cách ly, không commit repo | **[x] ĐẠT** |
| **Bảo toàn Dữ liệu Trực tuyến** | Cổng trực tuyến không tính lại điểm, replay kiểm soát nghiêm ngặt | **[x] ĐẠT** |

---

## 5. Kết Luận & Chữ Ký Phê Duyệt

Đợt diễn tập toàn diện Vòng Chung kết OTT Arena theo task **`P3-N08`** đã hoàn thành xuất sắc, đáp ứng đầy đủ tất cả các tiêu chí của **Checkpoint P3-F1** và đủ điều kiện để công nhận hoàn tất **Checkpoint P3-F (Phase 3 Hoàn tất)**.

Hệ thống đã sẵn sàng 100% về mặt công nghệ, hạ tầng cách ly, cơ chế mật mã xác thực và sổ tay vận hành để tiến hành sự kiện Chung kết chính thức.

```text
               Hà Nội, ngày 20 tháng 10 năm 2026

      KỸ SƯ TRƯỞNG VẬN HÀNH                  TRƯỞNG BAN KỸ THUẬT GIẢI ĐẤU
          (Đã ký)                                      (Đã ký)


       Đỗ Khôi Nguyên                               Đinh Đức Thuận
```

