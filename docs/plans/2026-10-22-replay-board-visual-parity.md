# P2-T41 — Plan thay giao diện bàn cờ và quân cờ replay

## Mục tiêu và mốc đối chiếu

Thay phần bàn cờ trong `ReplayPlayer` để nhìn như bàn cờ OTTv2 của [`sock1000kg/rock-paper-scissor` tại commit `2956f16`](https://github.com/sock1000kg/rock-paper-scissor/tree/2956f1601365274eb34d623a9c908900bf43baab). Chốt hình ảnh theo [`Board.tsx`](https://github.com/sock1000kg/rock-paper-scissor/blob/2956f1601365274eb34d623a9c908900bf43baab/src/components/Board.tsx), [`GamePiece.tsx`](https://github.com/sock1000kg/rock-paper-scissor/blob/2956f1601365274eb34d623a9c908900bf43baab/src/components/GamePiece.tsx) và [`styles.css`](https://github.com/sock1000kg/rock-paper-scissor/blob/2956f1601365274eb34d623a9c908900bf43baab/src/styles.css) đang dùng nền tối. So ảnh trong cùng Chromium/Linux vì glyph emoji phụ thuộc hệ điều hành. Task ID, dependency, owner và trạng thái chỉ lấy từ [`tasks/todo.md`](../../tasks/todo.md).

Đợt này chỉ đổi vùng bàn cờ và quân cờ. Giữ dữ liệu frame từ `createReplayTimeline`, map đi kèm replay, kiểm tra integrity, phân quyền, luật game và các điều khiển phát hiện có. `ReplayPlayer` phục vụ cả `PrivateReplayPage` và `SpectatorReplayPage`; GitNexus impact trước sửa báo `HIGH`, hai caller trực tiếp và bốn process liên quan. Không thay đổi giao diện shell, scoreboard hoặc danh sách nước đi trong task này.

## Cách triển khai

1. **Chốt ảnh chuẩn và dữ liệu đối chiếu.** Chụp riêng bàn cờ mẫu với map mặc định ở desktop 1440×1100 và mobile 390×844. Ghi các chi tiết cần khớp: khung tối rộng tối đa 48rem, 81 ô sát nhau với hai sắc độ xen kẽ, tọa độ trong ô, cờ ở `a1`/`i9`, token tròn chiếm khoảng 92% ô, viền X đỏ/O xanh và ký hiệu ✊/✋/✌️. Chuẩn bị replay fixture có nước đi, ăn quân, chướng ngại vật và một replay không có action; fixture phải đi qua luồng xác minh hiện có.
2. **Thay phần trình bày bàn cờ trong `ReplayPlayer.tsx`.** Tiếp tục dựng 81 ô từ frame/map đã xác minh. Giữ bảng HTML có caption và nhãn từng ô để tránh mất khả năng đọc màn hình; đưa tọa độ vào bên trong ô, bỏ hàng/cột tọa độ hiển thị bên ngoài. Render quân bằng phần tử tĩnh có nhãn đội và loại; replay không thêm nút chọn/đi quân. Với map mặc định, `goals.O` ở `a1` có nền/cờ đỏ và `goals.X` ở `i9` có nền/cờ xanh; vị trí luôn lấy từ map, và nhãn truy cập vẫn nêu đúng đội cần đến đích. Khi quân đứng trên ô đích, quân che cờ như mẫu nhưng nhãn ô vẫn nêu đích.
3. **Áp dụng CSS scoped trong `replay-player.css`.** Dùng màu OKLCH, viền, bóng và tỷ lệ từ CSS tham chiếu cho khung, ô, quân và chướng ngại vật; không sửa token toàn site. Ô vuông không có gap/bo góc riêng; giữ dấu ô xuất phát/đích của nước đi bằng lớp phủ không che emoji hoặc viền phe. Tính kích thước bàn cờ theo cả chiều rộng và chiều cao còn lại của fullscreen để 9 hàng, caption và controls luôn nhìn thấy. Tôn trọng `prefers-reduced-motion` nếu thêm transition.
4. **Regression và so ảnh.** Cập nhật test DOM/ARIA cho 81 ô, sáu tổ hợp phe/loại, hai đích, chướng ngại vật, ô có quân và ô sau ăn quân. Kiểm tra frame đầu → phát → tua → kết thúc, fullscreen/thoát bằng nút hoặc Escape, replay không action và hai route công khai/riêng. Chụp lại cùng kích thước ở bước 1 và chỉnh sai khác trong vùng bàn cờ/quân cờ. Cập nhật `src/platform/web/README.md` cùng branch triển khai.

## Thứ tự và điểm kiểm tra

```text
P2-T27 ReplayPlayer có frame đã xác minh
  → ảnh chuẩn + fixture hành động
  → bàn cờ/quân cờ mới
  → test chức năng và accessibility
  → so ảnh desktop/mobile/fullscreen
  → owner review bằng chứng trước khi tick P2-T41
```

`P2-T39` là task kiểm tra fullscreen liên quan; nó không chặn phần thay hình ảnh vì fullscreen đã có trong source hiện tại. Khi triển khai, tạo branch `thuandd/feat-p2-t41-replay-board-visual` từ `main` mới nhất và không mở song song branch khác sửa `ReplayPlayer` hoặc replay CSS.

## Tiêu chí hoàn tất

- Vùng bàn cờ/quân cờ khớp hình mẫu trên cùng môi trường render ở desktop, mobile và fullscreen: đúng 9×9, ô, tọa độ, đích, chướng ngại vật, màu phe và ba ký hiệu quân; không cắt hoặc che hàng cuối.
- Replay vẫn chỉ đọc event log đã xác minh; vị trí, ăn quân, nhãn ô, highlight và điều khiển phát đúng ở replay công khai lẫn riêng.
- `npm test --workspace @ott/platform-web`, `npm run typecheck --workspace @ott/platform-web`, `npm run build --workspace @ott/platform-web`, `git diff --check` đạt; chạy GitNexus `detect-changes --scope all` trước commit và lưu ảnh đối chiếu cho owner review.

## Rủi ro cần kiểm tra

| Rủi ro | Cách xử lý |
| --- | --- |
| CSS bảng làm ô không vuông hoặc lệch tọa độ | Đo kích thước thực của ô và kiểm tra ô góc trên/dưới trong trình duyệt. |
| Đổi màu ô đích làm đảo nghĩa `goals.X`/`goals.O` | Test riêng vị trí map mặc định và nhãn đội đi tới đích; màu theo ô xuất phát của phe như mẫu. |
| Emoji khác hình giữa thiết bị | Dùng emoji gốc của mẫu; chỉ yêu cầu khớp pixel trên cùng Chromium/Linux. |
| Fullscreen che quân hoặc controls trên màn thấp/mobile | Kiểm tra 390×844 và viewport desktop thấp, giữ kích thước board theo chiều cao còn lại. |

## Bằng chứng trình duyệt

Ảnh Chromium/Linux từ replay fixture có vị trí quân theo map, chướng ngại vật tại e5 và replay không action:

- [Desktop 1440×1100](../validation/p2-t41/desktop-1440x1100.png)
- [Mobile 390×844](../validation/p2-t41/mobile-390x844.png)
- [Fullscreen 1440×1100](../validation/p2-t41/fullscreen-1440x1100.png)

DOM/ARIA và playback của component dùng chung được kiểm tra bằng `replay-player.ui.test.tsx`; hai wrapper private/public được kiểm tra trong `replay-pages.ui.test.tsx` và `PrivateReplayPage.test.tsx`.
