# P2-T51 browser evidence

Captured from the T51 task branch based on `dd629cd` using isolated headless Chrome and synthetic API fixtures. No server data or round mutation was used.

| Route | Mode | Viewport | Fixture and checks |
| --- | --- | --- | --- |
| `/admin/rounds` | Light and dark | 320×568 | One running round, locked rule set, six teams; document width equals viewport |
| `/admin/rounds` | Light and dark | 390×844 | Same fixture; current rules, editor, archive and actions visible |
| `/admin/rounds` | Light and dark | 768×1024 | Same fixture; tablet layout within viewport |
| `/admin/rounds` | Light and dark | 1440×900 | Same fixture; two-column rule panel layout within viewport |

The fixture supplied one `RUNNING` round with `pause` and `reconcile` allowed actions, one synthetic locked rule set and a six-team count. No save, pause, reconcile, or other state-changing control was activated. Checks returned `Vận hành round`, two forms and one round row at every viewport; `documentElement.scrollWidth` matched each configured viewport. The final selected browser page had no console errors or warnings.

Focused verification: RoundAdmin tests, 62/62; web typecheck and production build passed.
