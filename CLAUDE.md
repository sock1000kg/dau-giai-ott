<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dau-giai-ott** (8 symbols, 6 relationships, 0 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/dau-giai-ott/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dau-giai-ott/clusters` | All functional areas |
| `gitnexus://repo/dau-giai-ott/processes` | All execution flows |
| `gitnexus://repo/dau-giai-ott/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Project workflow

- Đọc `docs/README.md` để xác định nguồn sự thật theo từng loại thông tin.
- Task ID, dependency và trạng thái duy nhất nằm tại `tasks/todo.md`; `tasks/plan.md` là dependency overview.
- Không dùng `docs/plans/2026-10-08-gitnexus-plan-phase-one-two-delivery.md` để triển khai; tài liệu đó đã superseded.
- Stack đã khóa: Node.js 22, TypeScript, Vitest, npm workspaces; Phase 2 dùng Fastify, PostgreSQL, Redis/BullMQ, MinIO và React/Vite.
- Source nằm dưới `src/`; ranh giới module được mô tả tại `src/README.md`.
- Mỗi task dùng branch riêng từ `develop`: `thuandd/`, `datpt/`, `longt/` hoặc `nguyendk/`, theo mẫu `<prefix>feat-<task-id>-<slug>`.
- Không code trực tiếp trên `main` hoặc `develop`; pull request target `develop`.
- `develop` là nhánh tích hợp và nguồn deploy: sau integration/E2E và checkpoint được Đinh Đức Thuận duyệt, Thuận deploy từ `develop` lên các môi trường; không merge vào `main` hoặc deploy khi chưa được yêu cầu.
- Docs-as-code: behavior/API/schema/config/command thay đổi phải cập nhật docs liên quan trong cùng branch/PR; chỉ tick task hoặc diagram sau verification.
- Nếu requirement, ADR, contract và task card mâu thuẫn, dừng phần bị ảnh hưởng và báo đúng hai nguồn; không tự chọn.
