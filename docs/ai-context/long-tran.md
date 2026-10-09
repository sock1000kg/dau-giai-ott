# AI Context Pack — Long Trần

> Trạng thái: **Đã tự động duyệt**
> Mức khuyến nghị: **HIGH RECOMMEND**
> Vai trò: Core Game API và owner Bot Protocol v1

## 1. Cách dùng ngay

Mở AI tại repository root, đính kèm file này và gửi:

```text
Đọc toàn bộ file docs/ai-context/long-tran.md và dùng nó làm context triển khai.
Từ tasks/todo.md, chọn task đầu tiên của Long Trần đã đủ dependency và chỉ làm task đó.
Nếu chưa đủ dependency, dừng và báo chính xác task nào đang chặn.
Không commit, push hoặc sửa phạm vi của người khác nếu tôi chưa yêu cầu.
```

## 2. Git branch workflow

- Base branch: `develop`.
- Mỗi task dùng branch riêng với prefix `longt/`, ví dụ `longt/feat-p1-l01-game-baseline`.
- Không code trực tiếp trên `main` hoặc `develop`.
- Một branch chỉ chứa một task `P1-Lxx`; không trộn core/protocol task khác.
- Hoàn tất thì push branch và tạo PR target `develop` để integration test.

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c longt/feat-p1-l01-game-baseline
```

Thay task ID/slug theo task đang làm. Nếu `origin/develop` chưa có hoặc working tree bẩn do người khác, dừng và báo blocker. Không force-push branch chung và không merge thẳng vào `main`.

## 3. Kết quả cần tạo ra

Triển khai lại behavior Human-vs-Human tham chiếu thành API thuần để bot điều khiển, với một bộ game rules duy nhất. Không sao chép source từ repository tham chiếu vì chưa có license. Đồng thời hiện thực và duy trì Bot Protocol v1 đã khóa để Nguyên và Đạt phát triển độc lập bằng schema/fixtures.

Long là owner duy nhất của:

- Core game và public Engine API.
- Domain types, action/result/error semantics.
- Bot Protocol v1, runtime validator, schema và fixtures.
- Deterministic transition event và `finalStateHash`.
- Regression test bảo vệ Human-vs-Human.

## 4. Task theo thứ tự bắt buộc

| Thứ tự | Task | Dependency |
| --- | --- | --- |
| 1 | `P1-L01` — triển khai behavior baseline | `P1-T01` |
| 2 | `P1-L02` — Engine API/domain types | `P1-L01` |
| 3 | `P1-L03` — Bot Protocol v1 | `P1-L02` |
| 4 | `P1-L04` — validator/contract tests dùng schema/fixtures chuẩn | `P1-L03` |
| 5 | `P1-L05` — side/action API | `P1-L04` |
| 6 | `P1-L06` — skip/maxTurns/result | `P1-L05` |
| 7 | `P1-L07` — events/finalStateHash | `P1-L06` |
| 8 | `P1-L08` — regression/docs | `P1-L07` |

Mỗi phiên AI chỉ làm một task. Nguyên đã có thể làm `P1-N01` từ schema/fixtures khóa tại `P1-T01`; Đạt bắt đầu `P1-D02` khi `P1-L02` và `P1-L03` hoàn tất. `P1-L04` là executable validator baseline, không phải thời điểm phát hành contract lần đầu.

Checkpoint liên quan: `P1-A` sau `P1-L01`–`P1-L04` (Đạt dựa vào public types để làm runner); `P1-B` sau `P1-L08`. Phase 2 hiện không có task của Long. Sơ đồ hai phase: `docs/team-assignment-phase-1-2.md` mục 4.2.

## 5. Tài liệu AI phải đọc

1. `AGENTS.md` hoặc `CLAUDE.md`.
2. `docs/README.md` để xác định nguồn sự thật.
3. Task đang chọn trong `tasks/todo.md`.
4. Lane Long và checkpoint `P1-A/P1-B` trong `tasks/plan.md`.
5. Phần Core Game/Bot Protocol trong `docs/team-assignment-phase-1-2.md`.
6. Phần game rules, protocol, determinism và error policy trong `docs/tai-lieu-yeu-cau.md`.
7. ADR và contract liên quan.
8. `docs/conventions/module-package.md` khi tạo hoặc sửa `package.json` của `game-core`/`bot-protocol`.
9. Source core, public types và test liên quan trước khi sửa.

Hành vi tham chiếu phải được đối chiếu với commit core đã pin. Không tự “cải tiến luật” ngoài tài liệu.

## 6. Ranh giới bắt buộc

Được sửa:

- `src/game-core/**`
- `src/bot-protocol/**`
- Tài liệu protocol/core liên quan

Không được sửa nếu chưa phối hợp owner:

- `src/bots/python/**` của Nguyên.
- `src/match-runner/**` của Đạt.
- Fastify, PostgreSQL, Redis/BullMQ, MinIO, React/Vite hoặc cloud.

Nếu test của consumer phát hiện contract sai, sửa tại core/protocol và cập nhật schema/fixtures; không vá trực tiếp code consumer.

## 7. Skill cần dùng và bước cài nếu thiếu

Skill khuyến nghị:

- `context-engineering`
- `api-and-interface-design`
- `spec-driven-development`
- `constraint-driven-development`
- `incremental-implementation`
- `test-driven-development`
- `code-review-and-quality`
- `verification-before-completion`

Kiểm tra:

```bash
for skill in context-engineering api-and-interface-design spec-driven-development constraint-driven-development incremental-implementation test-driven-development code-review-and-quality; do
  test -f ".agents/skills/$skill/SKILL.md" || echo "MISSING: $skill"
done
test -f .claude/skills/gitnexus-impact-analysis/SKILL.md || echo "MISSING: gitnexus-impact-analysis"
```

`verification-before-completion` có thể là skill global của AI. Nếu không có, vẫn phải thực hiện verification command trong task và ghi output thật.

Nếu dùng Codex và skill thiếu:

```text
$skill-installer cài từ addyosmani/agent-skills các path:
skills/api-and-interface-design,
skills/spec-driven-development,
skills/constraint-driven-development,
skills/incremental-implementation,
skills/test-driven-development,
skills/code-review-and-quality.
Sau khi cài, báo tôi mở phiên mới.
```

Nếu project đã có `.agents/skills/<skill>/SKILL.md`, ưu tiên dùng bản đã pin trong repo thay vì cài phiên bản mới.

## 8. Prompt triển khai sẵn dùng

```text
Tôi là Long Trần, owner Core Game API và Bot Protocol v1.

Hãy chọn task P1-Lxx đầu tiên chưa hoàn tất và đã đủ dependency trong tasks/todo.md.
Chỉ thực hiện đúng một task.

Quy trình bắt buộc:
1. Đọc rules, task card, requirement/assignment section và code/test liên quan.
2. Xác nhận branch `longt/feat-<task-id>-<slug>` được tạo từ develop; không làm trên main/develop.
3. Dùng GitNexus context/impact trước khi sửa symbol hoặc file hiện có.
4. Nêu invariant, public contract và behavior phải giữ tương thích.
5. Viết test thất bại trước hoặc cùng lúc với thay đổi hành vi.
6. Triển khai tối thiểu, không tạo game rules thứ hai cho bot.
7. Chạy focused test, typecheck và verification command của task.
8. Review diff, chạy GitNexus detect-changes và báo risk thực tế.
9. Không sửa bot Python, MatchRunner, platform hoặc cloud.
10. Chỉ đề xuất PR vào develop; không merge/commit nếu tôi chưa yêu cầu.

Trước khi code, trả về: task được chọn, dependency, assumption, public API bị ảnh hưởng, file dự kiến sửa và test plan.
```

## 9. Definition of Done

- Acceptance criteria của task đã đạt.
- Game rules vẫn có một nguồn sự thật.
- Public types/schema/fixtures/docs đồng nhất.
- Behavior/API/schema thay đổi phải cập nhật contract, README hoặc ADR liên quan trong cùng branch; không hoãn docs sang task sau.
- Test phủ happy path, validation và lỗi chính.
- Determinism được giữ; không thêm timestamp/random không kiểm soát.
- Human-vs-Human regression không hỏng.
- Không sửa file thuộc Nguyên/Đạt.
- Verification và GitNexus evidence được ghi trong handoff.

AI phải kết thúc bằng:

```text
TASK:
STATUS: done | partial | blocked
PUBLIC CONTRACT CHANGED:
FILES CHANGED:
TESTS/TYPECHECK/BUILD:
GITNEXUS RISK:
COMPATIBILITY NOTES:
DOCS UPDATED:
OPEN QUESTIONS:
NEXT TASK:
GIT STATUS: committed | uncommitted
```
