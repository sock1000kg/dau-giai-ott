# P2-T48 browser evidence

- Source: `b854cf6` plus P2-T48 branch changes.
- Browser: isolated headless Chromium via Chrome DevTools MCP 1.11.0.
- Public replay route checked at 390px light and 1440px dark. The browser had no replay API fixture and rendered the explicit unsupported-version error state; document width matched viewport at 390px.
- Console: no JavaScript errors/warnings. Playback controls/fullscreen start, exit, keyboard state, and unsupported/no-action cases are covered by `ReplayPlayer.test.tsx` (19 player/page tests pass).
- The 9×9 board and its wood/stone palette are unchanged by this task; surrounding controls/status and fullscreen panel use semantic theme tokens.
- Screenshots: `replay-light-390x844.png`, `replay-dark-1440x900.png`.
