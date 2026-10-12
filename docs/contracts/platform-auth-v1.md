# Platform Authentication Contract v1

> **Status:** Locked for `P2-T05`.
>
> **Scope:** Internal username/password authentication for the Phase 2 API. This
> contract intentionally has no public registration or self-service password reset.

## Roles and principal

The server owns authorization. A browser is never trusted to choose a role or
`teamId`.

| Role | Session principal | Authorization rule |
| --- | --- | --- |
| `BTC_ADMIN` | `{ role: "BTC_ADMIN" }` | May use BTC-only endpoints guarded by the server. |
| `TEAM_ACCOUNT` | `{ role: "TEAM_ACCOUNT", teamId: "<uuid>" }` | May access only resources for this exact session `teamId`. |

Every private route must require its principal server-side. UI route guards,
hidden controls, request body `teamId` values and query parameters are not an
authorization boundary.

## Endpoints

All paths are under `/api/v1`.

### `POST /auth/login`

Request body:

```ts
type LoginRequest = {
  username: string; // 1–128 characters
  password: string; // sent only over HTTPS
};
```

Success (`200`):

```ts
type CurrentSessionResponse = {
  data: {
    role: "BTC_ADMIN" | "TEAM_ACCOUNT";
    teamId?: string; // present only for TEAM_ACCOUNT
  };
};
```

The response also sets one opaque `ott_session` cookie. Its value is a random
bearer token with no role or team data; the server resolves it from Redis. The
cookie is `HttpOnly`, `Path=/`, `SameSite=Lax`, and `Secure` for the default
HTTPS policy. The Redis session expires after 12 hours; browser session-cookie
lifetime is deliberately not a claim that the server record still exists.

On a missing username, an incorrect password, disabled account or decoded login
body without usable username/password fields, respond identically:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid username or password"
  }
}
```

with `401`. Login attempts are rate-limited by a Redis key derived from the
username and client address. A currently limited attempt returns `429`:

```json
{
  "error": {
    "code": "LOGIN_RATE_LIMITED",
    "message": "Too many login attempts. Try again later."
  }
}
```

Clients must not infer whether a username exists from status, message, timing,
or UI text.

### `GET /auth/session`

Returns `CurrentSessionResponse` for a valid `ott_session` cookie. A missing,
expired or revoked cookie returns `401`:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Authentication is required"
  }
}
```

### `POST /auth/logout`

Revokes the presented server-side session when it exists, clears the cookie and
returns `204`. It is intentionally idempotent: a missing or already-revoked
cookie also returns `204`.

## Authorization failures

A valid principal that is not allowed to use a server-protected resource
receives `403`:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You are not allowed to access this resource"
  }
}
```

In particular, `TEAM_ACCOUNT` may never read or write another team's private
resource. Later API modules must derive its target team from the session or
compare a path resource's owner to the session `teamId`.

## Deliberately absent APIs

There is no `POST /auth/register`, `POST /auth/reset-password`, OAuth callback,
email login, or user-facing credential creation endpoint. `BTC_ADMIN` team
provisioning/reset is introduced by `P2-T06`; its one-time plaintext credential
response is the sole future exception and must not be logged, audited or stored.

## Local BTC bootstrap

An API host may call `bootstrapBtcAdmin` before accepting requests. It reads
both variables below from the uncommitted local environment:

```text
OTT_BOOTSTRAP_BTC_USERNAME=<local BTC username>
OTT_BOOTSTRAP_BTC_PASSWORD=<unique local secret>
```

When both variables are absent, bootstrap is skipped. When only one is present,
startup must fail rather than create a partial account. The operation is
idempotent for an existing `BTC_ADMIN` username; it never stores, logs or
returns the bootstrap plaintext password. The persisted value is an Argon2id
hash.
