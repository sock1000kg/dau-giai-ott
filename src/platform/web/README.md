# `@ott/platform-web`

React/Vite browser client for the Phase 2 platform. The app uses the locked
Platform Authentication Contract v1 at same-origin `/api/v1/auth/*` and sends
`credentials: include` so the browser carries the opaque `ott_session` cookie.
The client keeps the resolved principal in memory only; it never stores the
session token, accepts a client-selected role/team, or offers registration or
self-service password reset.

UI route checks are for navigation and user feedback only. API authorization
remains authoritative. Session restoration gates the page before any
role-specific area is rendered; a `401` returns to the login form, while a
session-check network/server error keeps private content hidden and offers a
retry.

From the repository root:

```bash
npm run dev --workspace @ott/platform-web
npm test --workspace @ott/platform-web
npm run typecheck --workspace @ott/platform-web
npm run build --workspace @ott/platform-web
```

The browser host must route `/api/v1` to the platform API on the same origin.
Production secrets and API credentials must never be embedded in the Vite
client bundle.

## BTC team provisioning (`P2-T19`)

The BTC-only screen uses the existing `P2-T06` routes: `GET /api/v1/admin/teams`,
`POST /api/v1/admin/teams` with only `{ name }`, and
`POST /api/v1/admin/teams/:id/reset-credential`. The server remains responsible
for role checks, account creation, password generation/hashing and session
revocation. The create/reset response credential is held in React memory only;
the screen clears it when dismissed or when the page is left, and it is never
written to storage or logs. The BTC operator must send it to the team through a
separate private channel.

## Team submission portal (`P2-T20`)

Signed-in teams open `/team/submissions` to upload one `.tar` OCI archive and
review their submission statuses. The browser sends the raw file as
`application/octet-stream` to `POST /api/v1/submissions`, with the session
cookie; it does not send team identity or build/runtime metadata. The upload
form validates empty/oversized/non-tar files, reports transfer progress, and
prevents duplicate submissions while an upload is in flight. OCI archive
structure remains validated by the API, not by browser checks.

The history is loaded from the paginated `GET /api/v1/submissions`, whose API
derives the team scope from the authenticated session and returns only
submission ID, status, archive digest, and creation time. The list omits object
keys and does not accept a team selector. API role checks remain authoritative;
the portal does not persist session credentials or submission data in browser
storage.

## Public leaderboard (`P2-T22`)

Anyone can open `/leaderboard` without a team/BTC session. The page reads
`GET /api/v1/leaderboard?stage=QUALIFICATION&page=1&pageSize=25` and displays
the server's rank, Elo, head-to-head points, series record, win rate, fault and
forfeit counts, and update time. It never recalculates rank or tie-breaks;
rows with `tieBreakStatus: "BTC_REQUIRED"` retain the server rank and call out
that BTC decision is required. Stage and page controls request new server pages;
the responsive table can scroll horizontally on narrow screens. Only the API's
public entry fields are mapped into the page; private seeds and artifact keys
are not rendered.

## BTC replay publication console (`P2-T25`)

BTC operators open `/admin/replays` to browse paginated terminal matches from
`GET /api/v1/admin/replays/catalog`. The page shows the server publication
state and stored event-log checksum, but never an object key or seed. `PRIVATE`
replays can be staged and `STAGED` replays can be published through the T24
admin routes. Each transition requires an explicit confirmation and a reason;
the client sends a stable `Idempotency-Key` for a retry, locks the action while
in flight, then reconciles the row from the server catalog. UI role checks only
control navigation; API authorization remains authoritative. The console is
strictly post-match and has no live match controls.

Verification: `npm test --workspace @ott/platform-web -- replay-admin`,
`npm run typecheck --workspace @ott/platform-web`, and
`npm run build --workspace @ott/platform-web`.
