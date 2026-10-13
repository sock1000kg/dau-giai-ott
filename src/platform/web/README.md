# `@ott/platform-web`

React/Vite browser client for the Phase 2 platform. The app uses the locked
Platform Authentication Contract v1 at same-origin `/api/v1/auth/*` and sends
`credentials: include` so the browser carries the opaque `ott_session` cookie.
The client keeps the resolved principal in memory only; it never stores the
session token, accepts a client-selected role/team, or offers registration or
self-service password reset.

UI route checks are for navigation and user feedback only. API authorization
remains authoritative. Session restoration gates the page before any
role-specific area is rendered; a `401` returns to the login form, while a
session-check network/server error keeps private content hidden and offers a
retry.

From the repository root:

```bash
npm run dev --workspace @ott/platform-web
npm test --workspace @ott/platform-web
npm run typecheck --workspace @ott/platform-web
npm run build --workspace @ott/platform-web
```

The browser host must route `/api/v1` to the platform API on the same origin.
Production secrets and API credentials must never be embedded in the Vite
client bundle.
