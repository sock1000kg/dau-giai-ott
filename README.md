# OTT Tournament

Nền tảng tổ chức giải đấu cho bot: đội nộp bot dạng OCI image, hệ thống tự kiểm tra, xếp lịch, chạy trận trong sandbox, tính Elo và công bố bảng xếp hạng, replay. Vòng chung kết chạy offline trên LAN rồi đồng bộ lên web bằng ResultBundle có chữ ký.

**Demo công khai:** <https://ott-frontend.d-thuand.party/public>

## Thông tin về dự án

- [demo/01-tong-quan.md](demo/01-tong-quan.md): tổng quan cuộc thi, các khái niệm, vòng loại và chung kết.
- [demo/02-hardening.md](demo/02-hardening.md): cách hệ thống phòng tránh sự cố và gian lận.
- [demo/03-kien-truc.md](demo/03-kien-truc.md): kiến trúc hệ thống, bản đơn giản.
- [demo/04-ban-do-chuc-nang-ui.md](demo/04-ban-do-chuc-nang-ui.md): mỗi việc nằm ở đâu trên giao diện.

## Chạy thử local

Cần Node.js `^22.12.0`, Docker Engine ≥ 24 với Compose v2.

```bash
./scripts/demo.sh up        # build, migrate, seed tài khoản demo, in URL và nơi lưu mật khẩu
./scripts/demo.sh status    # kiểm tra
./scripts/demo.sh reset     # xóa stack demo
```

Hướng dẫn đầy đủ: [docs/runbooks/local-demo.md](docs/runbooks/local-demo.md). Dựng bản công khai sau Cloudflare tunnel: [docs/runbooks/public-demo-hosting.md](docs/runbooks/public-demo-hosting.md).

## Phát triển

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Bot dùng **Bot Protocol v2** ([hợp đồng](docs/contracts/bot-protocol-v2.md)); v1 đã deprecated. Task và trạng thái nằm ở [tasks/todo.md](tasks/todo.md), tài liệu theo loại ở [docs/README.md](docs/README.md), ranh giới module ở [src/README.md](src/README.md).
