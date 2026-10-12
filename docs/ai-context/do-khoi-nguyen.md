# AI Context Pack — Đỗ Khôi Nguyên

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: bot Python hợp lệ, bot lỗi và contract tests phía bot

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi:

```text
Đọc toàn bộ file docs/ai-context/do-khoi-nguyen.md và dùng nó làm context triển khai.
Từ tasks/todo.md, chọn task đầu tiên của Đỗ Khôi Nguyên đã đủ dependency và chỉ làm task đó.
Nếu Bot Protocol/schema/fixtures chưa khóa hoặc dependency chưa đủ, dừng và báo blocker.
Không commit, push hoặc sửa core/runner nếu tôi chưa yêu cầu.
```

## 2. Git branch workflow

- Base branch: `main`.
- Mỗi task dùng branch riêng với prefix `nguyendk/`, ví dụ `nguyendk/feat-p1-n01-bot-sdk`.
- Không code trực tiếp trên `main`.
- Một branch chỉ chứa một task `P1-Nxx`; Phase 2 thuộc Thuận.
- Hoàn tất thì push branch và tạo PR target `main` để chạy contract/integration tests.

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c nguyendk/feat-p1-n01-bot-sdk
```

Nếu `origin/main` chưa có hoặc working tree có thay đổi chưa rõ owner, dừng và báo blocker. Không sửa branch của Long/Đạt và không merge trực tiếp vào `main`.

## 3. Kết quả cần tạo ra

Tạo các bot Python làm consumer độc lập của Bot Protocol v1:

- Bot hợp lệ để chạy happy path.
- Bot có chiến thuật đơn giản nhưng deterministic.
- Bot cố ý gửi dữ liệu sai để kiểm tra validation/error handling.
- Process fixtures cho timeout, crash và output vượt giới hạn.
- Contract tests và hướng dẫn chạy bot.

Bot phải hoạt động từ schema/fixtures của Long, không được import implementation TypeScript của core hoặc runner.

## 4. Task theo thứ tự và nhánh song song

| Task | Dependency |
| --- | --- |
| `P1-N01` — Python Bot SDK | `P1-T01` |
| `P1-N02` — FirstLegalBot | `P1-N01` |
| `P1-N03` — CaptureFirstBot | `P1-N01` |
| `P1-N04` — malformed/illegal/stale bot | `P1-N01` |
| `P1-N05` — timeout/crash/oversize bot | `P1-N01` |
| `P1-N06` — contract test/README | `P1-N02`–`P1-N05` |

Sau `P1-N01`, các task `P1-N02`–`P1-N05` độc lập về logic nhưng một người chỉ nên làm từng task/phiên để tránh trộn diff.

Checkpoint liên quan: `P1-A` sau `P1-N01`; `P1-B` sau `P1-N06`. Bot của Nguyên được dùng trong `P1-D10` (E2E). Toàn bộ Phase 2, gồm các ID cũ `P2-N14`/`P2-N15`, đã chuyển cho Thuận. Sơ đồ hai phase: `docs/team-assignment-phase-1-2.md` mục 4.2.

## 5. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task đang chọn trong `tasks/todo.md`.
4. Bot Protocol v1, JSON Schema và fixtures do Long phát hành.
5. Lane Nguyên trong `docs/team-assignment-phase-1-2.md`.
6. Error/timeout/sandbox requirements liên quan trong `docs/tai-lieu-yeu-cau.md`.
7. `tasks/plan.md` để kiểm tra checkpoint/dependency.
8. Python bot/test hiện có trước khi sửa.

Nếu schema và tài liệu protocol khác nhau, không tự chọn. Tạo test case tái hiện và chuyển lại Long xử lý.

## 6. Ranh giới bắt buộc

Được sửa:

- `src/bots/python/**`
- README/test fixtures thuộc bot

Không được sửa:

- `src/game-core/**`
- `src/bot-protocol/**` nếu chưa có yêu cầu từ Long
- `src/match-runner/**`
- Toàn bộ `src/platform/**` và phạm vi Phase 2 của Thuận

Bot không tự tính lại game rules. Nếu `STATE_UPDATE` có `legalActions`, bot chọn từ danh sách đó theo contract.

## 7. Skill cần dùng và bước cài nếu thiếu

Skill khuyến nghị:

- `context-engineering`
- `incremental-implementation`
- `test-driven-development`
- `debugging-and-error-recovery`
- `security-and-hardening`
- `code-review-and-quality`
- `verification-before-completion`

Kiểm tra:

```bash
for skill in context-engineering incremental-implementation test-driven-development debugging-and-error-recovery security-and-hardening code-review-and-quality; do
  test -f ".agents/skills/$skill/SKILL.md" || echo "MISSING: $skill"
done
test -f .claude/skills/gitnexus-impact-analysis/SKILL.md || echo "MISSING: gitnexus-impact-analysis"
```

Nếu dùng Codex và skill thiếu:

```text
$skill-installer cài từ addyosmani/agent-skills các path:
skills/incremental-implementation,
skills/test-driven-development,
skills/debugging-and-error-recovery,
skills/security-and-hardening,
skills/code-review-and-quality.
Sau khi cài, báo tôi mở phiên mới.
```

Nếu skill có sẵn trong `.agents/skills`, dùng bản trong repo. Nếu AI không hỗ trợ skill, yêu cầu nó đọc file `SKILL.md` tương ứng và thực hiện đúng workflow.

## 8. Prompt triển khai sẵn dùng

```text
Tôi là Đỗ Khôi Nguyên, owner bot Python/contract tests Phase 1.

Hãy chọn task P1-Nxx đầu tiên chưa hoàn tất và đã đủ dependency.
Chỉ thực hiện đúng một task.

Quy trình bắt buộc:
1. Đọc rules, task card, Bot Protocol schema/fixtures và Python code/test liên quan.
2. Xác nhận branch `nguyendk/feat-<task-id>-<slug>` được tạo từ main; không làm trực tiếp trên main.
3. Kiểm tra protocol/schema đã khóa; nếu chưa, báo blocked và không invent message fields.
4. Dùng GitNexus impact trước khi sửa file hiện có.
5. Viết unittest cho behavior hoặc fault mode trước/cùng implementation.
6. Với bot giữ stdout chỉ có NDJSON protocol.
7. Không import hoặc sửa core TypeScript/MatchRunner/API server.
8. Không chạy payload network/fork/CPU/memory nguy hiểm ngoài sandbox/harness đã giới hạn.
9. Chạy verification command của task và toàn bộ bot contract tests liên quan.
10. Review diff, chạy detect-changes và chỉ đề xuất PR vào main.

Trước khi code, trả về: task, dependency, fixture/schema sẽ dùng, file dự kiến sửa, test cases và safety notes.
```

## 9. Definition of Done

- Bot đọc stdin từng dòng, ghi stdout đúng NDJSON và flush đúng lúc.
- Không có debug/banner trên stdout.
- Happy bot deterministic và thoát sạch.
- Mỗi fault bot chỉ gây đúng lỗi mục tiêu.
- Tests chạy từ repository root bằng command trong task.
- Không sửa core/protocol/runner.
- Payload nguy hiểm không được chạy trực tiếp trên host.
- Có README cách chạy và handoff evidence.
- Khi thay đổi entrypoint, I/O, fault mode hoặc lệnh test, cập nhật README/fixtures liên quan trong cùng branch.

AI phải kết thúc bằng:

```text
TASK:
STATUS: done | partial | blocked
BOT/Fault MODE:
FILES CHANGED:
TEST COMMANDS AND RESULTS:
PROTOCOL FIXTURES USED:
SAFETY NOTES:
DOCS UPDATED:
GITNEXUS RISK:
NEXT TASK:
GIT STATUS: committed | uncommitted
```
