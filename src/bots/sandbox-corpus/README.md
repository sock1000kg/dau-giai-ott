# Sandbox corpus

This corpus declares trusted OCI fixtures for sandbox verification only. It contains Phase 1 Python canaries, a Node.js canary, a static Go native canary, and fault images. Build context is repository root so Python canaries use Phase 1 bots. `npm --workspace @ott/sandbox-corpus run build:corpus` builds `linux/amd64` images and exports OCI archives under the ignored `artifacts/` directory, then records each archive, manifest and config digest in `manifest.json`. Rebuilds update those digests when base images or source change.

Expected outcomes are security assertions for P2-T10/P2-T15. Fault images are untrusted test input: import and run them only through the sandbox harness with resource and network limits. They are never a team submission interface.
