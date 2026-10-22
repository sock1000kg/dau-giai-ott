# P2-T54 replay board theme verification

- Browser: isolated Chromium through Chrome DevTools MCP runner; generated, checksum-valid replay fixture with the default map. It contains the complete 9×9 board and hand-token pieces and avoids live data.
- Routes: public `/spectator/replays/:id` and authenticated team `/team/replays/:id`.
- Viewports: 1440×1100 and 390×844, both light and dark themes. All captures have `documentElement.scrollWidth === innerWidth` and no console error/warning.
- Light theme computed board colors: frame `rgb(231, 220, 196)`, squares `rgb(245, 238, 223)` / `rgb(233, 220, 194)`, piece surface `rgb(255, 250, 240)`. Dark theme stays dark: frame `rgb(24, 33, 43)`, squares `rgb(21, 18, 14)` / `rgb(16, 13, 9)`.
- Measured light-theme contrast: coordinates 7.99:1 / 6.81:1 on alternating squares; red/blue goal labels 5.65:1 / 5.64:1; red/blue piece rings 5.15:1 / 4.90:1; move highlight 5.90:1.
- Fullscreen: entered via presentation button, verified warm light board frame and board fit, then exited with the fullscreen control. Fullscreen capture: `public-light-fullscreen.png`.
- Functional data and layout are unchanged; board colors are CSS variables scoped to `.rp-board-frame` and overridden by the root theme attribute.
- Gates: 52 test files / 404 tests pass; typecheck/build/diff check pass. GitNexus pre-edit `ReplayPlayer` risk HIGH with public/private callers; the change only edits CSS and task/docs. Both replay routes were exercised.
