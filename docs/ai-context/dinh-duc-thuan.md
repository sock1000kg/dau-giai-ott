# AI Context Pack — Đinh Đức Thuận

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: quyết định chung, kiểm soát checkpoint, tiếp nhận local và DevOps/cloud

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi đúng câu sau:

```text
Đọc toàn bộ file docs/ai-context/dinh-duc-thuan.md và dùng nó làm context điều hành.
Hãy kiểm tra repository, chọn task đầu tiên của tôi đã đủ dependency và bắt đầu theo workflow trong file.
Nếu chưa đủ dependency hoặc gặp quyết định chưa được chốt, dừng và báo blocker cụ thể.
Không commit, push, merge hoặc deploy nếu tôi chưa yêu cầu.
```

AI phải đọc file này cùng tài liệu nguồn; không chỉ dựa vào lịch sử conversation.

## 2. Git branch workflow

- Khởi tạo: merge branch tài liệu hiện tại vào `main`, tạo `develop` từ `main` mới và push `origin/develop` trước khi nhóm mở branch cá nhân.
- Branch tích hợp chung và nguồn deploy: `develop`.
- Mỗi task dùng branch riêng của owner, tạo từ `develop`.
- Branch dùng prefix `thuandd/`, ví dụ task tiếp theo `thuandd/feat-p2-t01-decisions`.
- Không code trực tiếp trên `main` hoặc `develop`.
- Khi task pass verification, push branch cá nhân và tạo PR vào `develop`.
- Duyệt checkpoint trên `develop`; sau khi hoàn thiện, deploy từ `develop` (branch có code mới nhất) lên các môi trường.
- `main` không theo kịp `develop` trong lúc phát triển; về sau merge `develop` vào `main` khi quyết định.

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c thuandd/feat-p2-t01-decisions
```

Nếu `origin/develop` chưa tồn tại hoặc working tree đang có thay đổi của người khác, dừng và báo blocker; không tự reset. Trước PR, đồng bộ lại `develop`, chạy verification và GitNexus `detect-changes`.

## 3. Trách nhiệm

- `P1-T01` đã hoàn tất; bảo vệ các contract/ADR đã khóa khỏi thay đổi không được review.
- Xác nhận contract/checkpoint và xử lý mâu thuẫn giữa các tài liệu.
- Hoàn tất `P2-T01` trước các task Phase 2 cần auth, quota, series hoặc Elo policy.
- Nhận bàn giao Phase 1 và Phase 2 chạy trên local.
- Lập kế hoạch CI/CD và local → cloud sau khi local đạt Definition of Done.
- Không thay Long, Nguyên hoặc Đạt triển khai feature thuộc lane của họ.

## 4. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task/checkpoint liên quan trong `tasks/todo.md`.
4. `tasks/plan.md`.
5. `docs/tai-lieu-yeu-cau.md`, ưu tiên phần yêu cầu đang cần quyết định.
6. `docs/team-assignment-phase-1-2.md`.
7. `docs/decisions/` và `docs/huong-dan-tham-gia-du-an-voi-ai.md`.
8. `git status --short` và source/test liên quan nếu đang review bàn giao.

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
| Duyệt Checkpoint `P2-A` | `P2-T01`, `P2-D01`–`P2-D10` và `P2-N01` hoàn tất |
| Duyệt Checkpoint `P2-B`, nhận bàn giao Phase 2 local | `P2-D13` và qualification E2E đã pass |
| Deploy từ `develop` lên các môi trường | Sau Checkpoint `P2-B` |
| Thiết kế CI/CD và cloud | Chỉ sau khi local contract/runbook được bàn giao |

Sơ đồ hai phase: `docs/team-assignment-phase-1-2.md` mục 4.2. Sau khi duyệt task hoặc checkpoint, thêm `✅` vào node tương ứng trong sơ đồ.

Các task DevOps/cloud chưa nằm trong checklist hiện tại. AI phải lập plan riêng trước khi triển khai, không tự thêm cloud vào task local.

## 6. Quyết định đã khóa tại P1-T01

- Cách dùng core tham chiếu: chỉ đối chiếu behavior tại commit đã pin, không sao chép source khi chưa có license.
- Package manager và workspace layout.
- Python version và entrypoint chuẩn.
- `STATE_UPDATE` có gửi `legalActions` hay không.
- Giới hạn message, stdout và stderr.
- Timeout, ngưỡng lỗi và crash/forfeit semantics.
- Nơi ghi quyết định: ADR hoặc tài liệu contract phù hợp.

Đầu ra phải đủ rõ để Long, Nguyên và Đạt code mà không tạo ba cách hiểu khác nhau.

Các quyết định còn mở của Phase 2 không được lẫn vào Phase 1. `P2-T01` phải khóa authentication/RBAC, runtime image/artifact policy, CPU/RAM/PID quota, K-factor/rating khởi tạo và series đổi phía trước các task phụ thuộc.

## 7. Skill cần dùng và bước cài nếu thiếu

Skill khuyến nghị:

- `context-engineering`
- `planning-and-task-breakdown`
- `documentation-and-adrs`
- `ci-cd-and-automation`
- `observability-and-instrumentation`
- `security-and-hardening`
- `shipping-and-launch`
- `code-review-and-quality`

Kiểm tra skill trong repo:

```bash
for skill in context-engineering planning-and-task-breakdown documentation-and-adrs ci-cd-and-automation observability-and-instrumentation security-and-hardening shipping-and-launch code-review-and-quality; do
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
Tôi là Đinh Đức Thuận, owner quyết định chung và bàn giao DevOps của dự án.

Hãy:
1. Đọc rules, tasks/plan.md, tasks/todo.md và các tài liệu liên quan.
2. Kiểm tra git status; giữ nguyên thay đổi không thuộc công việc hiện tại.
3. Xác nhận branch `thuandd/feat-<task-id>-<slug>` tạo từ develop; không làm trực tiếp trên main/develop.
4. Chọn đúng một task/checkpoint của tôi đã đủ dependency.
5. Nếu là decision gate như P2-T01, lập bảng: quyết định, lựa chọn, khuyến nghị, lý do, ảnh hưởng và nơi ghi nhận.
6. Nếu là checkpoint, đối chiếu từng acceptance criterion với bằng chứng test/build thực tế.
7. Dùng GitNexus trước khi sửa file hiện có và detect-changes trước khi đề xuất commit.
8. Không triển khai feature của Long, Nguyên hoặc Đạt.
9. Không commit, merge hoặc deploy khi chưa được yêu cầu.

Trước khi sửa, hãy trả về task đã chọn, dependency, assumption, file dự kiến sửa và verification plan.
```

## 9. Không được làm

- Không thay đổi luật game hoặc Bot Protocol thay Long.
- Không sửa bot test thay Nguyên hoặc MatchRunner/platform thay Đạt.
- Không đưa secret hoặc cấu hình production vào repository.
- Không deploy từ branch khác `develop` hoặc từ `develop` chưa qua checkpoint.
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
