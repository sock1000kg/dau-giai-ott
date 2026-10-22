# Design contract: OTT Arena light and dark themes

This contract records the proposed direction for implementation review. It is not owner approval; no theme or page code should change until the project owner accepts this mockup direction.

## Visual hierarchy

- **Public tournament:** compact branded header; one clear page title and current phase/status; primary queue/result summary; ranked standings; schedule, announcements, rules and FAQ below. Status text always accompanies color.
- **Team workspace:** persistent role-aware navigation; page title and current submission/result state first; one primary action per view; history and secondary help follow.
- **BTC workspace:** operator navigation distinct from team navigation; operational status before dense tables; filters adjacent to their table; destructive actions separated and visually explicit.
- **Replay:** board and current-turn/status are the visual focus; playback controls remain reachable without covering the board; fullscreen preserves board geometry and accessible labels.
- **Login:** narrow centered form with clear title, labeled fields, visible validation and one primary submit action.

## Type and spacing

- Use the existing system sans-serif stack and a restrained scale: body 16px/1.5, secondary 14px/1.45, page title clamp(1.75rem, 3vw, 2.5rem), section heading 1.25rem. Do not use tiny uppercase labels as primary information.
- Base spacing on 4px increments: 4, 8, 12, 16, 24, 32, 48, 64. Content width 1200px maximum; readable text measure 70–78 characters.
- Controls have at least 44px target height. Dense tables may be compact but preserve row separation, captions, and independent horizontal scrolling.

## Semantic tokens

Implementation should use semantic tokens rather than fixed color literals: `canvas`, `surface`, `surface-raised`, `text`, `text-muted`, `border`, `accent`, `accent-contrast`, `success`, `warning`, `danger`, `focus-ring`, `overlay`, and `shadow`. Each token must have a light and dark value. Status is conveyed with text/icon as well as color. Focus is visible in both modes.

Initial palette direction (values are candidates and must be contrast-checked after implementation):

| Token | Light | Dark |
| --- | --- | --- |
| canvas | `#F5F7FA` | `#0B1220` |
| surface | `#FFFFFF` | `#111B2B` |
| surface-raised | `#FFFFFF` | `#18253A` |
| text | `#172033` | `#F1F5F9` |
| text-muted | `#536176` | `#A9B8CC` |
| border | `#CBD5E1` | `#33445C` |
| accent | `#087F8C` | `#42D6C5` |
| danger | `#B42318` | `#FF7B72` |
| warning | `#8A4B08` | `#F6C76B` |
| success | `#176B45` | `#55D69E` |
| focus-ring | `#075EBD` | `#8AB4FF` |

## Mode behavior and states

- Exactly two modes: light and dark. Initial mode follows OS preference; explicit selection persists across reload/navigation/auth changes. OS changes apply only before an explicit choice.
- Set `data-theme` and native `color-scheme` before React paints. No flash of the opposite mode.
- Inputs, selects, dialogs, menus, hover, active, disabled, invalid, loading, empty, stale and error states use semantic tokens. Native controls follow the selected mode.
- Meet WCAG 2.2 AA contrast: 4.5:1 normal text and 3:1 large text/non-text controls and focus indicators where applicable.

## Responsive behavior

- At 1440px, use a centered content column and deliberate multi-column groupings. At 768px, reduce columns. At 390px and 320px, stack primary content, collapse navigation into an accessible menu, and avoid page-level horizontal scrolling. Tables may scroll within their own labeled region.

## Review status

Pending owner review. Screenshots in `baseline/` document the current UI and are not a proposed visual mockup. A browser-rendered pair of mockups should be reviewed before P2-T43 begins.
