# ADR-0001: Stack công nghệ và hạ tầng phát triển cục bộ

## Status

Accepted — package manager/workspace được làm rõ bởi ADR-0002

## Date

2026-10-08

## Context

Phase 1 và Phase 2 cần một baseline thống nhất để bốn thành viên có thể phát triển, tích hợp và kiểm thử trên môi trường có thể tái tạo. Phase 2 cần database giao dịch, queue, object storage S3-compatible, API và web portal; các dependency cục bộ không được phụ thuộc vào cài đặt riêng trên máy từng thành viên.

## Decision

- Baseline chung là Node.js 22, TypeScript, Vitest và npm workspaces.
- Phase 2 dùng Fastify cho API, PostgreSQL cho dữ liệu giao dịch/metadata, Redis với BullMQ cho queue, S3-compatible storage cho artifact, React với Vite cho portal.
- Môi trường phát triển dùng MinIO làm S3-compatible storage.
- PostgreSQL, Redis và MinIO chạy trong Docker, được quản lý bởi một Docker Compose project của repository và chỉ publish lên `localhost` theo mặc định.
- Endpoint, credential và host port được cấu hình qua biến môi trường; repository cung cấp `.env.example` không chứa secret thật.
- Local stack có health check và volume cục bộ; integration test có quy trình reset về trạng thái sạch.

## Consequences

- `P1-T02` phải pin Node.js 22 và cung cấp scripts build/typecheck/test thống nhất.
- P2-01 phải cung cấp `compose.yaml`, health checks, cấu hình fail-fast và các lệnh lifecycle cho local stack.
- Adapter S3 không được phụ thuộc API riêng của MinIO để có thể thay implementation ở môi trường khác.
- Cấu hình `localhost` chỉ dành cho development; production topology và secret management là quyết định triển khai riêng.
- Mọi đề xuất đổi framework hoặc dependency hạ tầng chính phải cập nhật ADR này bằng một ADR superseding trước khi sửa task/estimate liên quan.
