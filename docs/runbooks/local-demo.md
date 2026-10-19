# Local Demo Accounts Runbook (P2-T35)

This runbook documents the demo-only account provisioning seeder, the public demo credentials, and the local credential CSV export for throw-away local demonstration environments.

> [!WARNING]
> **Public demo password — never use outside a throw-away demo!**
> The demo accounts use a well-known public password (`ABC123`). The seeder strictly refuses to run if `OTT_DEPLOYMENT_MODE` is `hosted` or `production`, or if `OTT_DEMO_MODE` is not explicitly set to `true`. Never enable demo mode on any shared or persistent deployment.

---

## 1. Demo Accounts Overview

The demo seeder provisions three accounts with the public password `ABC123` (hashed using Argon2id):

| Username | Role | Team Name | Representative Email | Description |
|---|---|---|---|---|
| `btc` | `BTC_ADMIN` | *(none)* | *(none)* | Tournament administrator account for demo operations |
| `team01` | `TEAM_ACCOUNT` | `Team 01` | `team01@demo.invalid` | First participating team account |
| `team02` | `TEAM_ACCOUNT` | `Team 02` | `team02@demo.invalid` | Second participating team account |

- **Passwords at Rest**: The database stores only Argon2id password hashes (`$argon2id$v=19$...`). Plaintext passwords are never persisted in the database.
- **Log Privacy**: The seeder never prints plaintext passwords to stdout or stderr.

---

## 2. Credential CSV Export

When the seeder runs, it exports a CSV file with permissions mode `0600` inside a directory with permissions mode `0700` (`.local/demo/accounts.csv` by default, or the path set by `OTT_DEMO_ACCOUNTS_CSV`).

The file format is:
```csv
username,password,role,team
btc,ABC123,BTC_ADMIN,
team01,ABC123,TEAM_ACCOUNT,Team 01
team02,ABC123,TEAM_ACCOUNT,Team 02
```

- **Pre-existing non-demo passwords**: If an account already exists with a different password, the seeder retains the existing password hash, leaves the CSV password cell empty (`""`), and logs:
  `account <username> exists with a non-demo password; CSV cell left empty`
- **Git Ignore**: The `.local/` directory is git-ignored to prevent accidental credential commits.

---

## 3. Bootstrap Account Alignment

The local Compose stack automatically bootstraps an initial BTC admin via `OTT_BOOTSTRAP_BTC_USERNAME` and `OTT_BOOTSTRAP_BTC_PASSWORD`.

For seamless local demo operation:
- Set `OTT_BOOTSTRAP_BTC_USERNAME=btc`
- Set `OTT_BOOTSTRAP_BTC_PASSWORD=ABC123`

When configured this way:
1. The API service bootstrap creates `btc` on initial container launch.
2. The demo seeder subsequently runs, finds `btc` already present, verifies that its hash matches `ABC123`, and marks `created=false` while populating the demo CSV row.
3. If bootstrap used a different username, the seeder idempotently creates `btc` as a second BTC administrator.

---

## 4. Running the Seeder

### Option A: Via Docker Compose (Recommended for Local Stack)

Because Docker Compose may create a missing bind-mounted directory as root, ensure the directory exists with `0700` permissions on the host first:

```bash
mkdir -p -m 700 .local/demo
docker compose -f infra/local/compose.yaml --env-file .env --profile demo run --rm seed-demo
```

### Option B: Running Directly via npm / tsx

Ensure your database is running, migrations have been applied, and demo environment variables are set:

```bash
OTT_DEMO_MODE=true \
OTT_DEPLOYMENT_MODE=dev \
DATABASE_URL="postgres://ott_local:CHANGE_ME_POSTGRES_PASSWORD@127.0.0.1:5432/ott_local" \
  npm run demo:seed --workspace @ott/platform-api
```

---

## 5. Idempotency & Safety Guards

- **Safety Guards**:
  - `OTT_DEMO_MODE` must equal `true`.
  - `OTT_DEPLOYMENT_MODE` must equal `dev` or `test`.
  - If either guard fails, the seeder terminates immediately with a non-zero exit code, without connecting to or mutating the database and without creating the CSV.
- **Idempotency**:
  - Teams and accounts use `ON CONFLICT DO NOTHING`.
  - Re-running the seeder does not create duplicate rows or change existing hashes.
  - If `btc`, `team01`, or `team02` already exists with a different role or team binding, the seeder throws an error rather than proceeding in an inconsistent state.
- **Production Isolation**:
  - The demo seeder does not touch the production bulk provisioning (`teams/bulk.ts`) or reset flows.
