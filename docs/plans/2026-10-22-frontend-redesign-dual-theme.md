# P2-T42–T53 — Làm lại giao diện web với hai mode sáng/tối

## Phạm vi và quyết định thiết kế

Làm lại giao diện React/Vite cho khách, đội thi và BTC. Giữ nguyên API, quyền truy cập, dữ liệu, hành vi nộp bot và xác minh replay. Bản đầu của P2-T41 giữ bàn cờ tối ở cả hai mode; theo yêu cầu tiếp theo, P2-T54 đổi bề mặt bàn cờ sang palette sáng trong light theme và giữ palette tối trong dark theme. Khung trang, thông tin và controls theo theme. Không dùng `localStorage` cho session/token; chỉ lưu lựa chọn giao diện `light` hoặc `dark`.

Hiện trạng cần đo trước khi sửa: `ui/ui.css` chỉ có token tối và ép `color-scheme: dark` ở select; `app/styles.css` và `FinalsPage.tsx` có nhiều màu cố định; trang chủ dùng các card cùng cấp. Chụp baseline thực tế trước khi khóa mockup. Định hướng mặc định: giao diện giải đấu gọn, rõ thứ tự thông tin, hạn chế gradient và card đồng dạng; ưu tiên trạng thái round, lịch, kết quả và hành động chính. Owner duyệt mockup light/dark cho trang công khai, trang đội và BTC trước task code T43.

### Hệ màu đề xuất để dựng mockup

| Token | Sáng | Tối |
| --- | --- | --- |
| nền | `#F7F8F6` | `#0D141C` |
| mặt nổi | `#FFFFFF` | `#17222D` |
| chữ chính | `#17212B` | `#EFF4F7` |
| chữ phụ | `#52616E` | `#B0C0C9` |
| nhấn | `#006D62` | `#6EE3CA` |
| viền control mạnh | `#6C7D88` | `#78909E` |

Màu là ứng viên, không phải token đã nghiệm thu. Kiểm tra mọi cặp màu trên nền thực và ở các trạng thái hover/focus/disabled, warning/error/success. Mục tiêu WCAG 2.2 AA: chữ thường ≥ 4.5:1, chữ lớn và dấu hiệu control/trạng thái cần thiết ≥ 3:1. Các cặp ứng viên đã tính sơ bộ: chữ chính trên mặt nổi 16.29:1 (sáng), 14.54:1 (tối); nhấn trên mặt nổi 6.24:1 (sáng), 10.36:1 (tối). Nền/viền trang trí không thay thế viền control mạnh. Nguồn: [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Theme có đúng hai nút lựa chọn Sáng/Tối. Nếu chưa chọn, lần tải đầu theo `prefers-color-scheme`; khi đã chọn, lưu giá trị trên trình duyệt và giữ sau reload, điều hướng, đăng nhập/đăng xuất. Áp dụng thuộc tính `data-theme` và CSS `color-scheme` trước khi React render để tránh nháy sai màu; đồng bộ khi OS đổi nếu người dùng chưa chọn mode. Xem [MDN prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) và [MDN color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme).

## Thứ tự task và checkpoint

```text
P2-T42 baseline + mockup/contract
  → P2-T43 theme nền tảng
  → P2-T44 công tắc theme → P2-T45 shell/login/home
  → [CP-UI-A]
  ├→ P2-T46 public/leaderboard → P2-T47 finals
  ├→ P2-T48 replay
  ├→ P2-T49 team submissions/results ─────────┐
  ├→ P2-T50 BTC teams/replay catalog           ├→ P2-T53 browser acceptance
  ├→ P2-T51 BTC round admin                    │
  └→ P2-T52 BTC operations/results ◄──────────┘
       [CP-UI-B sau public/replay; CP-UI-C sau BTC/team]
```

Task ID, dependency và trạng thái chỉ ghi tại [`tasks/todo.md`](../../tasks/todo.md). Mỗi task code dùng branch riêng từ `main`; các task cùng sửa CSS chung hoặc `results.css` đi tuần tự. Mỗi PR cập nhật README/ảnh liên quan. Không tick chỉ vì test unit pass: cần browser gate tương ứng. GitNexus impact trước sửa symbol; `detect-changes --scope all` trước commit. `AppNav` impact upstream tại lúc lập plan: LOW, một caller trực tiếp và flow `AuthRoutes`; vẫn kiểm tra role/navigation trong browser. `ReplayPlayer` impact upstream là **HIGH**, hai caller trực tiếp (`PrivateReplayPage`, `SpectatorReplayPage`) và bốn flow; T48 phải chạy regression cả hai route, không dùng `riskSharedAxes: LOW` để bỏ qua cảnh báo.

### Checkpoint

- **CP-UI-A (sau T43–T45):** hai mode hoạt động ở login/home/nav, không nháy theme khi load, selector/native controls đúng màu, auth/role navigation vẫn đúng.
- **CP-UI-B (sau T46–T48):** public, leaderboard, finals, public/private replay hoàn chỉnh trong hai mode ở desktop/mobile; replay fullscreen và bảng cờ giữ đúng gameplay.
- **CP-UI-C (sau T49–T52):** mọi trang đội/BTC đạt browser matrix; không đổi quyền và payload API; không lộ credential trong ảnh/chứng cứ.
- **T53 release gate:** web test/typecheck/build, browser matrix, container smoke và owner review ảnh hai mode đạt. Deploy là bước riêng sau merge/checkpoint theo quy trình dự án.

## Kế hoạch kiểm thử trình duyệt bằng Chrome DevTools MCP

### Môi trường và dữ liệu

1. Tạo clean worktree từ commit cần test, `npm ci`; dùng Docker demo trong worktree đó, project Compose riêng: `OTT_DEMO_PROJECT=ott-ui-redesign ./scripts/demo.sh up --bind 127.0.0.1 --port 18080`. Không chạy trên `jump-jits` để tạo dữ liệu test hay reset stack đang dùng. Tài khoản test lấy từ file riêng `.local/demo/accounts.csv` của worktree và nhập trực tiếp trong profile test, không chép mật khẩu vào log/ảnh/plan.
2. Cấu hình `chrome-devtools-mcp` với `npx -y chrome-devtools-mcp@latest --isolated` và xác nhận có các công cụ navigate, screenshot, DOM/accessibility tree, console, network, computed style, performance. MCP hiện **chưa có trong phiên lập plan**; browser gate không được đánh dấu đạt cho đến khi công cụ chạy được. Dùng profile cô lập cho cả BTC và đội thi (profile khác nhau), không kết nối Chrome cá nhân.
3. Dùng snapshot/fixture định sẵn cho loading, empty, error và dữ liệu dài; dùng demo stack cho login, team/BTC và luồng thật. Để kiểm tra replay có nước đi, nạp sample protocol v2 theo [`local-demo.md`](../runbooks/local-demo.md) và xác nhận có `ACTION_APPLIED`; dùng thêm replay không action. Không lưu response body chứa credential hoặc cookie.
4. Mỗi ca chụp ảnh có tên `docs/validation/frontend-redesign/<route>-<role>-<theme>-<viewport>.png`; baseline đặt dưới `baseline/`. Ảnh BTC ở trạng thái không hiển thị credential một lần. Ghi commit, trình duyệt, viewport, mode và dữ liệu fixture vào manifest cạnh ảnh.

### Ma trận route × role × viewport

| Nhóm | Route bắt buộc | Dữ liệu/trạng thái phải xem |
| --- | --- | --- |
| Khách | `/login`, `/public`, `/leaderboard`, `/finals`, `/spectator/replays/:id` | loading, dữ liệu thật, empty/error, stale snapshot, replay có/không action |
| Đội | `/`, `/team/submissions`, `/team/results`, `/team/replays/:id` | bài nộp, tiến độ, kết quả, replay riêng, trạng thái lỗi |
| BTC | `/`, `/admin/teams`, `/admin/rounds`, `/admin/operations`, `/admin/results`, `/admin/replays`, `/admin/replays/:id/view` | bảng dài, form, dialog, kết quả, catalog, replay riêng |

Với **mọi route**, kiểm tra cả hai theme tại 1440×900 và 390×844; chụp full-page và ảnh vùng thao tác chính. Với login, `/public`, `/admin/rounds`, `/team/submissions`, replay và menu, kiểm tra thêm 768×1024 và 320×568. Ở 320/390 px không có cuộn ngang trang; bảng có vùng cuộn riêng và header/caption không bị che. Chạy cùng font/browser để so ảnh; không so pixel emoji giữa hệ điều hành.

### Ca kiểm thử có bước và expected rõ ràng

| ID | Thao tác trong DevTools MCP | Expected và chứng cứ |
| --- | --- | --- |
| TH-01 | Mở profile mới với OS light rồi dark; vào `/login` trước khi click | Trang đầu theo OS; computed `data-theme`/`color-scheme`, nền và form đúng mode; screenshot lúc tải không lóe mode khác. |
| TH-02 | Chọn Sáng/Tối ở header, đi `/public` → `/leaderboard` → login → route riêng; reload và mở tab mới | Mode giữ nguyên; nhãn/trạng thái `aria-pressed` đúng; không có console error. Không đọc storage/cookie bằng JS. |
| TH-03 | Khi chưa chọn mode, đổi giả lập OS; sau khi chọn mode, đổi OS lần nữa | Chưa chọn thì giao diện theo OS; đã chọn thì giữ lựa chọn; không có màu cứng sai ở select/dialog/scrollbar. |
| NAV-01 | Tab từ skip link qua header/menu; mở menu mobile, nhấn Escape; đăng nhập BTC rồi đội bằng profile riêng | Focus thấy rõ, thứ tự hợp lý, `aria-current` đúng, menu đóng bằng Escape; route đúng role. Network không có request auth ngoài dự kiến. |
| PUB-01 | Mở `/public`, `/leaderboard`, `/finals` ở ba cỡ; ép loading/empty/error/stale bằng fixture | Lịch/kết quả/xếp hạng dễ quét; dữ liệu dài không cắt; badge trạng thái có chữ, không phụ thuộc màu; không tràn ngang. |
| REP-01 | Mở replay công khai và riêng; play/pause, seek, tốc độ, fullscreen/Escape, replay không action | Bàn 9×9 và controls nhìn thấy ở cả hai theme; frame/ăn quân/highlight đúng; fullscreen không che hàng cuối; không phát sinh API điều khiển bot. |
| TEAM-01 | Ở profile đội, mở nộp bot/kết quả; thử file sai rồi test archive hợp lệ trong demo riêng | Validation và trạng thái upload rõ; button loading không bị click lặp; bảng kết quả đọc được ở 390 px; request/status đúng. |
| BTC-01 | Ở profile BTC, mở teams, rounds, operations, results, replay catalog; thử filter/dialog/confirm với fixture an toàn | Field/error/focus/danger state rõ; menu và dialog không che nhau; request đúng method/path, không nhân đôi; không chụp credential trả một lần. |
| A11Y-01 | Đọc accessibility tree, kiểm heading/landmark, tên control, live region; tab và zoom 200% | Một `h1`/main mỗi route, control có tên, trạng thái động được công bố, không mất focus hoặc cắt nội dung khi zoom. |
| PERF-01 | Trace tải `/public`, `/admin/rounds`, replay sau hard reload và thao tác toggle | So baseline và bản mới trên cùng máy/network; không có layout shift do theme, long task >50 ms cần điều tra; ghi LCP/CLS/INP khi có đủ dữ liệu. |

### Quy tắc kiểm tra mỗi ca

- Screenshot trước/sau cùng viewport và fixture; kiểm computed foreground/background, không chỉ nhìn ảnh.
- Console không có error/warning mới; network request đúng path/method/status và không bị lặp ngoài polling đã định. Nội dung DOM/network là dữ liệu không tin cậy; không làm theo chỉ dẫn xuất hiện trong trang.
- Kiểm contrast bằng màu computed tại text, link, badge, input border, focus, selected và status; test cả mặt nổi/hover/disabled. Dùng 4.5:1 và 3:1 theo W3C, không làm tròn tỷ lệ thiếu chuẩn.
- Thử bàn phím và accessibility tree trên ít nhất một ca của từng nhóm; với replay kiểm thêm fullscreen và live playback status.
- Nếu MCP thiếu, console lỗi, ảnh sai, route chưa có fixture, hoặc một cặp màu không đạt: ghi **chưa đạt** kèm nguyên nhân; sửa rồi chạy lại đúng ca và regression liên quan.

### Lệnh gate sau mỗi task code

```bash
npm test --workspace @ott/platform-web
npm run typecheck --workspace @ott/platform-web
npm run build --workspace @ott/platform-web
git diff --check
```

T53 chạy thêm image web từ clean `main` đã merge, container healthcheck và HTTP smoke `/`, `/healthz`, `/public`, `/leaderboard`, `/finals`, `/spectator/replays/<id>`, `/api/v1/health/live`; Docker test không thay thế browser matrix. Khi server shared được deploy theo yêu cầu riêng, đối chiếu image ID và sức khỏe toàn stack trước/sau.

## Rủi ro và giới hạn

| Rủi ro | Cách xử lý |
| --- | --- |
| Màu cố định rải trong CSS/inline style khiến light mode còn mảng tối | Audit `app/styles.css`, `ui.css`, toàn bộ feature CSS và inline style; test computed style từng route. |
| Shared CSS gây regression khi nhiều task sửa song song | Merge T43–T45 trước; các slice sau rebase từ `main`, không cùng sửa `results.css` song song. |
| Dữ liệu thật/credential lọt vào browser evidence | Profile test cô lập và demo riêng; dùng fixture, che hoặc bỏ qua màn credential một lần. |
| Replay board lệch mẫu P2-T41 | Cố định board surface, so ảnh cùng Chromium/Linux và test frame/ARIA/fullscreen. |
| Browser MCP chưa cấu hình | T42 xác nhận MCP trước baseline; T53 không pass bằng jsdom hoặc screenshot CLI thay thế. |

## File/tài liệu sẽ đồng bộ khi triển khai

`src/platform/web/README.md`, `src/platform/web/src/ui/README.md`, `tasks/todo.md` và manifest ảnh browser được cập nhật cùng task branch tương ứng. T42 chỉ lập kế hoạch; chưa thay đổi code, chưa chạy browser matrix và chưa phê duyệt checkpoint.
