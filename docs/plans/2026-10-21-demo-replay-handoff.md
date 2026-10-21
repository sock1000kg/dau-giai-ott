# Kế hoạch tiếp tục: bot demo v2 và trình chiếu replay

Ngày lập: 2026-10-21. Đây là kế hoạch bàn giao để tiếp tục công việc đang dở, không phải nguồn trạng thái task. `tasks/todo.md` quyết định task ID, dependency và trạng thái; `tasks/plan.md` vẫn là overview chung. Không dùng kế hoạch GitNexus ngày 08/10 đã bị supersede.

## Mục tiêu và trạng thái đã xác minh

- Replay vòng loại cũ không có quân di chuyển vì bot OCI mẫu gửi `ACTION` theo Protocol v1 trong khi vòng loại hiện tại pin Protocol v2; các action bị từ chối `SCHEMA_VIOLATION`. Player không thể dựng nước đi không có trong replay.
- Trên `jump-jits`, vòng mẫu v2 mới đã `PUBLISHED`: 6/6 trận có `ACTION_APPLIED` (22–200/trận), 0 `ACTION_SKIPPED`. Bảy container demo đang healthy. Không chạy lại loader trên dữ liệu này.
- Bot fixtures đã tách thành branch `/home/jits/Documents/UET/dau-giai-ott-p2-t40-v2-fixtures`, `thuandd/feat-p2-t40-v2-bot-fixtures`, commit `956e014`. Sandbox corpus 4/4 test, typecheck/build pass; 6 OCI archive được tạo, bốn archive thay thế có digest khác nhau; chạy trực tiếp trong Docker trả ACTION hợp lệ cho cả Protocol v1 lẫn v2.
- Loader/sample còn thay đổi chưa commit ở `/home/jits/Documents/UET/dau-giai-ott`, branch `thuandd/feat-p2-t38-sample-data`; các source fixture đã chuyển sang P2-T40, sáu archive build nằm trong ignored artifacts để kiểm chứng cục bộ. Fullscreen còn thay đổi chưa commit ở `/home/jits/Documents/UET/dau-giai-ott-replay-presentation`, branch `thuandd/feat-p2-t39-replay-presentation`. Web suite 394/394, typecheck/build pass; browser smoke đã kiểm tra desktop, mobile, Escape và console sạch. UI mới chưa deploy.
- `/snapshots/latest.json` vẫn trả 404 do quyền volume. Đây là lỗi riêng cần theo dõi khi kiểm tra end-to-end, không phải nguyên nhân khiến replay cũ không chuyển quân.

## Thứ tự thực hiện

### 1. Chốt phạm vi và an toàn thay đổi

**Đầu vào:** Hai worktree nêu trên; các task card `P2-T38` và `P2-T39` trong `tasks/todo.md` trên từng branch.

**Việc làm:** Giữ nguyên dữ liệu đang chạy. Bot fixture đã tách khỏi `P2-T38` thành task/branch `P2-T40`; commit cục bộ `956e014` có Dockerfile, bot, corpus manifest/test/README và task card. Loader, sample JSON và runbook vẫn thuộc `P2-T38`; card hiện phụ thuộc `P2-T40` cùng `P2-T35`/`P2-T36`. Giữ mỗi task trên branch riêng. Sau khi P2-T40 được merge vào `main`, cập nhật/rebase branch P2-T38 từ `main` rồi mở PR riêng. `P2-T39` vẫn ở branch giao diện.

**Hoàn thành khi:** Mỗi PR có một task ID, phạm vi rõ, không mất diff hiện có; task card nêu đúng dependency và file dự kiến. Không tick task chỉ vì server đã có dữ liệu.

### 2. Hoàn thiện bot fixture và loader

**Việc làm:** Kiểm tra bot trả đúng phiên bản và `matchId`/`turnId` theo từng `STATE_UPDATE`: v1 cho preflight hiện tại, v2 cho trận. Kiểm tra hai chiến lược bot và các OCI archive khớp digest trong corpus manifest. Kiểm tra guard `--append`, `replaceExistingSubmissions`, tài khoản/archive thiếu, và việc loader chỉ tính series mới của vòng vừa tạo. Việc thay submission cũ phải được mô tả rõ là thao tác dành cho demo dev.

**Kiểm chứng tại worktree dữ liệu:**

```bash
python3 -m py_compile scripts/seed-sample-data.py
npm run test --workspace @ott/sandbox-corpus -- tests/v2-action.test.ts
npm run typecheck --workspace @ott/sandbox-corpus
npm run build:corpus --workspace @ott/sandbox-corpus
git diff --check
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

Kiểm tra đầu ra `detect-changes`: `partial` hoặc `truncated` không được coi là sạch; `UNKNOWN` cần đối chiếu source/text. Chạy impact trước khi sửa thêm function/class/method. Dữ liệu đã nạp trên server là bằng chứng runtime; không chạy lại script để lấy lại bằng chứng.

**Hoàn thành khi:** Test, typecheck, corpus build và guard pass; fixture v2 tạo action hợp lệ trên cả preflight và trận; docs/runbook khớp hành vi; task/PR riêng được review rồi merge vào `main` theo dependency.

### 3. Hoàn thiện fullscreen replay (`P2-T39`)

**Việc làm:** Review `ReplayPlayer.tsx`, CSS, test và web README. Kiểm tra vào fullscreen sẽ phát từ vị trí hiện tại hoặc phát lại nếu đã hết; nút thoát và Escape đồng bộ giao diện; lỗi Fullscreen API có thông báo; replay không có `ACTION_APPLIED` giải thích vì sao bàn cờ đứng yên. Không thay đổi xác minh replay hoặc phân quyền ở API.

**Kiểm chứng tại worktree fullscreen:**

```bash
npm run test --workspace @ott/platform-web -- src/features/spectator/ReplayPlayer.test.tsx
npm run typecheck --workspace @ott/platform-web
npm run build --workspace @ott/platform-web
git diff --check
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

Chạy browser test với replay có action và replay cũ không action ở desktop/mobile. Test cả thoát bằng nút và phím Escape trên trình duyệt thật; CDP headless trước đó đã xác nhận nút thoát nhưng chưa chứng minh được Escape. GitNexus impact trước sửa đã báo `ReplayPlayer` risk `HIGH`; review các caller `PrivateReplayPage` và `SpectatorReplayPage`. Nếu index trả `UNKNOWN`, đối chiếu source/text.

**Hoàn thành khi:** Tiêu chí `P2-T39` đạt trên cả replay có/không có action, test/typecheck/build pass, review graph changes xong và PR vào `main`.

### 4. Tích hợp, nghiệm thu và deploy

**Thứ tự:** bot fixture → `P2-T38` loader/sample → `P2-T39` fullscreen. Rebase branch sau mỗi lần merge và xử lý xung đột `tasks/todo.md` bằng trạng thái thực tế. Chạy integration/E2E theo task card và kiểm tra riêng endpoint snapshot đang 404; không coi snapshot là lỗi replay. Chỉ tick task sau khi có bằng chứng và cập nhật docs liên quan trong cùng PR.

Sau khi PR đã merge, integration/E2E pass và checkpoint được Đinh Đức Thuận duyệt, deploy từ `main` theo `docs/README.md`. Smoke test qua domain HTTPS: đăng nhập đúng vai trò, mở replay v2 thật, vào fullscreen, quan sát quân di chuyển, thoát, rồi mở replay lịch sử để thấy thông báo không có nước đi. Không dùng nhánh task hoặc file `/tmp` làm nguồn deploy.

## Rủi ro cần theo dõi

| Rủi ro | Cách xử lý |
| --- | --- |
| Loader `--append` có thể tạo vòng/submission mới nếu chạy lại | Chỉ dùng bằng chứng vòng đã publish; mọi thử nghiệm tiếp theo dùng stack dev cô lập. |
| Preflight còn gửi Protocol v1 trong khi trận dùng v2 | Giữ test cho cả hai đường; không rút hỗ trợ v1 trong bot fixture khi preflight chưa đổi. |
| Fullscreen phụ thuộc trình duyệt và thao tác người dùng | Kiểm tra browser thật, gồm Escape, lỗi API và viewport nhỏ. |
| GitNexus index thiếu hoặc stale | Refresh index; xem `UNKNOWN`/`partial`/`truncated` là chưa đủ bằng chứng và đối chiếu source. |
| Snapshot 404 làm hỏng luồng trang public | Ghi lỗi riêng, xác định owner/quyền volume và xác minh lại trước khi báo toàn tuyến xanh. |

**DOCS UPDATED khi hoàn thành:** `tasks/todo.md`, `docs/runbooks/local-demo.md`, `src/bots/sandbox-corpus/README.md`, `src/platform/web/README.md` theo đúng PR sở hữu thay đổi. Không đưa credential, cookie hoặc payload replay riêng tư vào commit hay log bàn giao.
