# AI Context Pack — Phạm Tất Đạt

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: MatchRunner Phase 1; Phase 3 control plane, privileged workflow và finals sync

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi:

```text
Đọc toàn bộ file docs/ai-context/pham-tat-dat.md và dùng nó làm context triển khai.
Từ tasks/todo.md, chọn task đầu tiên của Phạm Tất Đạt đã đủ dependency và chỉ làm task đó.
Nếu dependency chưa đủ, dừng và báo blocker; không tạo contract thay Long.
Không commit, push, deploy hoặc sửa game rules/bot strategy nếu tôi chưa yêu cầu.
```

## 2. Git branch workflow

- Base branch: `main`.
- Mỗi task dùng branch riêng với prefix `datpt/`, ví dụ `datpt/feat-p1-d02-ports`.
- Không code trực tiếp trên `main`.
- Một branch chỉ chứa một task `P1-Dxx` hoặc `P3-Dxx`; Phase 2 thuộc Thuận.
- Hoàn tất thì push branch và tạo PR target `main` để chạy integration/E2E.

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c datpt/feat-p1-d02-ports
```

Nếu `origin/main` chưa có hoặc working tree chứa thay đổi của người khác, dừng và báo blocker. Không force-push branch chung và không merge trực tiếp vào `main`.

## 3. Kết quả cần tạo ra

Phase 1:

- `GamePort`, `BotPort`, fakes và MatchRunner authoritative.
- BotProcess giao tiếp NDJSON, timeout và cleanup an toàn.
- Event log, replay verifier, CLI và E2E local.
- Adapter tích hợp core thật và hai bot Python thật.

Phase 2 local không còn task implementation của Đạt; `P2-D13`–`P2-D16` đã hủy và phát hành lại thành `P2-T23`–`P2-T29` cho Thuận.

Phase 3 giao Đạt `P3-D01`–`P3-D10`: round/control plane, admin/submission/account workflow, replay
authorization, auth hardening, privileged operations và finals/result sync/public UI. `P3-T01` đã hoàn tất;
`P3-D01` sẵn sàng.

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

Không chọn task `P2-Dxx`. Toàn bộ Phase 2 đã hoàn tất dưới lane `P2-T*` của Thuận. Đạt chỉ review contract tương thích với event log/replay verifier Phase 1 khi có yêu cầu cụ thể.

### Phase 3

| Thứ tự | Task | Dependency chính |
| --- | --- | --- |
| 1 | `P3-D01` — RoundRuleSet/lifecycle | `P3-T01` |
| 2 | `P3-D02` — admin round/operations console | `P3-D01` |
| 3 | `P3-D03` — upload reservation/backpressure | `P3-D01`, `P3-N02` |
| 4 | `P3-D04` — bulk team provisioning | `P3-T01` |
| 5 | `P3-D05` — qualification replay private từ dữ liệu đầu tiên | `P3-T01`, `P3-D01` |
| 6 | `P3-D06` — TOTP/network allowlist/hosted startup guard | `P3-T01`, `P3-D04` |
| 7 | `P3-D07` — privileged operations/cases | `P3-D01`, `P3-N02`, `P3-N04` |
| 8 | `P3-D08` — finals control/LAN cutoff | `P3-L06`, `P3-D01`, `P3-D03` |
| 9 | `P3-D09` — signed ResultBundle | `P3-D08`, `P3-N07` |
| 10 | `P3-D10` — finals bracket/verified public UI | `P3-D09`, `P3-L05`, `P3-L06` |

Checkpoint liên quan: Phase 1 có `P1-A`/`P1-B`/`P1-C`; Phase 3 có `P3-A`–`P3-2B`, `P3-F1` và `P3-F`. Đọc dependency/trạng thái hiện hành tại `tasks/todo.md`. Sơ đồ ba phase: `docs/team-assignment.md` mục 4.2.

## 5. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task đang chọn trong `tasks/todo.md`.
4. Lane Đạt và dependency graph trong `tasks/plan.md`.
5. Lane Đạt theo phase trong `docs/team-assignment.md`.
6. Section liên quan trong `docs/tai-lieu-yeu-cau.md`.
7. ADR liên quan, gồm ADR-0001, ADR-0003 và ADR-0004 nếu làm Phase 2.
8. Bot Protocol/schema/fixtures khi làm runner; job/result contract khi làm worker.
9. `docs/conventions/module-package.md` khi tạo hoặc sửa `package.json`, hoặc import `@ott/game-core`/`@ott/bot-protocol`.
10. `docs/architecture/solution-architecture-phase-3.md` khi làm `P3-D*`.
11. Source/test hiện có trước khi sửa.

## 6. Ranh giới bắt buộc

Được sửa theo task:

- Chỉ `package.json` của `src/match-runner`; workspace/config gốc (`P1-T02`) thuộc Thuận.
- `src/match-runner/**` trong Phase 1.
- Các file API/web/migration/contract được liệt kê trong đúng task card `P3-D*`.

Không được sửa:

- Game rules trong `src/game-core/**`.
- Bot Protocol/schema thuộc Long, trừ khi có review/ủy quyền rõ.
- Python bot strategy/fault bots thuộc Nguyên.
- Protocol/timing/rating/finals rules thuộc Long; worker/sandbox/ops/deploy thuộc Nguyên, trừ shared file được task/dependency review nêu rõ.
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
Tôi là Phạm Tất Đạt, owner lane `P3-D*` về control plane và finals sync.

Hãy chọn task `P3-Dxx` đầu tiên chưa hoàn tất và đã đủ dependency.
Chỉ thực hiện đúng một task, tối đa phạm vi file ghi trong task card.

Quy trình bắt buộc:
1. Đọc rules, task card, dependency contract và code/test liên quan.
2. Kiểm tra git status và xác nhận branch `datpt/feat-<task-id>-<slug>` tạo từ main; không làm trực tiếp trên main.
3. Dùng GitNexus context/impact trước khi sửa symbol/file hiện có.
4. Nếu decision/contract hoặc dependency chưa merge, báo blocked; không invent game rules/protocol/security policy.
5. Viết test trước hoặc cùng implementation; ưu tiên thin vertical slice.
6. Với privileged workflow: enforce server-side RBAC, audit, idempotency và secret handling theo task.
7. Không sửa protocol/rating/finals rules hoặc worker/deployment của owner khác; không commit secret.
8. Chạy verification command của task, typecheck/build liên quan và review diff.
9. Chạy GitNexus detect-changes; chỉ đề xuất PR vào main, không deploy.

Trước khi code, trả về: task, dependency, contract đầu vào, file dự kiến sửa, test plan và risk chính.
```

## 9. Definition of Done

- Acceptance criteria và verification command của task pass.
- Runner authoritative; bot chỉ đề xuất action.
- Process/timer/listener được cleanup; không còn open handle/PID.
- Không copy game rules vào runner/fake.
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
