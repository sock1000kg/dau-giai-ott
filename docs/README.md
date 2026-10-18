# Tài liệu dự án đấu giải OTT

> Cập nhật: 14/10/2026
>
> Đây là mục lục và quy tắc quản trị tài liệu chính thức. AI phải đọc file này trước khi kết hợp nhiều tài liệu.

## 1. Nguồn sự thật theo từng loại thông tin

Không dùng một thứ tự ưu tiên duy nhất cho mọi vấn đề. Mỗi nhóm thông tin có đúng một nguồn quyết định:

| Loại thông tin | Nguồn sự thật | Tài liệu khác được phép làm gì |
| --- | --- | --- |
| Cách AI/Git làm việc | `AGENTS.md`, `CLAUDE.md` | Chỉ giải thích thêm, không nới lỏng rules |
| Nghiệp vụ, luật game, phạm vi sản phẩm | [Đặc tả yêu cầu](tai-lieu-yeu-cau.md) | Plan/task chỉ triển khai một phần đã nêu |
| Quyết định kiến trúc đã chấp nhận | [ADRs](decisions/) | Tài liệu khác phải dẫn link, không quyết định lại |
| Bức tranh kiến trúc và ranh giới component | [SA Phase 2](architecture/solution-architecture-phase-2.md), [SA Phase 3](architecture/solution-architecture-phase-3.md) | Mô tả cách ghép hệ thống; SA không được thay exact semantics trong ADR/contract Accepted |
| Engine/Bot/Auth/Replay/Finals contract | [Engine API v1](contracts/engine-api-v1.md), [Bot Protocol v1](contracts/bot-protocol-v1.md), [Bot Protocol v2](contracts/bot-protocol-v2.md), [Platform Auth v1](contracts/platform-auth-v1.md), [Platform Auth v2](contracts/platform-auth-v2.md), [Spectator Replay v1](contracts/spectator-replay-v1.md), [Finals Format v1](contracts/finals-format-v1.md), [ResultBundle v1](contracts/finals-result-bundle-v1.md) | Phần tóm tắt không được thay đổi field/semantics; schema v2 được triển khai trong task owner tương ứng |
| Owner và ranh giới module | [Phân công Phase 1–3](team-assignment.md) | Chọn đúng mục theo phase; AI context chỉ lọc phần liên quan cho từng người |
| Package, phiên bản công cụ, liên kết module và lệnh chạy | [Convention package module](conventions/module-package.md) | Task card chỉ dẫn lệnh theo convention, không pin phiên bản riêng |
| Dependency, checkpoint và trạng thái task | [Task checklist](../tasks/todo.md) | [Implementation plan](../tasks/plan.md) chỉ cung cấp bức tranh tổng thể |
| Cách một thành viên bắt đầu với AI | [AI context pack](ai-context/) | Không phải nguồn để thay đổi requirement/contract/task |

Nếu hai nguồn sự thật khác loại mâu thuẫn nhau, AI phải dừng trước khi code, trích đúng hai đoạn mâu thuẫn và chuyển owner quyết định. Không tự chọn tài liệu mới hơn, dài hơn hoặc thuận tiện hơn.

## 2. Trạng thái hiện tại

- `P1-T01` đã hoàn tất: ADR-0002, Engine API v1, Bot Protocol v1, schema và fixtures đã khóa.
- `main` là nhánh tích hợp và nguồn deploy. `develop` được giữ lại như nhánh legacy sau lần chuyển convention ngày 2026-10-12 và không còn là base/target branch.
- Ngày 2026-10-09 owner Phase 1 đổi theo lane: Long Trần làm core/protocol (`P1-L*`), Đỗ Khôi Nguyên làm bot Python (`P1-N*`), Phạm Tất Đạt làm MatchRunner (`P1-D*`). Backend local Phase 2 được phát hành cho Thuận dưới `P2-T02`–`P2-T15` ngày 2026-10-12; ngày 2026-10-13 toàn bộ frontend, replay và E2E Phase 2 còn lại cũng được phát hành lại cho Thuận dưới `P2-T17A`, `P2-T17B`, `P2-T18`–`P2-T29`. Deploy cloud không thuộc phạm vi Phase 2 hiện tại. Bảng lịch sử ID: [`tasks/plan.md` mục 2.2.1](../tasks/plan.md).
- Workspace chung là `P1-T02` của Đinh Đức Thuận (thay `P1-D01` đã hủy), gộp sau Checkpoint `P1-B`; trước đó mỗi module tự khai báo dependency và chạy local.
- Các feature branch remote hiện có đều đã là tổ tiên của `main`; `main` còn chứa validator protocol, lifecycle/hash/event core, BotProcess và CLI mới hơn `develop`.
- Source root là [`src/`](../src/README.md); Phase 1 đã có implementation cho game-core, bot-protocol, MatchRunner và Python bots.
- Kế hoạch GitNexus ngày 08/10 trong `docs/plans/` đã bị supersede; không dùng task ID hoặc owner trong tài liệu đó.
- Phase 3 đã được Đinh Đức Thuận duyệt baseline requirement/ADR/contract tại `P3-T01` ngày 14/10/2026.
  Wave 1 (`P3-L01`, `P3-D01`, `P3-N01`) sẵn sàng nhận việc; mọi implementation/checkpoint còn lại vẫn mở
  và chỉ được tick sau verification trong `tasks/todo.md`.

## 3. Quy trình branch thống nhất

| Thành viên | Prefix branch | Ví dụ |
| --- | --- | --- |
| Đinh Đức Thuận | `thuandd/` | `thuandd/feat-p2-t01-decisions` |
| Long Trần | `longt/` | `longt/feat-p1-l01-game-baseline` |
| Đỗ Khôi Nguyên | `nguyendk/` | `nguyendk/feat-p1-n01-bot-sdk` |
| Phạm Tất Đạt | `datpt/` | `datpt/feat-p1-d02-ports` |

Luồng branch:

1. Khởi tạo: `main` là nguồn branch và nhánh tích hợp chung.
2. Phát triển: mỗi người tạo branch task từ `main` mới nhất, làm và verify trên branch đó.
3. Tích hợp: mỗi task mở pull request vào `main`.
4. Checkpoint: Thuận duyệt checkpoint trên `main` sau khi các task liên quan đã merge và integration/E2E pass.
5. Triển khai: sau khi hoàn thiện, Thuận deploy từ `main` lên các môi trường.
6. `develop` là nhánh legacy; không merge feature vào, không tạo branch từ và không deploy từ nhánh này.

```mermaid
flowchart LR
    M["main — tích hợp và deploy"] -->|checkout| F["Branch task cá nhân<br/>vd. longt/feat-p1-l01-game-baseline"]
    F -->|pull request| M
    M --> C["Checkpoint Thuận duyệt"]
    C --> E["Thuận deploy từ main<br/>lên các môi trường"]
```

Quy tắc:

- Feature dùng `<prefix>feat-<task-id>-<slug>`; fix dùng `<prefix>fix-<task-id>-<slug>`; tài liệu dùng `<prefix>docs-<task-id>-<slug>`.
- Mỗi task dùng một branch riêng tạo từ `main`.
- Không code trực tiếp trên `main`.
- Mỗi pull request chỉ chứa một task và target `main`.
- Chỉ Đinh Đức Thuận deploy, và chỉ từ `main` sau khi integration/E2E và checkpoint pass.

## 4. Bắt đầu tại đây

1. [Hướng dẫn thành viên mới tham gia dự án với AI](huong-dan-tham-gia-du-an-voi-ai.md).
2. [Đặc tả yêu cầu hệ thống](tai-lieu-yeu-cau.md).
3. [Phân công Phase 1–3](team-assignment.md).
4. [Implementation plan](../tasks/plan.md).
5. [Task checklist](../tasks/todo.md).

## 5. Quyết định và contract đã khóa

- [ADR-0001 — Stack và môi trường local](decisions/0001-technology-stack-and-local-development.md).
- [ADR-0002 — Engine và Bot Protocol v1](decisions/0002-phase-1-engine-and-bot-protocol-v1.md).
- [ADR-0003 — Chỉ phát hành replay sau khi trận kết thúc](decisions/0003-replay-publication-after-match.md).
- [ADR-0004 — Tài khoản đội được BTC provision cho Phase 2](decisions/0004-phase-2-team-account-authentication.md).
- [ADR-0005 — Modular monolith và execution worker Phase 2](decisions/0005-phase-2-modular-monolith-and-execution-boundary.md).
- [ADR-0006 — OCI image submission cho bot đa ngôn ngữ](decisions/0006-oci-image-submissions-for-language-neutral-bots.md).
- [ADR-0007 — SeaweedFS S3-compatible cho local Phase 2](decisions/0007-seaweedfs-local-s3-compatible-storage.md).
- [ADR-0008 — Protocol v2 và game adapter Phase 3](decisions/0008-phase-3-protocol-v2-and-game-adapter-boundary.md).
- [ADR-0009 — Hosted PoC một server lab](decisions/0009-single-server-hosted-poc-topology.md).
- [ADR-0010 — Finals bracket và signed ResultBundle](decisions/0010-finals-bracket-and-signed-result-bundle.md).
- [Engine API v1](contracts/engine-api-v1.md).
- [Bot Protocol v1](contracts/bot-protocol-v1.md), [JSON Schema](contracts/bot-protocol-v1.schema.json) và [fixtures](contracts/fixtures/).
- [Bot Protocol v2](contracts/bot-protocol-v2.md), [JSON Schema](contracts/bot-protocol-v2.schema.json) và [fixtures](contracts/fixtures/bot-protocol-v2-valid.ndjson).
- [Platform Authentication Contract v1](contracts/platform-auth-v1.md).
- [Platform Authentication Contract v2](contracts/platform-auth-v2.md).
- [Spectator Replay API v1](contracts/spectator-replay-v1.md).
- [Spectator Replay API v2](contracts/spectator-replay-v2.md).
- [Public snapshot v1](contracts/public-snapshot-v1.md).
- [Finals Format v1](contracts/finals-format-v1.md) và [Finals ResultBundle v1](contracts/finals-result-bundle-v1.md).

## 6. Kiến trúc

- [Solution Architecture — Phase 2 local](architecture/solution-architecture-phase-2.md).
- [Solution Architecture — Phase 3](architecture/solution-architecture-phase-3.md) — baseline Accepted; implementation vẫn theo trạng thái task/checkpoint.
- [SAD — OCI bot submission và sandbox execution](architecture/sad-oci-bot-submissions.md).

## 7. AI Context Pack theo thành viên

- [Đinh Đức Thuận](ai-context/dinh-duc-thuan.md).
- [Long Trần](ai-context/long-tran.md).
- [Đỗ Khôi Nguyên](ai-context/do-khoi-nguyen.md).
- [Phạm Tất Đạt](ai-context/pham-tat-dat.md).

AI context pack là điểm bắt đầu theo vai trò. Task ID, dependency và trạng thái hoàn thành luôn phải đọc lại từ `tasks/todo.md`.

## 8. Chính sách cập nhật tài liệu liên tục

Tài liệu là một phần của implementation, không phải bước làm sau:

- Code và tài liệu liên quan phải thay đổi trong cùng task branch và cùng pull request.
- Thay đổi behavior/API/schema/config/command phải cập nhật requirement, contract, ADR, README hoặc runbook tương ứng.
- Task chỉ được tick `[x]` khi acceptance criteria, verification và phần tài liệu liên quan đều hoàn tất.
- Diagram chỉ gắn `✅` sau khi task/checkpoint đã được xác nhận; không suy đoán tiến độ từ file tồn tại hoặc báo cáo của AI.
- Sau khi merge vào `main`, task owner hoặc Đinh Đức Thuận cập nhật trạng thái tập trung ngay, không chờ cuối phase.
- Handoff phải ghi `DOCS UPDATED` và liệt kê tài liệu đã sửa; nếu không cần sửa, ghi rõ lý do `not applicable`.
