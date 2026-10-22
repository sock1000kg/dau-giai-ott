# P2-T45 browser evidence

- Source: `8121cdf` plus P2-T45 branch changes.
- Browser: isolated headless Chromium via Chrome DevTools MCP 1.11.0.
- Login at 390px light: viewport and document width both 390px; toggle visible; screenshot `login-light-390x844.png`.
- Home route at 390px light and 1440px dark: viewport and document width match; screenshots saved as `home-light-390x844.png` and `home-dark-1440x900.png`.
- The demo API was not connected to this worktree, so browser `/` displayed the session-unavailable state. Role-specific home hierarchy and action links are covered by `HomePage.test.tsx`; authenticated session capture is deferred to the later full browser acceptance against the demo container.
- No JavaScript console errors or warnings were emitted during reload.
