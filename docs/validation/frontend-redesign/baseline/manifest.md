# Frontend redesign baseline

- Source: `1c4e48c` (`main` after merging the frontend redesign plan).
- Capture date: 2026-10-22 (Asia/Ho_Chi_Minh).
- Browser: Chromium via `chrome-devtools-mcp@1.11.0`, headless, isolated temporary profile.
- Local Vite: `http://127.0.0.1:5174`; viewport is recorded in each filename.
- Public fixture: `docs/contracts/fixtures/public-snapshot-v1.json`, published with the project snapshot CLI to `src/platform/web/public/snapshots/`; the checked-in fixture is illustrative and marked stale by its 2026-10-18 timestamp.
- The demo API `/api/v1/health/live` returned HTTP 200. Public data is intentionally served from the local static fixture because this deployment's `/snapshots/latest.json` returned 404.
- Role-specific paths were opened without signing in. The team/BTC captures therefore document the anonymous authentication gate, not authenticated UI. No credentials were entered or included in evidence.
- Accessibility tree was captured for each route with MCP. The initial public page made an aborted first request (404) while Vite started, then received the fixture pointer (304) and immutable snapshot (200); login requested `/api/v1/auth/session` (200/304). Final login capture had no console messages. The replay route showed its unsupported-replay error state. No persistent network log export was retained.
- Full-page captures can exceed viewport height. `390x844` names describe the browser viewport, while PNG dimensions reflect full-page output. Public page expands to 788px because of horizontal overflow and is marked for the redesign to fix.

A first HTML visual direction mockup is available at [`../mockup-preview.html`](../mockup-preview.html). It demonstrates the public hero/status/card hierarchy in two candidate palettes and uses the demo Go photo documented in [`../ASSETS.md`](../ASSETS.md); it is not approval for implementation. Team, BTC, login and replay mockups remain to be reviewed/added.

## Captures

| Route and state | Desktop 1440×900 | Mobile 390×844 |
| --- | --- | --- |
| Public / dark | `public-anon-dark-1440x900.png` | `public-anon-dark-390x844.png` |
| Public / light | `public-anon-light-1440x900.png` | — |
| Leaderboard / dark | `leaderboard-anon-dark-1440x900.png` | `leaderboard-anon-dark-390x844.png` |
| Finals / dark | `finals-anon-dark-1440x900.png` | `finals-anon-dark-390x844.png` |
| Login / dark | `login-anon-dark-1440x900.png` | `login-anon-dark-390x844.png` |
| Login / light | `login-anon-light-1440x900.png` | — |
| Team submissions / anonymous auth gate | `team-submissions-team-dark-1440x900.png` | `team-submissions-team-dark-390x844.png` |
| BTC teams / anonymous auth gate | `admin-teams-btc-dark-1440x900.png` | `admin-teams-btc-dark-390x844.png` |
| BTC rounds / anonymous auth gate | `admin-rounds-btc-dark-1440x900.png` | — |
| Public replay / unsupported demo replay | `spectator-replays-33333333-3333-4333-8333-333333333333-anon-dark-1440x900.png` | `spectator-replays-33333333-3333-4333-8333-333333333333-anon-dark-390x844.png` |

## Initial observations

- The shared public header occupies a large horizontal band; on 390px the full-page capture expands to 788px wide because content overflows the viewport.
- Public content uses compact status labels and equally weighted panels; the first viewport does not establish a strong primary action or tournament overview.
- Public test fixture has no results; the page falls into empty result states and labels stale editorial data.
- The app currently has a dark-only visual system; the browser's light emulation does not produce a light appearance.
- Anonymous auth-gated routes are consistent but reveal no information about role-specific navigation or forms.
