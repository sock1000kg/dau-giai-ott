# OCI Submission v1

A team uploads exactly one `application/octet-stream` OCI Image Spec 1.1 image in an OCI Image Layout tar archive to `POST /api/v1/submissions`. The layout marker is `imageLayoutVersion: 1.0.0`. Identity comes only from its authenticated session; the request has no team ID, language, command, tag, registry URL or Dockerfile fields.

The server quarantines then structurally validates the archive using the locked OCI validator. A successful upload records immutable archive, manifest and config digests with policy `P2_BASELINE_V1` and status `PREFLIGHT`. Only the isolated P2-T10 sandbox preflight may subsequently promote it to `VALID` and `ACTIVE`.

An authenticated `TEAM_ACCOUNT` can list its own submissions with `GET /api/v1/submissions?page=1&pageSize=20`. The server derives `team_id` only from the session and returns newest-first `{ data: [{ id, status, archiveSha256, createdAt }], pagination: { page, pageSize, totalItems, totalPages } }`; it does not accept a team selector or expose object-storage keys. `page` defaults to 1 and is bounded to 100,000; `pageSize` defaults to 20 and is bounded to 100. Invalid pagination returns `400 INVALID_PAGINATION`. BTC accounts are forbidden from this team endpoint. `createdAt` is an ISO-8601 UTC timestamp.
