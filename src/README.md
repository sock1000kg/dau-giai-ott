# Source layout

`src/` là source root của dự án.

```text
src/
├── game-core/       # Long Trần: luật game và Engine API
├── bot-protocol/    # Long Trần: protocol types/schema runtime
├── match-runner/    # Phạm Tất Đạt: ports, runner, process, CLI
├── bots/
│   ├── python/      # Đỗ Khôi Nguyên: SDK, bot mẫu và bot lỗi
│   └── sandbox-corpus/ # Đinh Đức Thuận: canary và artifact kiểm thử sandbox Phase 2
└── platform/        # Phase 2 local
    ├── api/         # Fastify + PostgreSQL + S3-compatible storage adapter
    ├── job-contract/ # MatchJob schema dùng chung giữa API và worker
    ├── worker/      # BullMQ worker + sandbox adapter
    └── web/         # React/Vite
```

Phase 3 tiếp tục dùng các boundary này theo [Solution Architecture Phase 3](../docs/architecture/solution-architecture-phase-3.md); không mặc định tách thêm microservice. Các target chưa tồn tại không được coi là implementation đã hoàn tất:

- `game-core`, `bot-protocol` và `match-runner` nhận phần contract/deterministic runtime thuộc lane `P3-L*`.
- `platform/api`, `platform/job-contract`, `platform/worker` và `platform/web` được mở rộng theo task `P3-D*`/`P3-N*`; public snapshot app vẫn nằm trong web workspace và chỉ đọc artifact versioned.
- Cấu hình vận hành/observability đặt ở `ops/`, LAN deployment đặt ở `deploy/lan/`, automation dùng `scripts/`; không đặt các phần này trong `src/`.
- Gate `P3-0` đã đạt; thư mục/file Phase 3 chỉ được tạo khi dependency của task tương ứng đã đủ và theo đúng task card trong `tasks/todo.md`.

Quy tắc:

- Mỗi module TypeScript có `package.json`, public entrypoint `src/index.ts` và test riêng theo [convention package module](../docs/conventions/module-package.md); config TypeScript dùng chung tại `src/tsconfig.base.json`.
- Không import internal file của module khác; dùng public contract.
- `game-core` không import protocol, process, framework hoặc infrastructure.
- `match-runner` không chứa game rules.
- `bots/python` không import TypeScript implementation.
- Infrastructure local đặt ở `infra/local/`, không đặt trong `src/`.
