# Restore Đạt's Finals UI — release manifest

Date: 2026-10-26 (web-only release; no Finals source change).

## Source
- Source: `origin/main` @ `ddc4454666a934de86cb4b8fb7c51121b2680056`, clean worktree.
- Gate: `git diff 94a4791 origin/main -- src/platform/web/src/features/finals src/platform/web/src/app/styles.css` is empty; `94a4791` is an ancestor of `main`.
- Local checks: web typecheck pass; 473 web tests pass; Vite build pass.
- Built asset: `index-D_o2DNr8.js`, SHA-256 `1cd434596e8f7becaa1784fe6b2e18ab7624cae7b64515342c7898faada9d316` (identical in the image and as served by the host).

## Images (host `jump-jits`)
| Role | Reference | ID |
|---|---|---|
| Target (immutable) | `ott-web:datpt-finals-94a4791-main-ddc4454` (also `ott-web:local`) | `sha256:1ab1281ae798ea09a41cbf958dd018b0334f9728594a44355fb3796ee4da7963` |
| Rollback (web) | `ott-web:rollback-pre-finals-restore` | `sha256:750cb9b3efe2b0de721e562a84dcb8bad814f59719d79640bef82041358aeefb` |
| Previous `ott-web:local` | `ott-web:pre-finals-restore-local-ffd32d5` | `sha256:ffd32d5ba92cca112171a28d34e1552f82a31703093e35c4d32f2e4806364e22` |

Deviation: the live container's original image `sha256:7762d1ec…` was no longer in the containerd content store, so `docker tag`/`docker commit` failed. The rollback image was produced with `docker export | docker import`, restoring USER 101, ENTRYPOINT, CMD, EXPOSE and the `API_UPSTREAM`/`NGINX_ENVSUBST_FILTER`/`PATH`/`NGINX_VERSION` env. Its healthcheck was not restored (Compose supplies its own). This rollback image has not been run.

## Deployment
- Release dir: `/opt/ott/releases/ddc4454-datpt-finals`; image smoke: UID 101, `/healthz` ok.
- Only `ott-demo-web-1` recreated (`9acbd24f3a15` → `7942754688d3`, started 2026-10-26T14:24:00Z, healthy), via `compose up -d --no-deps --force-recreate --no-build web`.
- Non-web containers unchanged: api `c82a7950ca2e`, coordinator `08757fa1c8bf`, postgres `dceb711842b9`, redis `2e87f0569950`, seaweedfs `60da24f83ed0`, worker `1d742b42e321`.

## Verification (host port 8080, via SSH tunnel)
- `/healthz` 200, `/finals` 200; the page loads `index-D_o2DNr8.js`.
- `/api/v1/public/finals/snapshot`: proof `VERIFIED`, 8 standings, 8 bracket entries.
- Browser: Finals headings, bracket and BO3 sections render; 20 replay links; no `role=alert`; no console errors/warnings.
- Screenshots: `finals-dark-1440x900.png`, `finals-light-390x844.png`.

## Public domain verification (`https://ott-frontend.d-thuand.party`)
- `/healthz`, `/finals`, `/api/v1/public/finals/snapshot` all 200; `/finals` loads `index-D_o2DNr8.js` and `index-Bs7qKj8x.css`.
- Asset served at the domain: SHA-256 `1cd434596e8f7becaa1784fe6b2e18ab7624cae7b64515342c7898faada9d316` (matches the image).
- Snapshot via domain: proof `VERIFIED`, 8 standings, 8 bracket entries.
- Browser (dark 1440x900): 32 table rows, 20 replay links, no alert, no console errors.
- Replay `/spectator/replays/00000000-0000-4000-8000-000000000101?bundle=demo-finals-bundle-2026` renders ("Xem lại trận", teams, no alert); `GET /api/v1/public/result-bundles/demo-finals-bundle-2026` and its replay endpoint return 200 via curl.
- Caveat: several earlier browser loads from the verifying machine hung or failed with `net::ERR_NETWORK_CHANGED` (client-side network change on that machine; the stuck snapshot fetch and the replay error both cleared on reload). Repeated `curl` requests were stable (200, ~0.2-1.6 s). Not reproduced after reload, so no server fault was found, but intermittent public-path failures were not ruled out.

## Not verified
- Light/mobile and dark/desktop screenshots were taken via the host port tunnel, not the public domain.
- Network failures were checked via console and request lists only on the final passing loads.

## Rollback
`docker tag ott-web:rollback-pre-finals-restore ott-web:local` then recreate only `web` with the same compose command.
