# Public bot resources

`ott-bot-resources-v1/` is the reviewable source of the bundle served at:

```text
/downloads/ott-bot-resources-v1.zip
```

The copied files come from these authoritative project paths:

- `docs/contracts/bot-protocol-v1.{md,schema.json}`
- `docs/contracts/bot-protocol-v2.{md,schema.json}`
- `docs/contracts/fixtures/bot-protocol-v{1,2}-valid.ndjson`
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
