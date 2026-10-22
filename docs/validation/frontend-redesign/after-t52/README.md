# P2-T52 browser evidence

Screenshots use synthetic API fixtures with no server data or privileged action submissions. Routes were rendered in both themes at 390×844 and 1440×900.

| Route | Checks |
| --- | --- |
| `/admin/operations` | Privileged action, audit, queue override and flagged-submission panels; named regions and controls in accessibility tree; wide tables scroll inside their panel |
| `/admin/results` | BTC filters, match result row, result count and pagination; match table scrolls inside its frame |

Mobile browser checks reported a 390px document width. With a match fixture, the results table content is 753px wide inside a 356px scroll frame; it no longer expands the page. Operations tables use their own horizontal scroll regions.

Production-preview fixture checks confirmed these GET requests once each with HTTP 200: `/api/v1/auth/session`, `/api/v1/admin/operations/audit`, `/api/v1/public/queue-overrides`, `/api/v1/admin/submissions/flagged`, `/api/v1/admin/teams`, and `/api/v1/results/matches?page=1&pageSize=10`. No POST or state-changing operation was made. Accessibility snapshots showed one main region, page heading, named operation/result controls, and named audit/operations regions.

Some Vite development screenshots reported the existing `GET /favicon.ico` 404; it did not affect page rendering or API fixture requests. Production-preview path checks passed. Focused verification: operations/results tests 60/60, web typecheck and production build passed.
