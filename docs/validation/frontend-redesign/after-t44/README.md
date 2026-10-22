# P2-T44 browser evidence

- Source: `cadcd13` plus P2-T44 branch changes.
- Browser: isolated headless Chromium using Chrome DevTools MCP 1.11.0.
- Routes: public `/public`, anonymous `/login`, authenticated team and BTC navigation.
- Verification: toggle name and `aria-pressed` reflect selected mode; clicking updates `data-theme` and persists `ott-theme`; mode survives full reload and route navigation; the same toggle is rendered in public and authenticated headers.
- Screenshots: `login-light-390x844.png`, `login-dark-1440x900.png`, and `public-dark-1440x900.png`. Public static demo endpoint can log a single 404 on cold load; route/theme checks themselves produced no JS errors.
