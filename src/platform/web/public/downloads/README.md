# Public bot resources

`ott-bot-resources-v1/` is the reviewable source of the bundle served at:

```text
/downloads/ott-bot-resources-v1.zip
```

The copied files come from these authoritative project paths:

- `docs/contracts/bot-protocol-v2.{md,schema.json}`
- `docs/contracts/fixtures/bot-protocol-v2-valid.ndjson`
- `docs/contracts/oci-submission-v1.md`
- `src/bots/python/`
- `src/bots/oci-fixtures/{v2-action,native-action}/`
- `src/bots/starter-kits/README.md`

When one of those sources changes, update the reviewable directory and rebuild the ZIP from inside it:

```bash
zip -X -q -r -FS ../ott-bot-resources-v1.zip .
```

Do not put round-specific time, memory or upload limits in this bundle. Those values remain in the current
round rules shown on `/public` so teams do not rely on a stale downloaded copy.

## Pre-built demo bot (`ott-demo-bot-go-v1.oci.tar`)

`ott-demo-bot-go-v1.oci.tar` is a ready-to-submit, pre-built OCI Image Layout bot archive served at:

```text
/downloads/ott-demo-bot-go-v1.oci.tar
```

- **Behavior**: Minimal Go bot compiled from fixture `src/bots/oci-fixtures/demo-bot-go` (`bot.go`). On each turn, it reads a `STATE_UPDATE` JSON line from stdin, echoes `protocolVersion` (defaulting to 1 if omitted), and responds with an `ACTION` message playing the first legal move (`legalActions[0]`). Works with Bot Protocol v1 and v2.
- **Archive size**: 829,440 bytes (~810 KiB uncompressed tar).
- **SHA-256**: `80d1dd7d9fb46f3c2a4779f0a62cc7ee0d6a3ce4b741df026adbb7bf6109b4e6` (checksum file: `/downloads/ott-demo-bot-go-v1.oci.tar.sha256`).
- **Submission**: Teams can upload this archive directly on `/submissions` as their initial bot, or select it in test runs to test against opponents or self-play immediately.
