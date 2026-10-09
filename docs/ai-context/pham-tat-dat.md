# AI Context Pack — Phạm Tất Đạt

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: workspace, MatchRunner/BotProcess/CLI/E2E và platform Phase 2 local

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi:

```text
Đọc toàn bộ file docs/ai-context/pham-tat-dat.md và dùng nó làm context triển khai.
Từ tasks/todo.md, chọn task đầu tiên của Phạm Tất Đạt đã đủ dependency và chỉ làm task đó.
Nếu dependency chưa đủ, dừng và báo blocker; không tạo contract thay Long.
Không commit, push, deploy hoặc sửa game rules/bot strategy nếu tôi chưa yêu cầu.
```

## 2. Git branch workflow

- Base branch: `develop`.
- Mỗi task dùng branch riêng với prefix `datpt/`, ví dụ `datpt/feat-p1-d02-ports`.
- Không code trực tiếp trên `main` hoặc `develop`.
- Một branch chỉ chứa một task `P1-Dxx` hoặc `P2-Dxx`, đặc biệt không trộn schema/API/UI.
- Hoàn tất thì push branch và tạo PR target `develop` để chạy integration/E2E.

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c datpt/feat-p1-d02-ports
```

Nếu `origin/develop` chưa có hoặc working tree chứa thay đổi của người khác, dừng và báo blocker. Không force-push `develop` và không merge trực tiếp vào `main`.

## 3. Kết quả cần tạo ra

Phase 1:

- Workspace Node.js 22/TypeScript/Vitest.
- `GamePort`, `BotPort`, fakes và MatchRunner authoritative.
- BotProcess giao tiếp NDJSON, timeout và cleanup an toàn.
- Event log, replay verifier, CLI và E2E local.
- Adapter tích hợp core thật và hai bot Python thật.

Phase 2 local:

- Docker Compose cho PostgreSQL, Redis và MinIO.
- Fastify API, schema/migrations và submission storage.
- BullMQ worker, sandbox adapter, finalization, scheduling và Elo.
- React/Vite UI và qualification E2E.

Đạt không sở hữu game rules hoặc chiến thuật bot.

## 4. Task theo giai đoạn

### Phase 1

| Nhóm | Task |
| --- | --- |
| Runner độc lập | `P1-D02` sau `P1-L02`, `P1-L03`; sau đó `P1-D03`–`P1-D08` theo dependency |
| Integration | `P1-D09` sau `P1-L08`, `P1-D08` và `P1-T02` (Thuận) |
| E2E | `P1-D10` sau `P1-D09` và `P1-N06` |
| Handoff | `P1-D11` sau `P1-D10` |

### Phase 2 local

`P2-D01`–`P2-D13` theo đúng dependency trong `tasks/todo.md`. Không mở đồng thời nhiều task chạm cùng schema/module. `P2-D07` phải chờ `P2-N01` của Nguyên; các task policy-sensitive phải chờ `P2-T01` của Thuận.

Phase 2 đang dồn nhiều task cho Đạt; AI phải làm tuần tự từng task, không giả vờ tăng song song bằng nhiều branch trên cùng module.

## 5. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task đang chọn trong `tasks/todo.md`.
4. Lane Đạt và dependency graph trong `tasks/plan.md`.
5. Ranh giới MatchRunner/platform trong `docs/team-assignment-phase-1-2.md`.
6. Section liên quan trong `docs/tai-lieu-yeu-cau.md`.
7. ADR liên quan, gồm ADR-0001 và policy được tạo tại `P2-T01` nếu làm Phase 2.
8. Bot Protocol/schema/fixtures khi làm runner; job/result contract khi làm worker.
9. `docs/conventions/module-package.md` khi tạo hoặc sửa `package.json`, hoặc import `@ott/game-core`/`@ott/bot-protocol`.
10. Source/test hiện có trước khi sửa.

## 6. Ranh giới bắt buộc

Được sửa theo task:

- Chỉ `package.json` của `src/match-runner`; workspace/config gốc (`P1-T02`) thuộc Thuận.
- `src/match-runner/**` trong Phase 1.
- `infra/local/**`, `src/platform/api/**`, `src/platform/worker/**`, `src/platform/web/**` trong Phase 2, đúng task card.
- Integration/E2E và runbook thuộc phạm vi task.

Không được sửa:

- Game rules trong `src/game-core/**`.
- Bot Protocol/schema thuộc Long, trừ khi có review/ủy quyền rõ.
- Python bot strategy/fault bots thuộc Nguyên.
- Cấu hình cloud hoặc production secret.

Khi core chưa sẵn sàng, dùng `FakeGame`. Khi bot chưa sẵn sàng, dùng `ScriptedBot`. Không copy luật game vào fake.

## 7. Skill cần dùng và bước cài nếu thiếu

Skill chung:

- `context-engineering`
- `api-and-interface-design`
- `incremental-implementation`
- `test-driven-development`
- `security-and-hardening`
- `debugging-and-error-recovery`
- `code-review-and-quality`
- `verification-before-completion`

Skill theo task:

- React/Vite: `frontend-ui-engineering`, `browser-testing-with-devtools`.
- Queue/worker/sandbox: `security-and-hardening`, `observability-and-instrumentation`.
- Docker/automation: `ci-cd-and-automation` khi cần quality gates.

Kiểm tra:

```bash
for skill in context-engineering api-and-interface-design incremental-implementation test-driven-development security-and-hardening debugging-and-error-recovery code-review-and-quality frontend-ui-engineering browser-testing-with-devtools observability-and-instrumentation ci-cd-and-automation; do
  test -f ".agents/skills/$skill/SKILL.md" || echo "MISSING: $skill"
done
test -f .claude/skills/gitnexus-impact-analysis/SKILL.md || echo "MISSING: gitnexus-impact-analysis"
```

Nếu dùng Codex và skill thiếu:

```text
$skill-installer cài đúng skill còn thiếu từ repository addyosmani/agent-skills,
đường dẫn skills/<ten-skill>/SKILL.md. Chỉ cài skill cần cho task hiện tại.
Sau khi cài xong, báo tôi mở phiên mới.
```

Ưu tiên bản pin trong `.agents/skills`. Nếu AI không hỗ trợ installer, cho AI đọc trực tiếp `SKILL.md`; không tự chọn một skill cùng tên từ nguồn khác.

## 8. Prompt triển khai sẵn dùng

```text
Tôi là Phạm Tất Đạt, owner MatchRunner và platform local.

Hãy chọn task P1-Dxx hoặc P2-Dxx đầu tiên chưa hoàn tất và đã đủ dependency.
Chỉ thực hiện đúng một task, tối đa phạm vi file ghi trong task card.

Quy trình bắt buộc:
1. Đọc rules, task card, dependency contract và code/test liên quan.
2. Kiểm tra git status và xác nhận branch `datpt/feat-<task-id>-<slug>` tạo từ develop; không làm trên main/develop.
3. Dùng GitNexus context/impact trước khi sửa symbol/file hiện có.
4. Nếu core/bot thật chưa sẵn sàng, dùng ports/fakes; không invent game rules/protocol.
5. Viết test trước hoặc cùng implementation; ưu tiên thin vertical slice.
6. Với child process: timeout bằng server clock, cleanup trong finally, không dùng shell string.
7. Với Phase 2: chỉ dùng PostgreSQL/Redis/MinIO local qua Docker và không commit secret.
8. Chạy verification command của task, typecheck/build liên quan và review diff.
9. Chạy GitNexus detect-changes; chỉ đề xuất PR vào develop, không deploy.

Trước khi code, trả về: task, dependency, contract đầu vào, file dự kiến sửa, test plan và risk chính.
```

## 9. Definition of Done

- Acceptance criteria và verification command của task pass.
- Runner authoritative; bot chỉ đề xuất action.
- Process/timer/listener được cleanup; không còn open handle/PID.
- Không copy game rules vào runner/fake.
- Phase 2 có integration test với Docker services thật khi task yêu cầu.
- Retry/finalization quan trọng phải idempotent.
- Không có secret hoặc cloud config trong task local.
- Không sửa core hoặc bot của owner khác.
- Handoff có test/build/GitNexus evidence.
- API/config/command/process behavior thay đổi phải cập nhật README, runbook hoặc contract liên quan trong cùng branch.

AI phải kết thúc bằng:

```text
TASK:
STATUS: done | partial | blocked
DEPENDENCY CONTRACT USED:
FILES CHANGED:
TESTS/TYPECHECK/BUILD:
RUNTIME/PROCESS CHECK:
GITNEXUS RISK:
KNOWN LIMITATIONS:
DOCS UPDATED:
NEXT TASK:
GIT STATUS: committed | uncommitted
```
