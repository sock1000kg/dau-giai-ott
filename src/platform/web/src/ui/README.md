# UI primitives (`src/ui`)

Shared design tokens and components for the web app. Semantic color tokens support light and dark modes. The initial mode follows the operating system until the visitor makes an explicit choice; that choice is saved under `ott-theme`.

## Contract for page tasks

- No page-level rules in `app/styles.css`. Use `ui-*` classes/components plus a per-feature stylesheet imported by that feature.
- Import from `src/ui/index.ts` (it loads `ui.css`). Tokens are CSS custom properties on `:root` (`--ui-*`) with light and dark values selected by `data-theme`.
- `theme.ts` applies the mode before React mounts, follows OS changes when no preference is saved, and syncs saved preference changes from other tabs. Only `light` or `dark` is stored.
- Logout lives in `AppNav`; authenticated pages are wrapped by `AppShellLayout` (in `app/routes.tsx`) which renders the nav and the `#main` skip-link target. Pages must not render their own logout button.
- `ThemeToggle` is shared by public and authenticated headers. It is a two-state pressed button and persists only the selected `light`/`dark` value through `theme.ts`.

## Components

| Component | Props / notes |
| --- | --- |
| `Page` | `title`, `description?`, `actions?`; renders `<main class="ui-page">` with an `h1`. |
| `Card` | `as?` (default `section`), `title?`, `className?`. |
| `Field` | `label`, `help?`, `error?`, `required?`, one control child. Injects `id`, `aria-describedby` (help + error), `aria-invalid`, `required`. |
| `Input` / `Textarea` / `Select` | Styled controls, 44px min height, focus/invalid/disabled states. |
| `Button` | `variant` = `primary` \| `secondary` \| `danger` \| `ghost`, `loading?` (disables, `aria-busy`, ignores clicks). |
| `LinkButton` | `href`, `variant?`; a real `<a>` styled as a button. |
| `Table` | `caption`, `columns[{key, header, render}]`, `rows`, `rowKey`, `emptyMessage`; header cells have `scope="col"`; empty state when no rows. |
| `Alert` | `tone` = `info` \| `success` \| `warning` \| `danger`; `danger`/`warning` use `role="alert"`, others `role="status"`. |
| `Badge` | `accent?`. |
| `AppNav` / `AppShellLayout` | Role-based nav, `aria-current="page"` on the active link, mobile menu button (Escape closes), skip link. |

CSS-only classes: `ui-stack`, `ui-row`, `ui-toolbar`, `ui-empty`, `ui-table-scroll`, `ui-card-grid`.

## Adoption checklist (later tasks, each with its own stylesheet)

- [ ] Operations console and pickers
- [ ] Results page (stage dropdown etc.)
- [ ] Teams, submissions, replay admin, login pages
- [ ] Round admin
- [ ] Spectator and public pages
