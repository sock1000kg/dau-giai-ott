# Implementation Plan: Phase 1–2 theo phân công nhóm Dev

**Trạng thái:** Đã tự động duyệt — sẵn sàng triển khai
**Mức khuyến nghị:** Cao (`HIGH RECOMMEND`)
**Người duyệt:** Đinh Đức Thuận, theo quy tắc tự động duyệt tài liệu mức cao
**Nguồn:** `docs/team-assignment-phase-1-2.md`, `docs/tai-lieu-yeu-cau.md`
**Task chi tiết:** `tasks/todo.md`

`tasks/todo.md` là nguồn duy nhất cho trạng thái và dependency task. Nếu phần index trong plan này khác checklist, dừng và sửa hai file trong cùng thay đổi trước khi giao task cho AI.

## 0. Quy tắc phê duyệt tài liệu

- Tài liệu được đánh giá `HIGH RECOMMEND` được Đinh Đức Thuận tự động duyệt.
- Tài liệu mức trung bình, thấp hoặc còn quyết định ảnh hưởng lớn phải chờ duyệt thủ công.
- Tự động duyệt chỉ áp dụng cho tài liệu; không tự động cho phép triển khai cloud, thao tác phá hủy dữ liệu hoặc bỏ qua checkpoint kỹ thuật.

## 1. Mục tiêu

Phase 1 phải tạo được một lệnh chạy hai bot Python trên localhost, dùng game core triển khai theo hành vi Human-vs-Human tham chiếu, giao tiếp qua Bot Protocol v1 và xuất kết quả/event log có thể tái hiện.

Phase 2 dùng kết quả Phase 1 để xây luồng nộp bot, queue/worker, sandbox, scheduling, Elo, leaderboard và giao diện web trên local. Việc triển khai cloud do Đinh Đức Thuận thực hiện sau khi bản local đạt cổng nghiệm thu.

## 2. Quy ước ID và owner

### 2.1 Cấu trúc Task ID

Task ID dùng mẫu:

```text
P<phase>-<owner><sequence>
```

Ví dụ `P1-L01`:

- `P1`: Phase 1.
- `L`: owner là Long Trần.
- `01`: task thứ nhất của Long trong Phase 1.

Quy tắc:

- `phase` bắt đầu từ `1` và tăng theo giai đoạn triển khai.
- `owner` dùng đúng mã trong bảng bên dưới.
- `sequence` gồm hai chữ số, tăng riêng cho từng owner trong từng phase: `01`, `02`, `03`...
- Task ID đã phát hành không được tái sử dụng cho công việc khác.
- Checkpoint dùng mẫu riêng như `P1-A`, `P1-B`; đây không phải task của một owner.

### 2.2 Mã owner

| Ký hiệu | Owner | Phạm vi |
| --- | --- | --- |
| `T` | Đinh Đức Thuận | Quyết định chung, phê duyệt cổng và nhận bàn giao local |
| `L` | Long Trần | Core Game API và Bot Protocol v1 |
| `N` | Đỗ Khôi Nguyên | Bot Python hợp lệ, bot lỗi và contract test phía bot |
| `D` | Phạm Tất Đạt | MatchRunner, BotProcess, CLI/E2E; Phase 2 platform local |

### 2.2.1 Đổi task ID ngày 2026-10-09

Đinh Đức Thuận đổi owner theo lane, sau đó đánh lại task ID để chữ cái khớp owner mới. Đây là ngoại lệ một lần của quy tắc không tái sử dụng ID; mọi tài liệu hiện hành đã dùng ID mới. Gặp ID cũ trong lịch sử chat, commit hoặc `docs/plans/`, tra bảng này:

| ID cũ | ID mới | Lane |
| --- | --- | --- |
| `P1-D01`–`P1-D08` | `P1-L01`–`P1-L08` | Core + protocol (Long) |
| `P1-L01`–`P1-L06` | `P1-N01`–`P1-N06` | Bot Python (Nguyên) |
| `P1-N01` | `P1-D01` (đã hủy) | Workspace, thay bằng `P1-T02` |
| `P1-N02`–`P1-N11` | `P1-D02`–`P1-D11` | Runner + integration (Đạt) |
| `P2-L01` | `P2-N01` | Sandbox corpus (Nguyên) |
| `P2-N01`–`P2-N13` | `P2-D01`–`P2-D13` | Platform (Đạt) |

Mỗi task chỉ có một owner chính. Người review không sửa trực tiếp vào phạm vi của owner nếu chưa trao đổi.

### 2.3 Branch theo owner

Branch tạo từ `develop` theo owner:

| Owner | Prefix | Ví dụ |
| --- | --- | --- |
| Đinh Đức Thuận | `thuandd/` | `thuandd/feat-p2-t01-decisions` |
| Long Trần | `longt/` | `longt/feat-p1-l01-game-baseline` |
| Đỗ Khôi Nguyên | `nguyendk/` | `nguyendk/feat-p1-n01-bot-sdk` |
| Phạm Tất Đạt | `datpt/` | `datpt/feat-p1-d02-ports` |

Mỗi branch chứa đúng một task, pull request target `develop`; không code trực tiếp trên `develop` hoặc `main`. Checkpoint duyệt trên `develop`, và Thuận deploy từ `develop`. Luồng đầy đủ: [`docs/README.md` mục 3](../docs/README.md).

## 3. Baseline đã khóa

- Node.js 22, TypeScript, Vitest và npm workspaces.
- Source root là `src/`; layout chi tiết tại `src/README.md`.
- Bot dùng Python 3.12.x, entrypoint `bot.py`, spawn trực tiếp bằng argv.
- Phase 1 dùng STDIO/NDJSON, chưa có PostgreSQL, Redis, MinIO hoặc HTTP API.
- `STATE_UPDATE` gửi `legalActions`; Engine vẫn validate lại action.
- Protocol limits và fault policy được khóa tại `docs/contracts/bot-protocol-v1.md`.
- Engine API được khóa tại `docs/contracts/engine-api-v1.md`.
- Không sao chép source tham chiếu chưa có LICENSE; triển khai theo behavior contract và commit đã pin.

## 4. Dependency graph Phase 1

```text
P1-T01 Contract docs/schema đã khóa
    ├── P1-N01 → P1-N02…N05 → P1-N06
    │
    └── P1-L01 → L02 → L03 → L04
                    │       │
                    │       └── P1-L05 → L06 → L07 → L08
                    │
                    └── P1-D02 → D03…D08

Checkpoint P1-B ──► P1-T02 Workspace chung (Thuận)
P1-L08 + P1-D08 + P1-T02 ──► P1-D09 Core integration
P1-D09 + P1-N06 ──► P1-D10 Full local E2E ──► P1-D11 Local handoff
```

## 5. Phase 1 task index

### Gate 0 — Quyết định và workspace

- [x] `P1-T01` — Khóa các quyết định trước khi code — Đinh Đức Thuận.
- `P1-D01` — Đã hủy, chuyển thành `P1-T02` (Thuận, sau Checkpoint `P1-B`).
- [ ] `P1-L01` — Triển khai behavior baseline Human-vs-Human — Long Trần.

### Gate 1 — Hiện thực contract đã khóa

- [ ] `P1-L02` — Hiện thực Engine API và domain types đã khóa — Long Trần.
- [ ] `P1-L03` — Hiện thực message types Bot Protocol v1 đã khóa — Long Trần.
- [ ] `P1-L04` — Hiện thực validator và contract tests từ schema/fixtures — Long Trần.

### Lane Long — Core và protocol

- [ ] `P1-L05` — API điều khiển game theo side/action.
- [ ] `P1-L06` — Skip turn, maxTurns và GameResult.
- [ ] `P1-L07` — Event transition và finalStateHash.
- [ ] `P1-L08` — Regression test Human-vs-Human và tài liệu core.

### Lane Nguyên — Bot kiểm thử

- [ ] `P1-N01` — Python Bot SDK tối thiểu.
- [ ] `P1-N02` — FirstLegalBot.
- [ ] `P1-N03` — CaptureFirstBot.
- [ ] `P1-N04` — Bot lỗi JSON/action/turnId.
- [ ] `P1-N05` — Bot timeout/crash/oversize.
- [ ] `P1-N06` — Contract test và README bot.

### Lane Đạt — Runner và tích hợp local

- [ ] `P1-D02` — GamePort, BotPort và fakes.
- [ ] `P1-D03` — MatchRunner happy path.
- [ ] `P1-D04` — MatchRunner error/skip/cleanup.
- [ ] `P1-D05` — BotProcess NDJSON adapter.
- [ ] `P1-D06` — BotProcess timeout và process cleanup.
- [ ] `P1-D07` — Event log và replay verifier.
- [ ] `P1-D08` — CLI chạy trận.
- [ ] `P1-T02` — Gộp workspace chung — Đinh Đức Thuận, sau Checkpoint `P1-B`.
- [ ] `P1-D09` — Tích hợp core thật với MatchRunner.
- [ ] `P1-D10` — E2E hai bot và các bot lỗi.
- [ ] `P1-D11` — Runbook và bàn giao local.

## 6. Checkpoint Phase 1

### Checkpoint P1-A — Executable contract baseline

Điều kiện:

- `P1-T01`, `P1-L01`–`P1-L04`, `P1-N01` và `P1-D02` hoàn tất.
- Python SDK và MatchRunner ports cùng dùng contract/schema/fixtures chính thức, không tạo bản protocol riêng.
- Sau checkpoint, thay đổi message/schema/error code phải do Long cập nhật và có review của Nguyên, Đạt.

### Checkpoint P1-B — Ba lane chạy độc lập

Điều kiện:

- Long hoàn tất `P1-L05` đến `P1-L08`.
- Nguyên hoàn tất `P1-N01` đến `P1-N06`.
- Đạt hoàn tất `P1-D02` đến `P1-D08`.
- Unit và contract tests của từng lane chạy độc lập trên localhost.

### Checkpoint P1-C — Phase 1 complete

Điều kiện:

- `P1-D09` đến `P1-D11` hoàn tất.
- Hai bot hợp lệ chơi hết một trận.
- JSON sai, illegal action, wrong turnId, timeout, crash và oversized output đều có automated evidence.
- Chạy lại cùng input cho cùng event sequence và `finalStateHash`.
- Full typecheck, test và build pass trước khi bắt đầu Phase 2.

## 7. Dependency graph Phase 2

```text
Phase 1 complete
    ├── P2-T01 Khóa auth/quota/Elo/series decisions ─────┐
    └── P2-D01 Local Docker services ────────────────────┤
                                                         ▼
                     P2-D02 Database → P2-D03 Auth/RBAC → P2-D04 Team
                                                         │
                                                         ▼
                                                P2-D05 Submission ──► P2-D11 Submission UI
                                                         │
                    P2-N01 Canary/security corpus ────────┤
                                                         ▼
                          P2-D06 Worker → P2-D07 Sandbox → P2-D08 Finalization
                                                         ▼
                          P2-D09 Scheduling → P2-D10 Elo/results API → P2-D12 Results UI

P2-D08 + P2-D09 + P2-D10 + P2-D11 + P2-D12 ──► P2-D13 Qualification E2E
```

## 8. Phase 2 task index

- [ ] `P2-T01` — Khóa quyết định triển khai Phase 2 local.
- [ ] `P2-D01` — Docker Compose PostgreSQL/Redis/MinIO.
- [ ] `P2-D02` — Database schema và migration foundation.
- [ ] `P2-D03` — Authentication và RBAC foundation.
- [ ] `P2-D04` — Team management vertical slice.
- [ ] `P2-D05` — Submission upload và MinIO vertical slice.
- [ ] `P2-N01` — Canary bot và sandbox security corpus.
- [ ] `P2-D06` — MatchJob và BullMQ worker.
- [ ] `P2-D07` — Sandbox adapter và artifact validation.
- [ ] `P2-D08` — MatchResult finalization idempotent.
- [ ] `P2-D09` — Scheduling và series scoring.
- [ ] `P2-D10` — Match results, Elo ledger và leaderboard API.
- [ ] `P2-D11` — React/Vite submission UI.
- [ ] `P2-D12` — React/Vite results và leaderboard UI.
- [ ] `P2-D13` — Qualification E2E local.

## 9. Cảnh báo tải Phase 2

Đạt sở hữu 13/14 task Dev của Phase 2; Nguyên sở hữu một task corpus. `P2-T01` là decision gate của Thuận. Các task của Đạt không thể chạy song song bởi một người. Thứ tự bắt buộc là:

1. Hạ tầng local và database.
2. Authentication/RBAC, team và submission.
3. Queue/worker/sandbox.
4. Result finalization, scheduling và Elo.
5. UI và E2E.

Trước Phase 2, nhóm phải chọn một trong hai:

- Chấp nhận Đạt triển khai tuần tự; hoặc
- Chia bớt sandbox/worker hay scheduling/Elo cho người khác.

Không dùng AI như một “thành viên thứ hai” để mở đồng thời nhiều branch chạm cùng schema/module.

## 10. Rủi ro

| Rủi ro | Mức độ | Giảm thiểu |
| --- | --- | --- |
| Source tham chiếu chưa có LICENSE | Cao | Chỉ đối chiếu behavior; không copy/submodule/package source |
| Protocol đổi khi ba lane đang code | Cao | Contract docs/schema khóa tại `P1-T01`; executable baseline tại `P1-L04`; Long là owner duy nhất |
| Nguyên hoặc Đạt phải chờ implementation của Long | Trung bình | Dùng JSON fixtures, `FakeGame` và `ScriptedBot` |
| Child process treo/rò rỉ | Cao | Cleanup trong `finally`, timeout monotonic, test còn PID/open handle |
| Phase 2 dồn quá nhiều cho Đạt | Cao | Re-plan owner trước khi mở Phase 2 hoặc làm tuần tự |
| Task vượt 5 file | Trung bình | Tách task trước khi bắt đầu; không mở rộng scope trong cùng PR |

## 11. Open questions không chặn Phase 1

- Owner bổ sung cho Phase 2, nếu không chấp nhận Đạt triển khai tuần tự.
- CPU/RAM/PID quota, auth/RBAC, Elo và series policy phải được khóa tại `P2-T01`.
- Các quyết định bracket/finals phải khóa trước giai đoạn tương ứng.

## 12. Plan verification

- [x] Mỗi task có owner.
- [x] Task chi tiết có acceptance criteria, verification, dependency và file dự kiến trong `tasks/todo.md`.
- [x] Mỗi task dự kiến chạm tối đa 5 file.
- [x] Có checkpoint sau contract, sau ba lane và sau E2E.
- [x] Plan cũ và plan mới là cùng phạm vi nên được cập nhật tại chỗ.
- [x] Plan đạt `HIGH RECOMMEND` và được Đinh Đức Thuận tự động duyệt.
