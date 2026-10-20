# AI Context Pack — Đỗ Khôi Nguyên

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: bot Python Phase 1; Phase 3 sandbox, single-host worker và operations readiness

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi:

```text
Đọc toàn bộ file docs/ai-context/do-khoi-nguyen.md và dùng nó làm context triển khai.
Đọc trạng thái tại tasks/todo.md trước khi nhận việc mới; các task P3-N01–P3-N08 đã được tick tại main ngày 20/10.
Chỉ xử lý review/regression hoặc task mới được Thuận giao; rehearsal mô phỏng chưa thay thế nghiệm thu LAN thật.
Không commit, push hoặc sửa core/runner nếu tôi chưa yêu cầu.
```

## 2. Git branch workflow

- Base branch: `main`.
- Mỗi task dùng branch riêng với prefix `nguyendk/`, ví dụ `nguyendk/feat-p1-n01-bot-sdk`.
- Không code trực tiếp trên `main`.
- Một branch chỉ chứa một task `P1-Nxx` hoặc `P3-Nxx`; Phase 2 thuộc Thuận.
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

Phase 3 giao Nguyên `P3-N01`–`P3-N08`: resource enforcement/metrics, single-host worker, test run, OCI
lifecycle, observability/backup, server-lab load/recovery, LAN deployment và rehearsal. `P3-N01`–`P3-N08` đã được tick trên `main` ngày 2026-10-20; checkpoint Phase 3 còn mở.

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

### Phase 3

| Thứ tự | Task | Dependency chính |
| --- | --- | --- |
| 1 | `P3-N01` — resource profile/cgroup/metrics | `P3-T01` |
| 2 | `P3-N02` — priority queue/single-host adaptive admission | `P3-D01`, `P3-N01` |
| 3 | `P3-N03` — private test run | `P3-D01`, `P3-L02`, `P3-N02` |
| 4 | `P3-N04` — OCI lifecycle/dedup/retention | `P3-D03` |
| 5 | `P3-N05` — metrics/backup/incident runbook | `P3-N01`, `P3-N02`, `P3-D06` |
| 6 | `P3-N06` — lab-server smoke/load/recovery pilot | toàn bộ slice `P3-2B` theo task card |
| 7 | `P3-N07` — isolated finals LAN/recovery | `P3-D08`, `P3-N05` |
| 8 | `P3-N08` — full event rehearsal | `P3-D09`, `P3-D10`, `P3-N07` |

Checkpoint liên quan: Phase 1 có `P1-A`/`P1-B`; Phase 3 có `P3-A`–`P3-2B`, `P3-F1` và `P3-F`. Đọc dependency/trạng thái hiện hành tại `tasks/todo.md`. Sơ đồ ba phase: `docs/team-assignment.md` mục 4.2.

## 5. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task đang chọn trong `tasks/todo.md`.
4. Bot Protocol v1, JSON Schema và fixtures do Long phát hành.
5. Lane Nguyên theo phase trong `docs/team-assignment.md`.
6. Error/timeout/sandbox requirements liên quan trong `docs/tai-lieu-yeu-cau.md`.
7. `tasks/plan.md` để kiểm tra checkpoint/dependency.
8. `docs/architecture/solution-architecture-phase-3.md` khi làm `P3-N*`.
9. Source/test/runbook liên quan trước khi sửa.

Nếu schema và tài liệu protocol khác nhau, không tự chọn. Tạo test case tái hiện và chuyển lại Long xử lý.

## 6. Ranh giới bắt buộc

Được sửa:

- `src/bots/python/**`
- README/test fixtures thuộc bot
- Các file worker, ops, deployment, script và test được liệt kê trong đúng task card `P3-N*`.

Không được sửa:

- `src/game-core/**`
- `src/bot-protocol/**` nếu chưa có yêu cầu từ Long
- `src/match-runner/**` ngoài contract được task giao và Long review.
- Round/rating/finals rules, auth/admin write API và public site/snapshot endpoint thuộc lane Long/Đạt.

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
Tôi là Đỗ Khôi Nguyên, owner lane `P3-N*` về sandbox/worker/operations readiness.

Hãy chọn task `P3-Nxx` đầu tiên chưa hoàn tất và đã đủ dependency.
Chỉ thực hiện đúng một task.

Quy trình bắt buộc:
1. Đọc rules, task card, Bot Protocol schema/fixtures và Python code/test liên quan.
2. Xác nhận branch `nguyendk/feat-<task-id>-<slug>` được tạo từ main; không làm trực tiếp trên main.
3. `P3-T01` đã hoàn tất; kiểm tra contract/rule/job schema và dependency riêng của task đã merge, nếu chưa thì báo blocked và không invent field/policy.
4. Dùng GitNexus impact trước khi sửa file hiện có.
5. Viết unittest cho behavior hoặc fault mode trước/cùng implementation.
6. Với bot giữ stdout chỉ có NDJSON protocol.
7. Chỉ sửa file trong task card; không đổi game/rating/finals rules hoặc auth/admin API của owner khác.
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
