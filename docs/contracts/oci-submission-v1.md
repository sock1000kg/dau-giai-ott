# OCI Submission v1

A team uploads exactly one `application/octet-stream` OCI Image Spec 1.1 image in an OCI Image Layout tar archive to `POST /api/v1/submissions`. The layout marker is `imageLayoutVersion: 1.0.0`. The request is limited to 256 MiB by this route's body limit; JSON/API requests keep Fastify's normal smaller default. Identity comes only from its authenticated session; the request has no team ID, language, command, tag, registry URL or Dockerfile fields.

The server quarantines then structurally validates the archive using the locked OCI validator. A successful upload records immutable archive, manifest and config digests with policy `P2_BASELINE_V1` and status `PREFLIGHT`. Worker `preflightSubmission` reloads the pinned object, checks its checksum/OCI identity/entrypoint, and requires the isolated `OTT_SANDBOX_V1` bot to start and return a valid Bot Protocol v2 `ACTION`. It then atomically supersedes the prior active version, marks the new one `VALID` then `ACTIVE`, and writes an activation audit event. Failed checks move a still-`PREFLIGHT` submission to `INVALID` with a stable audit reason. Repeating preflight for an already active identity returns idempotently without launching another bot.

`POST /api/v1/submissions` returns the created submission in `{ data: { id, status, archiveSha256, ociManifestDigest, ociConfigDigest, policyVersion, createdAt, reservationId? } }`. `createdAt` is an ISO-8601 UTC timestamp and is also returned for an idempotent retry of a completed reservation. The server locks the round row in the insert transaction and returns `409 SUBMISSION_NOT_OPEN` if the round stopped accepting submissions before the submission could be committed; the uploaded object is removed on this failure.

### Preflight failure reasons (`status: 'INVALID'`)

When preflight smoke testing rejects a submission, an audit event `SUBMISSION_PREFLIGHT_FAILED` records a stable error code:
- `PREFLIGHT_ACTION_SCHEMA_VIOLATION`: Bot trả lời sai protocolVersion: phải trả lại đúng protocolVersion trong tin nhắn nhận được (hiện là 2).
- `PREFLIGHT_START_BOT_SPAWN_FAILED`: Bot khởi động không thành công (lỗi entrypoint, thiếu thư viện phụ thuộc, hoặc container thoát sớm).
- `PREFLIGHT_START_BOT_TIMEOUT`: Bot không gửi phản hồi khởi động trong giới hạn thời gian quy định.
- `PREFLIGHT_ACTION_BOT_TIMEOUT`: Bot không đưa ra nước đi hợp lệ trong thời gian quy định cho một lượt đi.
- `PREFLIGHT_ACTION_MALFORMED_JSON`: Bot xuất ra dòng tin nhắn không phải định dạng JSON hợp lệ.
- `PREFLIGHT_ACTION_MESSAGE_TOO_LARGE`: Kích thước tin nhắn của bot vượt quá giới hạn cho phép.
- `PREFLIGHT_ACTION_STDERR_LIMIT_EXCEEDED`: Dữ liệu ghi ra stderr vượt quá giới hạn tối đa.

An authenticated `TEAM_ACCOUNT` can list its own submissions with `GET /api/v1/submissions?page=1&pageSize=20`. The server derives `team_id` only from the session and returns newest-first `{ data: [{ id, status, archiveSha256, createdAt }], pagination: { page, pageSize, totalItems, totalPages } }`; it does not accept a team selector or expose object-storage keys. `page` defaults to 1 and is bounded to 100,000; `pageSize` defaults to 20 and is bounded to 100. Invalid pagination returns `400 INVALID_PAGINATION`. BTC accounts are forbidden from this team endpoint. `createdAt` is an ISO-8601 UTC timestamp.
