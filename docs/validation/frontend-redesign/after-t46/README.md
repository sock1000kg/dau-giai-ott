# P2-T46 browser evidence

- Source: `0000cbb` plus P2-T46 branch changes.
- Browser: isolated headless Chromium via Chrome DevTools MCP 1.11.0.
- Public route tested at 320px dark and 390px light with a local checked-in snapshot published as a temporary static fixture; document/body width matched each viewport. At 320px the summary table region measured 236px wide with 880px scroll width; horizontal movement remains inside the table region.
- Full leaderboard route tested at 320px light and 390px dark; document width matched viewport. The standalone leaderboard API was not connected to the isolated Vite browser, so loaded rows and pagination remain covered by unit/UI tests and later container acceptance.
- Console: no JS errors/warnings in the final mobile capture.
- Screenshots: `public-light-390x844.png`, `leaderboard-light-320x800.png`, `leaderboard-dark-390x844.png`.
