# Bộ test case kiểm thử E2E thủ công

> Trước khi thực hiện kiểm tra thủ công, xem [bản đồ chức năng UI](../04-ban-do-chuc-nang-ui.md) để biết mỗi
> bước tương ứng với màn hình nào và xem ảnh chụp trực tiếp từ Frontend local.

## Mục đích

Bộ tài liệu này dùng cho người kiểm thử thao tác bằng trình duyệt và quan sát hệ thống chạy thật từ đầu đến
cuối. Kết quả manual không thay thế automated test, không tự đóng task/checkpoint và không phải bằng chứng
deploy production.

Nguồn đối chiếu:

- Nghiệp vụ: [`docs/tai-lieu-yeu-cau.md`](../../docs/tai-lieu-yeu-cau.md).
- Trạng thái task/checkpoint: [`tasks/todo.md`](../../tasks/todo.md).
- Vận hành demo: [`docs/runbooks/local-demo.md`](../../docs/runbooks/local-demo.md).
- Hosted PoC và finals LAN: [`docs/runbooks/hosted-poc-operations.md`](../../docs/runbooks/hosted-poc-operations.md)
  và [`docs/runbooks/finals-lan.md`](../../docs/runbooks/finals-lan.md).

## Phạm vi và thứ tự chạy

| Thứ tự | Tệp | Phạm vi | Số case |
| --- | --- | --- | ---: |
| 0 | [Chuẩn bị](00-chuan-bi-va-quy-uoc.md) | Môi trường, dữ liệu, bằng chứng, quy tắc Pass/Fail | — |
| 1 | [Smoke, đăng nhập và phân quyền](01-smoke-auth-phan-quyen.md) | Gateway, session, role, điều hướng | 9 |
| 2 | [Qualification từ đầu đến cuối](02-qualification-team-btc.md) | Mở round, hai đội nộp bot, chạy round | 13 |
| 3 | [Kết quả, replay và public](03-results-replay-public.md) | Kết quả theo role, replay riêng tư, snapshot/public UI | 11 |
| 4 | [Recovery, security và UX](04-recovery-security-ux.md) | Restart, dữ liệu, negative paths, mobile/keyboard | 10 |
| 5 | [Chạy thử bot](06-test-runs.md) | Menu đội thi, quota/policy, tạo lượt, polling và replay riêng | 4 |
| 6 | [BTC quản lý bot tham chiếu](07-btc-reference-bots.md) | BTC tải OCI archive, duyệt bật/tắt; đội thấy bot trong policy | 5 |
| 7 | [Hosted PoC và finals có điều kiện](05-hosted-finals-conditional.md) | Host thật, LAN, restore, bundle ký và công bố | 10 |

Track local bắt buộc gồm `MAN-SMOKE-*`, `MAN-QUAL-*`, `MAN-VIEW-*` và `MAN-OPS-*`. Track
`MAN-HOST-*` chỉ chạy khi có đúng hạ tầng được nêu trong từng case; không thay bằng fixture hoặc Vitest.

## Cách dùng

1. Sao chép [mẫu biên bản](BIEN-BAN-KIEM-THU.md) sang một file riêng cho từng lần chạy.
2. Ghi commit, branch, URL, thiết bị/trình duyệt và người kiểm thử trước khi bắt đầu.
3. Chạy case đúng thứ tự; case phụ thuộc không được đánh dấu Pass khi case trước đã Fail hoặc Blocked.
4. Lưu ảnh/video/log theo tên `<case-id>-<mo-ta>.<ext>`; che mật khẩu, cookie, TOTP, recovery code và private key.
5. Với mỗi lỗi, ghi thời điểm có timezone, bước lỗi, expected/actual, correlation ID nếu UI/API cung cấp và
   đường dẫn evidence. Không reset dữ liệu trước khi đã thu thập log.

## Quy tắc kết luận

- **Pass:** mọi kết quả mong đợi của case đều đúng và có đủ bằng chứng bắt buộc.
- **Fail:** hệ thống chạy nhưng có ít nhất một kết quả sai.
- **Blocked:** không thể thực hiện do thiếu dependency, hạ tầng, tài khoản hoặc dữ liệu; không tính là Pass.
- **Not run:** chưa chạy.
- **N/A:** chỉ dùng khi owner xác nhận case không thuộc phạm vi lần test và ghi rõ lý do.

Một lượt local E2E chỉ đạt khi tất cả case bắt buộc Pass, không có lỗi Critical/High chưa xử lý, và biên bản
ghi đủ dữ liệu đầu vào/đầu ra. Một lượt hosted/finals chỉ đạt khi chạy trên topology thật, có bằng chứng
recovery/network/bundle tương ứng và được người có thẩm quyền duyệt checkpoint trong `tasks/todo.md`.

## Ranh giới an toàn

Demo worker/coordinator mount Docker socket và tài khoản local có thể dùng mật khẩu công khai. Chỉ chạy bot
fixture của repository trong môi trường throw-away; không đưa demo mode ra Internet. `demo.sh reset --yes`
xóa container, volume, `demo.env` và `accounts.csv`, vì vậy chỉ chạy sau khi đã xác nhận đúng môi trường và
đã thu thập evidence.
