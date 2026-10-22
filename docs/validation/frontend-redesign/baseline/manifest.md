# Frontend redesign baseline

- Source: `053ec96` (`main` after merge of PR #60; application source is unchanged from the previous baseline commit).
- Capture date: 2026-10-22 (Asia/Ho_Chi_Minh).
- Browser: Chromium via `chrome-devtools-mcp@1.11.0`, headless, isolated temporary profile.
- Local Vite: `http://127.0.0.1:5174`; viewport is recorded in each filename.
- Public fixture: `docs/contracts/fixtures/public-snapshot-v1.json`, published with the project snapshot CLI to `src/platform/web/public/snapshots/`; the checked-in fixture is illustrative and marked stale by its 2026-10-18 timestamp.
- The demo API `/api/v1/health/live` returned HTTP 200. Public data is intentionally served from the local static fixture because this deployment's `/snapshots/latest.json` returned 404.
- Team/BTC screenshots were refreshed on 2026-10-22 using the isolated demo API through a temporary Vite proxy. Credentials were read from mode-0600 `.local/demo/accounts.csv` by the local browser runner, entered through accessible form controls, and never printed or saved in screenshots. The temporary proxy config and credential copy are excluded from git.
- Accessibility tree was captured for each route with MCP. The public route used a local static snapshot fixture. Team/BTC login initially receives the expected unauthenticated session response before successful demo login. Replay showed its unsupported-replay error state because the local demo has no static public replay fixture. No credential-bearing response or persistent network log was retained.
- Full-page captures can exceed viewport height. `390x844` names describe the browser viewport, while PNG dimensions reflect full-page output. Public page expands to 788px because of horizontal overflow and is marked for the redesign to fix.

The HTML mockup at [`../mockup-preview.html`](../mockup-preview.html) covers public tournament, team submission, and BTC operations in both candidate palettes. Its Go photo is documented in [`../ASSETS.md`](../ASSETS.md). The owner approved this visual direction in chat on 2026-10-22 before implementation began.

## Captures

| Route and state | Desktop 1440×900 | Mobile 390×844 |
| --- | --- | --- |
| Public / dark | `public-anon-dark-1440x900.png` | `public-anon-dark-390x844.png` |
| Public / light | `public-anon-light-1440x900.png` | — |
| Leaderboard / dark | `leaderboard-anon-dark-1440x900.png` | `leaderboard-anon-dark-390x844.png` |
| Finals / dark | `finals-anon-dark-1440x900.png` | `finals-anon-dark-390x844.png` |
| Login / dark | `login-anon-dark-1440x900.png` | `login-anon-dark-390x844.png` |
| Login / light | `login-anon-light-1440x900.png` | — |
| Team submissions / authenticated demo team | `team-submissions-team-auth-dark-1440x900.png` | `team-submissions-team-auth-dark-390x844.png` |
| BTC teams / authenticated demo BTC | `admin-teams-btc-auth-dark-1440x900.png` | `admin-teams-btc-auth-dark-390x844.png` |
| Public replay / unsupported demo replay | `spectator-replays-33333333-3333-4333-8333-333333333333-anon-dark-1440x900.png` | `spectator-replays-33333333-3333-4333-8333-333333333333-anon-dark-390x844.png` |

## Initial observations

- The shared public header occupies a large horizontal band; on 390px the full-page capture expands to 788px wide because content overflows the viewport.
- Public content uses compact status labels and equally weighted panels; the first viewport does not establish a strong primary action or tournament overview.
- Public test fixture has no results; the page falls into empty result states and labels stale editorial data.
- The app currently has a dark-only visual system; the browser's light emulation does not produce a light appearance.
- Authenticated team/BTC screenshots show role navigation and forms. Replay remains an unsupported demo error state.
