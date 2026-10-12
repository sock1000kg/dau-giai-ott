# OCI fixtures

`P2-T14` constructs its valid structural OCI archive from the current
`src/bots/python/first_legal_bot.py` source during tests. This proves the
language-neutral contract can contain the existing deterministic Python bot
without requiring Docker or a registry.

Trusted Dockerfiles and persisted good/bad OCI archives belong to `P2-T08`.
They must not be treated as a team submission interface: teams upload only the
finished OCI layout archive defined in `docs/contracts/oci-submission-v1.md`.
