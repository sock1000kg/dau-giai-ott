# @ott/platform-api

Control-plane foundation for Phase 2. `P2-T03` owns PostgreSQL migrations and the typed database boundary only; Fastify routes, authentication, storage and queue integrations belong to later tasks.

## Local database verification

Start the P2-T02 local services, export `DATABASE_URL` from an uncommitted local environment file, then run:

```bash
npm run db:migrate
npm test --workspace @ott/platform-api -- --run tests/db/schema.test.ts
```

`runMigrations` records a SHA-256 checksum for each migration. Editing an already applied migration fails deliberately; add a later migration instead. The integration test resets only its local `public` schema before it applies migrations.
