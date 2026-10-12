# OCI Submission v1

A team uploads exactly one `application/octet-stream` OCI Image Layout v1.1 tar archive to `POST /api/v1/submissions`. Identity comes only from its authenticated session; the request has no team ID, language, command, tag, registry URL or Dockerfile fields.

The server quarantines then structurally validates the archive using the locked OCI validator. A successful upload records immutable archive, manifest and config digests with policy `P2_BASELINE_V1` and status `PREFLIGHT`. Only the isolated P2-T10 sandbox preflight may subsequently promote it to `VALID` and `ACTIVE`.
