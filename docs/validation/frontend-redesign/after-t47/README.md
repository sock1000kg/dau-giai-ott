# P2-T47 browser evidence

- Source: `9b5bc98` plus P2-T47 branch changes.
- Browser: isolated headless Chromium via Chrome DevTools MCP 1.11.0.
- Finals route checked at 390px light and 1440px dark; document width matches viewport; screenshots saved here.
- The isolated browser did not have the finals snapshot endpoint, so it displayed the designed error state. The verified proof/bracket render remains covered by `finals.test.tsx` fixtures; assertions confirm values continue to render from the server payload.
- Console: no JavaScript errors/warnings; the request error is handled into the accessible alert state.
