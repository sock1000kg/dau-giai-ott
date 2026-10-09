# Source layout

`src/` là source root của dự án.

```text
src/
├── game-core/       # Long Trần: luật game và Engine API
├── bot-protocol/    # Long Trần: protocol types/schema runtime
├── match-runner/    # Phạm Tất Đạt: ports, runner, process, CLI
├── bots/
│   ├── python/      # Đỗ Khôi Nguyên: SDK, bot mẫu và bot lỗi
│   └── sandbox-corpus/ # Đỗ Khôi Nguyên: canary và artifact kiểm thử sandbox Phase 2
└── platform/        # Phase 2 local
    ├── api/         # Fastify + PostgreSQL + MinIO adapter
    ├── job-contract/ # MatchJob schema dùng chung giữa API và worker
    ├── worker/      # BullMQ worker + sandbox adapter
    └── web/         # React/Vite
```

Quy tắc:

- Mỗi module TypeScript có `package.json`, public entrypoint `src/index.ts` và test riêng theo [convention package module](../docs/conventions/module-package.md); config TypeScript dùng chung tại `src/tsconfig.base.json`.
- Không import internal file của module khác; dùng public contract.
- `game-core` không import protocol, process, framework hoặc infrastructure.
- `match-runner` không chứa game rules.
- `bots/python` không import TypeScript implementation.
- Infrastructure local đặt ở `infra/local/`, không đặt trong `src/`.
