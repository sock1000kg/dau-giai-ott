# AI Context Pack — Đinh Đức Thuận

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: owner Phase 2 local; approver decision/ADR/contract và checkpoint Phase 3

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi đúng câu sau:

```text
Đọc toàn bộ file docs/ai-context/dinh-duc-thuan.md và dùng nó làm context điều hành.
Gate P3-0/P3-T01 đã đạt ngày 14/10/2026. Đối chiếu checkpoint Phase 3 đang được yêu cầu với
tasks/todo.md, requirement, ADR-0008–0010 và contract liên quan.
Không nhận implementation P3-L*, P3-N* hoặc P3-D* thay ba owner.
Không push hoặc deploy nếu tôi chưa yêu cầu.
```

AI phải đọc file này cùng tài liệu nguồn; không chỉ dựa vào lịch sử conversation.

## 2. Git branch workflow

- `main` là branch tích hợp chung.
- Mỗi task dùng branch riêng của owner, tạo từ `main`.
- Branch dùng prefix `thuandd/`, ví dụ `thuandd/docs-p3-t01-decisions`.
- Không code trực tiếp trên `main`.
- Khi task pass verification, commit nguyên tử và merge vào `main`; chỉ push khi người dùng yêu cầu riêng.
- Duyệt checkpoint trên `main`; Phase 2 hiện tại dừng ở local qualification E2E/runbook.
- `develop` là nhánh legacy, không dùng để tạo branch, nhận PR hoặc deploy.

```bash
git switch main
git status --short --branch
git switch -c thuandd/feat-p2-t17a-web-workspace
```

Nếu `origin/main` chưa tồn tại hoặc working tree đang có thay đổi của người khác, dừng và báo blocker; không tự reset. Trước PR, đồng bộ lại `main`, chạy verification và GitNexus `detect-changes`.

## 3. Trách nhiệm

- `P1-T01` đã hoàn tất; bảo vệ các contract/ADR đã khóa khỏi thay đổi không được review.
- Xác nhận contract/checkpoint và xử lý mâu thuẫn giữa các tài liệu.
- `P2-T01`–`P2-T29` đã hoàn tất; không còn task implementation Phase 2 local đang mở. Kiểm tra clean checkout và xác nhận Checkpoint `P2-B` là bước cuối.
- Dùng [Solution Architecture Phase 2](../architecture/solution-architecture-phase-2.md), [SAD OCI Bot Submission](../architecture/sad-oci-bot-submissions.md), ADR-0005 và ADR-0006 làm ranh giới thực thi; `P2-T15` là cổng benchmark resource profile trước khi mở nhận bot của đội thi.
- Phase 2 local và Checkpoint `P2-B` đã hoàn tất sau detached clean-worktree verification; deploy cloud bị loại khỏi phạm vi.
- Không thêm CI/CD, cloud infrastructure, production secrets hoặc deploy stage vào Phase 2 hiện tại.
- `P3-T01` đã hoàn tất; implementation `P3-L*`, `P3-N*`, `P3-D*` thuộc Long, Nguyên và Đạt.
- Phân công hiện tại ngày 15/10/2026: Long nhận `P3-L01`, Nguyên nhận `P3-N01`; Đạt đã hoàn tất
  `P3-D01`/`P3-D04` và xếp hàng `P3-D02` sau `P3-A`. Thuận chưa duyệt `P3-A` cho đến khi `P3-L01`,
  `P3-D01`, `P3-N01` có đủ fresh verification evidence.
- D-14–D-30 đã duyệt. Thuận review amendment và các checkpoint `P3-A`–`P3-F`; không tick bằng báo cáo chưa có verification.
- Dùng [Solution Architecture Phase 3](../architecture/solution-architecture-phase-3.md), ADR-0008–0010 và contract Phase 3 làm baseline review.

## 4. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task/checkpoint liên quan trong `tasks/todo.md`.
4. `tasks/plan.md`.
5. `docs/tai-lieu-yeu-cau.md`, ưu tiên phần yêu cầu đang cần quyết định.
6. `docs/team-assignment.md`.
7. `docs/architecture/solution-architecture-phase-2.md` khi làm Phase 2.
8. `docs/architecture/solution-architecture-phase-3.md` khi review Phase 3.
9. `docs/decisions/`, `docs/contracts/` và `docs/huong-dan-tham-gia-du-an-voi-ai.md`.
10. `git status --short` và source/test liên quan nếu đang review bàn giao.

Nếu có mâu thuẫn, AI phải nêu rõ hai nguồn và đề xuất lựa chọn; không tự chọn âm thầm.

## 5. Task và điều kiện bắt đầu

| Công việc | Điều kiện |
| --- | --- |
| `P1-T01` — khóa quyết định Phase 1 | Đã hoàn tất ngày 09/10/2026 |
| `P1-T02` — gộp workspace chung (thay `P1-D01` đã hủy) | Checkpoint `P1-B` đã hoàn tất; làm trước `P1-D09` |
| Duyệt Checkpoint `P1-A` | `P1-T01`, `P1-L01`–`P1-L04`, `P1-N01`, `P1-D02` đã hoàn tất |
| Duyệt Checkpoint `P1-B` | Long xong `P1-L05`–`P1-L08`, Nguyên xong `P1-N01`–`P1-N06`, Đạt xong `P1-D02`–`P1-D08` |
| Duyệt Checkpoint `P1-C` | `P1-D11` và full verification đã pass |
| `P2-T01` — khóa quyết định Phase 2 | `P1-D11` hoàn tất |
| `P2-T02`–`P2-T15` — backend local | Đã hoàn tất và Checkpoint `P2-A` đã đạt |
| `P2-T16` — rebaseline ownership/execution loop | Đã hoàn tất ngày 13/10/2026 |
| `P2-T17A`–`P2-T29` — frontend, replay, E2E local | Đã hoàn tất; không tạo task mới ngoài phạm vi đã duyệt |
| Duyệt Checkpoint `P2-B` | Đã hoàn tất; detached clean-worktree verification pass |
| `P3-T01` — khóa D-14–D-30, ADR và contract | Đã hoàn tất ngày 14/10/2026 |
| Theo dõi Wave 1 | `P3-D01` đã hoàn tất; `P3-L01` giao Long và `P3-N01` giao Nguyên ngày 15/10/2026 |
| Duyệt Checkpoint `P3-A` | Chờ `P3-L01` và `P3-N01` có fresh evidence; sau khi duyệt mới mở `P3-D02` và phần còn lại của Wave 2 |
| Duyệt `P3-A`–`P3-2B` | Chỉ sau task/checkpoint dependency có fresh test/build/security evidence |
| Duyệt `P3-F1` và `P3-F` | Chỉ sau `P3-2B`, LAN recovery/signed bundle rehearsal và docs sync |

Sơ đồ ba phase: `docs/team-assignment.md` mục 4.2. Sau khi duyệt task hoặc checkpoint, thêm `✅` vào node tương ứng trong sơ đồ.

Deploy cloud không thuộc checklist hoặc Definition of Done Phase 2. AI không tự tạo task cloud trong vòng lặp này.

## 6. Quyết định đã khóa tại P1-T01

- Cách dùng core tham chiếu: chỉ đối chiếu behavior tại commit đã pin, không sao chép source khi chưa có license.
- Package manager và workspace layout.
- Python version và entrypoint chuẩn.
- `STATE_UPDATE` có gửi `legalActions` hay không.
- Giới hạn message, stdout và stderr.
- Timeout, ngưỡng lỗi và crash/forfeit semantics.
- Nơi ghi quyết định: ADR hoặc tài liệu contract phù hợp.

Đầu ra phải đủ rõ để Long, Nguyên và Đạt code mà không tạo ba cách hiểu khác nhau.

Các quyết định Phase 2 không được lẫn vào Phase 1. D-13 authentication/RBAC đã khóa tại ADR-0004: BTC provision tài khoản team username/password, không self-register. `P2-T01` đã khóa runtime image/artifact policy, baseline CPU/RAM/PID, K-factor/rating khởi tạo và series đổi phía. Mọi thay đổi tương ứng trong Phase 3 phải đi qua `P3-T01`, không sửa ngược contract Phase 2 âm thầm.

## 7. Skill cần dùng và bước cài nếu thiếu

Skill khuyến nghị:

- `context-engineering`
- `planning-and-task-breakdown`
- `documentation-and-adrs`
- `frontend-ui-engineering` cho `P2-T17A`–`P2-T22` và `P2-T25`–`P2-T27`
- `browser-testing-with-devtools` khi verification yêu cầu browser thật
- `observability-and-instrumentation`
- `security-and-hardening`
- `code-review-and-quality`

Kiểm tra skill trong repo:

```bash
for skill in context-engineering planning-and-task-breakdown documentation-and-adrs frontend-ui-engineering browser-testing-with-devtools observability-and-instrumentation security-and-hardening code-review-and-quality; do
  test -f ".agents/skills/$skill/SKILL.md" || echo "MISSING: $skill"
done
test -f .claude/skills/gitnexus-impact-analysis/SKILL.md || echo "MISSING: gitnexus-impact-analysis"
```

Nếu không có dòng `MISSING`, không cần cài. Khởi động lại phiên AI để công cụ nhận project skills nếu cần.

Nếu dùng Codex và skill thật sự thiếu, gửi:

```text
$skill-installer cài các skill còn thiếu từ repository addyosmani/agent-skills,
đường dẫn skills/<ten-skill>/SKILL.md. Sau khi cài xong, báo tôi mở phiên mới.
```

Nếu AI không hỗ trợ installer nhưng file có trong `.agents/skills/`, yêu cầu AI đọc trực tiếp `SKILL.md` tương ứng và tuân theo workflow. Không tự tải skill từ nguồn không rõ.

## 8. Prompt điều hành sẵn dùng

```text
Tôi là Đinh Đức Thuận, approver decision/checkpoint của Phase 3.

Hãy:
1. Đọc rules, tasks/plan.md, tasks/todo.md và các tài liệu liên quan.
2. Kiểm tra git status; giữ nguyên thay đổi không thuộc công việc hiện tại.
3. Xác nhận branch `thuandd/feat-<task-id>-<slug>` tạo từ main; không làm trực tiếp trên main.
4. Chỉ xử lý amendment quyết định hoặc một checkpoint Phase 3 đã đủ dependency; không nhận implementation của ba lane còn lại.
5. Dùng baseline D-14–D-30 đã duyệt; nếu yêu cầu mới làm đổi baseline, tạo decision amendment và đồng bộ ADR/contract.
6. Nếu là checkpoint, đối chiếu từng acceptance criterion với bằng chứng test/build thực tế.
7. Dùng GitNexus trước khi sửa file hiện có và detect-changes trước khi đề xuất commit.
8. Không tự duyệt thay đổi nghiệp vụ mới và không sửa code implementation để né mâu thuẫn requirement–ADR–contract.
9. Sau khi amendment được tôi xác nhận, đồng bộ requirement, ADR, contract, SA, plan/task và diagram trong cùng branch.
10. Không push, merge hoặc deploy nếu chưa được yêu cầu; nêu rõ task nào được unblock sau mỗi lần duyệt.

Trước khi sửa, hãy trả về task đã chọn, dependency, assumption, file dự kiến sửa và verification plan.
```

## 9. Không được làm

- Không thay đổi luật game hoặc Bot Protocol thay Long.
- Không thay đổi Phase 1 core/protocol/bot/MatchRunner ngoài dependency cần thiết và đã được impact-review.
- Không đưa secret hoặc cấu hình production vào repository.
- Không thêm hoặc thực hiện deploy cloud trong Phase 2 hiện tại.
- Không nhận hoặc code thay các task `P3-L*`, `P3-N*`, `P3-D*`; Thuận chỉ quyết định, review và duyệt checkpoint.
- Không coi SA/plan là bằng chứng implementation; task chỉ hoàn tất sau fresh verification.
- Không duyệt checkpoint chỉ dựa trên báo cáo của AI; phải có command và output thực tế.

## 10. Definition of Done và handoff

Một quyết định/checkpoint chỉ hoàn tất khi:

- Có văn bản ghi lại quyết định và lý do.
- Owner bị ảnh hưởng đã review.
- Acceptance criteria có bằng chứng.
- GitNexus impact/detect-changes đã được xử lý.
- Ghi rõ task nào được phép bắt đầu tiếp theo.
- `tasks/todo.md` và diagram được cập nhật ngay khi task/checkpoint có đủ bằng chứng; không tick trước verification.

AI phải kết thúc bằng:

```text
TASK/CHECKPOINT:
STATUS: done | partial | blocked
DECISIONS:
EVIDENCE:
FILES CHANGED:
COMMANDS AND RESULTS:
RISKS:
DOCS UPDATED:
NEXT UNBLOCKED TASKS:
GIT STATUS: committed | uncommitted
```
