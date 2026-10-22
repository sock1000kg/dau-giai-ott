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

The local SVG favicon is served from `/favicon.svg` for development and container builds.

Theme initialization runs before React renders. The browser follows
`prefers-color-scheme` until the visitor explicitly selects light or dark;
that choice is stored as `ott-theme` and synchronized between open tabs. Shared
UI tokens live in `src/ui/ui.css`; feature pages can migrate their fixed colors
to these semantic tokens in their owning redesign tasks.

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

## UI conventions

- **Primitives.** Shared tokens and components live in `src/ui` (`Page`, `Card`, `Field`, `Input`/`Select`/`Textarea`, `Button`, `LinkButton`, `Table`, `Alert`, `Badge`, `AppNav`, `AppShellLayout`); see `src/ui/README.md`. Import from `src/ui/index.ts`.
- **One stylesheet per feature.** Each feature imports its own CSS file from the component that needs it. Do not add page rules to `app/styles.css`.
- **`app/styles.css` is globals only (plus the round-admin legacy rules).** It holds the reset and `:root`, `body`, `:focus-visible`, the reduced-motion rule, the app shell and header/footer (`.app-shell`, `.app-header`, `.app-footer`, `.brand`, `.brand-mark`, `.header-label`, `.eyebrow`, `.public-nav-link`) and the `/admin/rounds` page rules that have no feature stylesheet yet (`.admin-page`, `.welcome-copy`, `.round-*`, `.rule-set-*`, `.field-help`, and a few older shorthands such as `.results-controls`, `.results-pagination`, `.replay-state`, `.replay-player` that no component applies any more). Every other page's rules live in its per-feature CSS; put new page styles there, not in `styles.css`.
- **Class prefixes.** `ui-` shared primitives; `ops-` operations; `ra-` replay admin; `pub-` public pages (leaderboard, tournament); `results-` results; `submissions-` submissions; `auth-` login; `teams-` team provisioning. Prefix new classes with the feature's prefix.
- **Pages.** One `h1` per page (via `Page`, except pages that render their own `main`), one `main` landmark, every control labelled through `Field`, tables with a caption, dates in Vietnam time (`lib/format-date.ts`), shared button wording ("Làm mới", "Thử lại", "Trang trước", "Trang sau").
- **Adding a page.** Create `features/<name>/<Name>Page.tsx` using `Page`, add `<name>.css` for layout, register the route and role in `app/routes.tsx`, add a nav item in `ui/AppNav.tsx` if it needs one, add the row to the inventory below, and add the route to the matrix in `app/app-routes.test.tsx` (it checks landmarks, labels, ids, nav `aria-current`, console output and that every request is mocked in `test/route-fixtures.ts`).
- **Routed test.** `npm test --workspace @ott/platform-web -- app-routes` renders the whole app per role and path with one shared fetch router and the structural checker in `test/a11y-checks.ts`. It is a structural check, not a browser or screen-reader verification.

## Page inventory

| Route | Role | Component | Feature CSS | Owner task |
| --- | --- | --- | --- | --- |
| `/` (and `/login`) | anonymous | `features/auth/LoginPage.tsx` | `auth.css` | `P3-D15` |
| `/` | BTC, team | `features/home/HomePage.tsx` | `ui/ui.css` | `P3-D11` |
| `/public` | anyone | `features/public/PublicTournamentPage.tsx` | `public.css` | `P3-L05` |
| `/leaderboard` | anyone | `features/leaderboard/LeaderboardPage.tsx` | `leaderboard.css` | `P2-T22` |
| `/admin/teams` | BTC | `features/admin-teams/TeamProvisionPage.tsx` | `admin-teams.css` | `P3-D14` |
| `/admin/rounds` | BTC | `features/round-admin/RoundAdminPage.tsx` | none (round-admin rules remain in `app/styles.css`) | `P3-D02` / `P3-D02b` |
| `/admin/operations` | BTC | `features/operations/OperationsConsole.tsx` | `operations.css` | `P3-D12` |
| `/admin/results` | BTC | `features/results/MatchResultsPage.tsx` | `results.css` | `P3-D13` |
| `/admin/replays` | BTC | `features/replay-admin/ReplayCatalog.tsx` | `replay-admin.css` | `P2-T25` |
| `/admin/replays/:id/view`, `/team/replays/:id` | BTC, team | `pages/PrivateReplayPage.tsx` | `features/spectator/replay-player.css` | `P3-D21` |
| `/spectator/replays/:id` | anyone | `pages/SpectatorReplayPage.tsx` | `features/spectator/replay-player.css` | `P3-D21` |
| `/team/submissions` | team | `features/submissions/SubmissionForm.tsx` | `submissions.css` | `P2-T20` |
| `/team/results` | team | `features/results/MatchResultsPage.tsx` | `results.css` | `P3-D13` |

The operations console (`/admin/operations`) no longer shows cases ("Hồ sơ vụ việc"); the case API routes, tables and audit actions are still in the backend pending a product decision.

## Feature notes (API and behaviour)

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

The page is built from the shared `ui/*` primitives (`Page`, `Card`, `Field`, `Button`, `Alert`) with feature styles in
`features/admin-teams/admin-teams.css`: a "Tạo đội mới" card, a CSV import card, and a "Danh sách đội" card with a bordered
table (select-all header checkbox, `Đã chọn n/N` count, per-row reset). Behaviour, texts and the one-time credential rules are unchanged.

The BTC layout distinguishes single-team creation, CSV provisioning and the team directory with semantic accent rails.
At narrow viewports, the team table stays within its own horizontal scroll region; selection and bulk actions remain grouped
above it. No credential is included in the T50 screenshots or browser evidence. Browser capture details are recorded in
[`docs/validation/frontend-redesign/after-t50/`](../../../docs/validation/frontend-redesign/after-t50/).


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

The page is built from the `ui/*` primitives (`submissions.css` holds its layout):
an upload card and a history card side by side from 1024px, stacked below. The
history is a table (time in `Asia/Ho_Chi_Minh`, status badge, preflight position
shown only for `PREFLIGHT`). Upload and API behaviour are unchanged.

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

## Public tournament lists (`P3-D23`)

`/public` bounds the three long lists from the snapshot; the snapshot format and
publisher are unchanged. **Hàng đợi** keeps snapshot order and shows the first 10
rows; **Kết quả** is displayed newest first (the snapshot lists the newest last)
and shows the first 20 inside a scroll region (`max-height: 480px`). Both use
`ExpandableList`: "Xem thêm (n còn lại)" reveals 20 more per click and "Thu gọn"
returns to the first rows. **Bảng xếp hạng** shows the top 10 rows plus
"Hiển thị 10 / n đội" and the link to `/leaderboard`, which is unchanged. The
expanded count lives in the component, so it persists across the 30-second
snapshot refreshes and is clamped when a list shrinks.

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

The catalog summary and completed-match table have separate visual hierarchy. The table keeps a fixed minimum content width
inside the shared scroll region on mobile, preserving readable columns without widening the document. Publication states,
confirmation flow and API requests are unchanged. See the T50 browser captures and fixture manifest in
[`docs/validation/frontend-redesign/after-t50/`](../../../docs/validation/frontend-redesign/after-t50/).

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

The replay control bar also offers **Trình chiếu toàn màn hình**. Entering this
mode starts playback (or restarts it if the replay ended); browser Escape or the
exit button returns to the page. A replay with no `ACTION_APPLIED` event shows a
notice explaining why the pieces do not move. Fullscreen only enlarges recorded
events; it never starts bots or changes match data.

The replay board uses a dark, gapless 9×9 surface with coordinates inside the
edge cells, flag markers for map goals, terrain markers for obstacles, and
circular red/X and blue/O hand tokens. Token type remains available in each
piece's accessible name; the square label continues to announce coordinates,
goal ownership, and obstacles while playback preserves recorded positions.

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

### Catalog pickers (`P3-D26`)

The editor form (not the read-only current-rules copy) loads `GET /api/v1/admin/rounds/catalog`
(`getRoundCatalog`, strict parser in `api.ts`) with the other page data and turns engine version,
fault policy version and map rows into `ui/Select` pickers. Choosing a map fills `mapId` and
`checksum` from the catalog; the checksum field stays (read-only, full value in `title`). Maps
chosen in other rows are disabled and "Thêm map" is disabled once every catalog map is used. A
stored value missing from the catalog stays selected as "… (không còn trong danh mục)". If the
catalog request fails the page keeps the plain text inputs and shows a warning with
"Thử tải lại danh mục", which refetches only the catalog. The new server codes
`UNKNOWN_ENGINE_VERSION`, `UNKNOWN_MAP`, `UNKNOWN_FAULT_POLICY`, `MAX_TURNS_EXCEEDS_RUNNER_LIMIT`
and `TURN_LIMIT_EXCEEDS_RUNNER_LIMIT` show Vietnamese messages on their field. The endpoint
exists only once `P3-D25` is merged; the form state shape and the saved rules JSON are unchanged.

### Round admin UX (`P3-D02b`)

- The page is a two-column grid at ≥1024px: left "Bộ luật hiện hành" (collapsible
  `<details>`, bounded height) plus the version archive, right "Phiên bản bộ luật mới"
  (editor). "Current" is the rule set of the round with the highest `roundNumber` that has a
  `ruleSetId` and left `DRAFT_RULES` (`current-rule-set.ts`); with none, the latest version is shown
  read-only. `RoundRuleForm` takes an `idPrefix` (`rrc` for the read-only copy) so DOM ids never repeat.
- `RuleSetArchive` lists all versions newest first with usage badges (rounds whose `ruleSetId`
  matches), loads `GET /api/v1/admin/round-rule-sets/:id` on selection and shows engine version and
  each map's id + checksum read-only (map content is not stored in rules). "Dùng làm cơ sở cho phiên
  bản mới" remounts the editor from that version.
- Every form control has a one-line help (`field-help.ts`, `FIELD_HELP`) wired with
  `aria-describedby="{id}-help {id}-error"`. Ranges come from the API validator (`rounds/types.ts`).
- The reconcile button is labelled "Kiểm tra và chốt kết quả round" with an explanatory help line.
- Current rules and the new-version editor use separate semantic-surface panels, with accent rails for the editable
  version and round operations. Narrow screens keep the panels and confirmation actions within the viewport; the form
  submit action spans the available width at 520px and below. Round styles use semantic theme tokens for fields,
  errors, archives and operation states. API, allowed actions, idempotency and confirmation behavior are unchanged.
- Browser evidence for the T51 theme/layout pass is recorded in
  [`docs/validation/frontend-redesign/after-t51/`](../../../docs/validation/frontend-redesign/after-t51/).

## Privileged operations console (`P3-D07`)

BTC operators open `/admin/operations` (workspace link "Vận hành đặc quyền", BTC only; team accounts get
the access-denied page). `features/operations/OperationsConsole.tsx` composes:

- privileged actions (suspend/unsuspend team, revoke submission, cancel and rerun match). Each needs a
  target and a reason, a public reason for cancel/rerun and an explicit infra-failure checkbox for rerun;
  "Xem lại thao tác" opens a confirm step, and one `crypto.randomUUID()` idempotency key per confirmed
  action is sent with a fresh `X-Correlation-Id`. Repeated clicks while a request is in flight send nothing.
- cases are no longer in the UI (removed in `P3-D24`; the backend routes, tables and audit actions remain, pending a decision).
- an audit viewer with action/target filters and the public queue-override list.

`P3-D12` restyles the page with the `ui/*` primitives (three cards, `Field`/`Textarea` with `n/500` counters,
bordered tables with empty states, badges, alerts) and replaces pasted UUIDs with entity pickers. Teams come from
`GET /api/v1/admin/teams` (loaded once, filterable by name) and matches from `GET /api/v1/results/matches`
(server-side `teamId`/`stage` filters, FAILED only for cancel/rerun). Every picker keeps a "Nhập mã thủ công"
UUID field. API gaps: the match list never returns SCHEDULED matches (cancel of a SCHEDULED match needs the manual
id) and `GET /api/v1/submissions` is TEAM_ACCOUNT-only, so revoke takes a manual submission id.
The confirm step shows the target name + short id, moves focus to its heading and returns focus to
"Xem lại thao tác" on cancel. Tests: `operations.test.tsx`, `operations.pickers.test.tsx`,
`operations.layout.test.tsx` (shared mocks in `operations.testkit.tsx`).

The T52 layout assigns a visible top rule to privileged actions and separate status rails to audit/queue review
panels; wide tables scroll inside their own region on mobile. Confirmation stays grouped and visibly marked as a
dangerous step. Operation semantics and API calls are unchanged. Browser screenshots and fixtures are recorded in
[`docs/validation/frontend-redesign/after-t52/`](../../../docs/validation/frontend-redesign/after-t52/).

The public tournament page (`/public`) shows "Hàng đợi" and "Kết quả" as equal panels: one `--pub-panel-height` cap
(`clamp(420px, 70vh, 640px)`) at ≥ 1024px, both columns stretch to the same bottom edge and each list scrolls inside its
card (`ExpandableList` `fill`); below 1024px each list region is capped at 360px. Wait times read "Dự kiến chờ ~N phút/giờ"
(`features/public/format-wait.ts`). Heights are CSS-only and not verified in a browser.

Server error codes are mapped to stable Vietnamese messages (`operationsErrorMessage` in `api.ts`); server
text is never displayed. Verification: `npm test --workspace @ott/platform-web -- operations`.

## Results page (`P3-D13`)

`/admin/results` and `/team/results` (`features/results`) use the `ui/*` primitives with styles in `features/results/results.css`.
Filters are `Select`s: kind, team (BTC only) and **Vòng/stage**, a dropdown with "Tất cả vòng", `QUALIFICATION`, `FINALS` (`stages.ts`) plus any other stage seen in loaded results, so a free-form stage is never un-selectable. Changing a filter resets to page 1; "Tất cả vòng" sends no `stage` query parameter.
Matches and series render as bordered tables (horizontal scroll inside the table container on narrow screens). The result table wrapper can shrink within the page grid so long rows do not widen the whole document; the count and pagination have distinct separators. Status, reason and cancellation codes get Vietnamese labels in `labels.ts` (unknown codes show the raw code); dates are shown in `Asia/Ho_Chi_Minh`. Replay links stay FINALIZED-only. T52 screenshots and synthetic fixture details are recorded in [`docs/validation/frontend-redesign/after-t52/`](../../../docs/validation/frontend-redesign/after-t52/).

## Login and MFA screens (`P3-D15`)

`features/auth/LoginPage.tsx` renders the password and 2-step screens with the `ui/*` primitives and `auth.css`, outside `AppShellLayout`. API calls and error mapping are unchanged. The password step has a "Hiện mật khẩu" toggle (`aria-pressed`, resets to hidden when MFA starts). When MFA starts the password is cleared from state; "Quay lại" returns to the password step and clears codes and errors. Nothing credential-like is stored in browser storage.
