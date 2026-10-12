# OCI Submission Contract v1

> **Status:** Locked for `P2-T14`.
>
> **Scope:** Structural validation before storage promotion or sandbox execution.

## Accepted artifact

The sole submission file is an uncompressed `bot.oci.tar` containing an OCI Image
Layout v1.1. It must have `oci-layout`, `index.json`, and content-addressed
`blobs/sha256/<digest>` entries. The index resolves to exactly one
`linux/amd64` manifest, its config, and local layers. The derived config must
contain a non-empty string-array `Entrypoint`.

The API does not accept `language`, `command`, `entrypoint`, `runtime`, tag,
registry URL, Dockerfile, build context, or client-controlled `teamId` as part
of this artifact contract.

## Derived immutable identity

The structural validator returns and later persistence stores:

- `artifactKind = OCI_IMAGE_LAYOUT_V1`
- `archiveSha256`, `archiveBytes`, `uncompressedBytes`
- `ociManifestDigest`, `ociConfigDigest`
- `platform = linux/amd64`
- `entrypoint`, derived only from OCI config

`P2-T07` adds streaming/quarantine storage and `P2-T10` adds runtime preflight;
neither may substitute a tag or caller-supplied command for this identity.

## Stable validation codes

| Code | Meaning |
| --- | --- |
| `ARCHIVE_TOO_LARGE` / `ARCHIVE_UNCOMPRESSED_TOO_LARGE` | Archive or expanded tar content exceeds policy. |
| `ARCHIVE_TAR_INVALID` | Truncated/corrupt tar header or checksum. |
| `ARCHIVE_PATH_INVALID` | Absolute, traversal, empty or backslash path. |
| `ARCHIVE_ENTRY_UNSUPPORTED` | Link, device, FIFO or other non-regular tar entry. |
| `ARCHIVE_DUPLICATE_PATH` | Archive declares a path more than once. |
| `OCI_LAYOUT_INVALID` / `OCI_INDEX_INVALID` | Required OCI layout metadata is missing or malformed. |
| `OCI_MULTI_PLATFORM` / `OCI_PLATFORM_UNSUPPORTED` | More than one manifest, or anything other than `linux/amd64`. |
| `OCI_BLOB_MISSING` / `OCI_DIGEST_MISMATCH` | Descriptor target is absent, wrong-size or has the wrong SHA-256. |
| `OCI_MANIFEST_INVALID` / `OCI_FOREIGN_LAYER` | Invalid manifest, external layer URL, or unsupported layer media type. |
| `OCI_CONFIG_INVALID` / `OCI_ENTRYPOINT_MISSING` | Invalid config, or no usable OCI `Entrypoint`. |

## Limits and execution boundary

Callers supply the archive and uncompressed limits from the versioned stage
policy. The validator is pure: it does not extract files, invoke Docker, access
the network, or import an image. The sandbox keeps enforcing the runtime policy
in the OCI SAD.
