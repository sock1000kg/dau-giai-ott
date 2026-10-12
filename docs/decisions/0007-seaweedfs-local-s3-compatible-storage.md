# ADR-0007: SeaweedFS làm object storage S3-compatible cho local Phase 2

## Status

Accepted

## Date

2026-10-12

## Context

ADR-0001 và ADR-0005 chọn MinIO AIStor Free Tier cho object storage local. AIStor
yêu cầu license file riêng, tạo một bước chuẩn bị không cần thiết cho dự án phi lợi
nhuận. Phase 2 chỉ cần S3 API chuẩn cho object bất biến và phải có đường chuyển sang
AWS S3 mà không thay đổi nghiệp vụ.

## Decision

- Dùng SeaweedFS `weed mini` một node cho local development; nó chỉ được truy cập qua
  S3 endpoint với access key/secret local và bucket do server khởi tạo idempotent.
- API/worker chỉ dùng AWS SDK v3 và S3 core operations (`PutObject`, `GetObject`,
  `HeadObject`, `CopyObject`, `DeleteObject`). Không dùng Filer API, `weed` CLI hay
  metadata/command đặc thù của SeaweedFS ngoài Docker Compose local.
- Cấu hình storage được tách theo environment: local có endpoint và
  `forcePathStyle=true`; AWS S3 bỏ endpoint và không dùng path-style. PostgreSQL vẫn
  là nguồn identity với `objectKey`, `byteSize` và SHA-256; không dùng ETag làm digest.
- Credential local chỉ nằm trong `.env` bị gitignore. Không có license file, service
  đặc quyền hay secret thật trong repository.

## Consequences

- Quyết định này thay thế phần chọn MinIO/AIStor trong ADR-0001 và ADR-0005, cũng như
  requirement/task/runbook liên quan; các ADR cũ vẫn giữ nguyên như lịch sử.
- `P2-T02` dùng SeaweedFS và `P2-T07` phải hiện thực adapter S3 portable. Khi chuyển
  AWS S3, sao chép object rồi đối chiếu key, byte size và SHA-256 trước khi đổi endpoint
  và IAM credentials.
- Một submission lớn hơn giới hạn `CopyObject` đơn lẻ của AWS phải dùng multipart copy
  hoặc bị chặn bởi quota công bố ở `P2-T14`.

## Sources

- https://github.com/seaweedfs/seaweedfs#quick-start
- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-client-constructors.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html
