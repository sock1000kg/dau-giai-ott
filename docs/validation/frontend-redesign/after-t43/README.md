# P2-T43 browser evidence

- Source: `053ec96` plus task branch changes.
- Browser: isolated headless Chromium via Chrome DevTools MCP 1.11.0.
- Browser test route: `/public` with the checked-in public snapshot fixture published locally; no auth data was used.
- Screenshots are full-page captures made at 1440×900 and 390×844. PNG height may exceed viewport; the public page still expands to 788px at mobile width, tracked under P2-T46.

## Evidence

| Check | Result |
| --- | --- |
| OS light, initial load | `data-theme=light`, computed `color-scheme=light`, canvas `#f5f7fa`, text `#172033`. |
| OS dark, initial load | `data-theme=dark`, computed `color-scheme=dark`, canvas `#0b1220`, text `#f1f5f9`. |
| Change emulated OS dark → light without a saved choice | Theme updated to light on the same page. |
| Manual choice, persistence and OS independence | Covered by `theme.test.ts`; selecting dark saves only `ott-theme=dark`, OS changes do not override it. |
| Cross-tab selection/removal | Covered by a storage-event test; removal returns to current OS mode. |
| Browser console | Theme loads without JavaScript errors. The initial cold Vite request can log one 404 for a stale/aborted resource while the dev server starts; a warmed reload has no console errors. |

## Contrast calculations

Ratios use WCAG relative luminance calculations on the token colors in `src/ui/ui.css` (no rounding used to determine pass/fail).

| Pair | Light minimum across canvas/surface/raised | Dark minimum across canvas/surface/raised |
| --- | ---: | ---: |
| Primary text | 14.44:1 | 14.05:1 |
| Muted text | 5.58:1 | 7.63:1 |
| Accent text | 5.09:1 | 8.54:1 |
| Danger text | 5.84:1 | 6.10:1 |
| Warning text | 6.03:1 | 9.75:1 |
| Info text | 6.46:1 | 8.53:1 |
| Success text | 5.78:1 | 8.43:1 |
| Focus indicator color | 5.57:1 | 7.37:1 |
| Text on primary accent button | 5.73:1 | 10.39:1 |

All normal-text pairs in this table exceed 4.5:1; focus/accent control indicators exceed 3:1. Feature-specific colors are scheduled for audit as each page adopts the tokens.
