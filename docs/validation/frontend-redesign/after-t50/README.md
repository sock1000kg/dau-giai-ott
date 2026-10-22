# P2-T50 browser evidence

Captured from the T50 task branch at base `af05242` using isolated headless Chrome and synthetic API fixtures. No server data or credentials were used.

| Route | Mode | Viewport | Fixture and checks |
| --- | --- | --- | --- |
| `/admin/teams` | Light | 390×844 | Empty directory; document width 390; no credential rendered |
| `/admin/teams` | Dark | 390×844 | Two synthetic teams; table scrolls inside 306px region (700px content); document width 390; no credential rendered |
| `/admin/teams` | Dark | 1440×900 | Empty directory; desktop layout |
| `/admin/replays` | Dark | 390×844 | One synthetic staged replay; table scrolls inside 338px region (920px content); document width 390 |
| `/admin/replays` | Light | 1440×900 | One synthetic staged replay; document width 1440 |

All route data used fictional names, `.test` email addresses and an inert checksum. No create, reset, import, publish or credential-returning action was triggered. No JavaScript errors or warnings were reported. Chrome recorded one `GET /favicon.ico` 404 from the Vite dev server; API fixture requests returned the expected role and catalog data.

Focused verification: admin-teams and replay-admin tests, 41/41; web typecheck and production build passed.
