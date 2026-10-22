# P2-T49 browser evidence

- Source: `dcffa9b` plus P2-T49 branch changes.
- Browser: isolated headless Chromium via Chrome DevTools MCP 1.11.0.
- A temporary `initScript` supplied TEAM_ACCOUNT session and empty API responses for `/api/v1/submissions` and `/api/v1/results`; no database or credentials were used.
- `/team/submissions`: 390px viewport/document width, empty history state, upload flow and validation UI visible; captured light mode at 390px and dark mode at 1440px.
- `/team/results`: 390px viewport/document width, empty-results state and filters visible; captured dark mode.
- No JS exceptions. Chromium logged one 404 resource on the results page; API fixtures returned successfully. Screenshot files are in this directory.
- Focused tests: SubmissionForm and results suites 28/28; web typecheck and build pass.
