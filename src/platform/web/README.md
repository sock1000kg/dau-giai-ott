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

## BTC team provisioning (`P2-T19`, `P3-D04`)

The BTC-only screen uses `GET /api/v1/admin/teams`, `POST /api/v1/admin/teams` with only `{ name }`,
`POST /api/v1/admin/teams/:id/reset-credential`, and `P3-D04` bulk endpoints:
`POST /api/v1/admin/teams/bulk-import` and `POST /api/v1/admin/teams/bulk-reset`.
The server remains responsible for role checks, account creation, password generation/hashing and session
revocation. For single team creation/reset, credentials are held in React memory only and cleared on dismiss or navigation.
For bulk operations (`BulkProvision`), the client uploads a CSV file (`File.text()`) and receives a one-time credential file
as a `Blob`. The client triggers an immediate download using a temporary object URL and revokes it immediately;
plaintext credentials never enter React state or the DOM. If the file is invalid or contains collisions, a row-error table is displayed.
Bulk reset allows selecting multiple teams, requires explicit confirmation naming the count, revokes active sessions,
and downloads the updated credentials. The team list also displays `representativeEmail` (or "—").


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

## Spectator replay verification (`P2-T26`)

The public client requests `/api/v1/public/replays/:matchId` without session
credentials. It checks the exact v1 media type and `X-Replay-SHA256`, hashes
the unmodified response bytes (including the contract's final newline), and
only then decodes/parses the body. Unsupported schema, checksum mismatch,
private/not-found, malformed replay and network failures use stable client
error codes. The parser returns a typed allowlisted model and drops unrecognized
fields; the replay player must receive this verified model rather than raw JSON.

Verification: `npm test --workspace @ott/platform-web -- verify-replay` and
`npm run typecheck --workspace @ott/platform-web`.

## Public spectator replay player (`P2-T27`)

Anyone can open `/spectator/replays/:matchId` without starting a team/BTC
session. The page fetches only the public artifact through the T26 verifier,
then builds a read-only board timeline from the verified map and recorded
events. It offers play/pause, previous/next, direct seek, restart and 0.5x/1x/2x
playback. At the last event playback stops deterministically. The UI does not
open a live socket, issue game commands, or infer team names not present in the
public replay contract; participants are shown as sides X and O.

The event projection checks that each entry's first event matches its recorded
input and that the terminal event agrees with the public result. It is a
presentation projection, not a second authoritative game engine; the API's
published replay and checksum remain the data source. The board is responsive,
keyboard-operable, and uses table captions, labeled controls, focus indicators,
and live playback status.

Verification: `npm test --workspace @ott/platform-web -- ReplayPlayer`,
`npm run typecheck --workspace @ott/platform-web`,
`npm run build --workspace @ott/platform-web`, and root `npm test`,
`npm run typecheck`, `npm run build`.

## Admin round-rule and operations console (`P3-D02`)

BTC operators open `/admin/rounds` (BTC workspace link "Vận hành round", same
route gating as `/admin/replays`). The stage selector defaults to
`QUALIFICATION`. The page composes `features/round-admin/*`:

- `RoundRuleForm` covers timing/resource/game/schedule/test-run fields with
  visible labels, prefills the latest rule-set version of the stage (or the
  approved defaults when none exists), and maps server `details[]`
  (`{ path, code }`) to the matching field with `aria-invalid`/`aria-describedby`;
  unknown paths are listed in a `role="alert"` summary. A rule set locked into
  a non-draft round renders read-only with no save button.
- `RoundOperations` renders action buttons only from the server's
  `allowedActions`, asks for a reason (except reconcile), and reconciles from
  the server after every transition. Starting a round needs a two-step
  confirmation (reason + typed round number) with one `crypto.randomUUID()`
  idempotency key per confirmation.
- The worst-case estimate (`estimate.ts`) uses `series = floor(T/2)`,
  `games = 2·series`, `worstMs = ceil(games / C) · matchWallClockMs`; the team
  count defaults to `GET /api/v1/admin/teams` and concurrency defaults to 4,
  which is an assumption — worker capacity is not yet measured (`P3-N02`).
  An estimate beyond `runMaxHours` blocks saving until the operator checks
  the explicit acknowledgement.

Verification: `npm test --workspace @ott/platform-web -- RoundAdmin`,
`npm run typecheck --workspace @ott/platform-web`, plus desktop/mobile
browser smoke and keyboard tab order over the form and start confirmation.

## Privileged operations console (`P3-D07`)

BTC operators open `/admin/operations` (workspace link "Vận hành đặc quyền", BTC only; team accounts get
the access-denied page). `features/operations/OperationsConsole.tsx` composes:

- privileged actions (suspend/unsuspend team, revoke submission, cancel and rerun match). Each needs a
  target and a reason, a public reason for cancel/rerun and an explicit infra-failure checkbox for rerun;
  "Xem lại thao tác" opens a confirm step, and one `crypto.randomUUID()` idempotency key per confirmed
  action is sent with a fresh `X-Correlation-Id`. Repeated clicks while a request is in flight send nothing.
- cases: open, list, detail with the append-only event list, and evidence/status/decision forms that
  require a reason.
- an audit viewer with action/target filters and the public queue-override list.

Server error codes are mapped to stable Vietnamese messages (`operationsErrorMessage` in `api.ts`); server
text is never displayed. Verification: `npm test --workspace @ott/platform-web -- operations`.

## UI conventions

Shared design tokens and components live in `src/ui` (see `src/ui/README.md`). New pages use the `ui-*` primitives plus a per-feature stylesheet; do not add page-level rules to `app/styles.css`. Authenticated pages are wrapped by `AppShellLayout` (navigation, skip link, `#main`).
