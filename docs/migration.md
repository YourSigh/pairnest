# PairNest v0.1 migration notes

[简体中文](migration.zh-CN.md)

These notes cover fresh PairNest v0.1 installs and upgrades from the earlier
single-couple database layout. Back up MySQL and the upload volume before any
upgrade. MySQL schema changes are not transactional, so do not retry a failed
migration against production without first inspecting its state and restoring
a known-good backup when necessary.

## What v0.1 changes

- Adds a `Couple` owner for each isolated couple space.
- Adds a required `coupleId` to every business and device-session row.
- Includes `coupleId` in tenant-specific uniqueness rules and indexes.
- Adds database foreign keys from tenant rows to `Couple` with cascading
  deletion.
- Replaces shared client-claimed identity with server-bound Partner A / Partner
  B device sessions and JWT claims.
- Adds 24-hour invitations, a persistent rotatable recovery key, durable rate
  limit buckets, per-couple storage quotas, and couple deletion.
- Removes the server-wide external AI context directory configuration.

The old internal `female` and `male` values in some business-data columns are
retained for compatibility. Authentication exposes the neutral Partner A and
Partner B slots and does not accept those legacy values as identity claims.

## Fresh installation

The Compose `migrate` service runs both committed migrations with
`prisma migrate deploy`. A fresh database contains no placeholder couple; the
first space is created through the app. See [Deployment](deployment.md).

## Upgrading a legacy database

1. Stop the old API so no writes occur during backup or migration.
2. Back up the MySQL database and upload volume as one consistent set.
3. Check out the v0.1 code and update `.env` from `.env.example`. Keep the old
   backup offline; do not copy any secret into the public repository.
4. Run `docker compose build api migrate` and `docker compose up -d`.
5. Confirm that `migrate` exited with status 0, the API is healthy, and legacy
   records are visible only in the migrated couple space.
6. Test both member roles, REST requests, WebSocket updates, media downloads,
   logout, and recovery before removing the old deployment.

During migration, all rows from the single-couple layout are assigned to the
reserved `legacy-default-couple` record. Temporary database defaults are
removed before the migration completes, so new business writes must provide an
authenticated tenant context.

## Legacy shared-secret compatibility

An upgraded database may still contain the hash of its old shared activation
secret in `AuthConfig`. The v0.1 `POST /v1/auth/activate` endpoint can use that
old secret to activate Partner A or Partner B in `legacy-default-couple`. The
request must supply:

```json
{
  "sharedSecret": "the old single-couple secret",
  "deviceId": "a stable unique device identifier",
  "deviceSecret": "at least 32 random characters",
  "partnerRole": "partnerA",
  "device": {
    "deviceName": "optional migration label",
    "platform": "optional platform"
  }
}
```

Use `partnerB` for the second member. This compatibility path works only when
the legacy `AuthConfig` row and its original secret are available. It is
protected by IP/device failure limits, and the server verifies the stored
scrypt hash.

The public PairNest app does not embed, publish, or require this old secret.
Use it only through a trusted one-time migration client or operator-controlled
request, then establish the normal recovery key flow. Do not add the old secret
to `.env.example`, source code, screenshots, shell history, or issue reports.

## Verification

After upgrading, run the checks appropriate to your environment:

```bash
docker compose ps
docker compose logs migrate
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/ping
```

For a development checkout also run:

```bash
npm ci
npm run typecheck
npm run lint
cd server
npm ci
npm run build
```

Do not consider an upgrade complete until you have tested two different couple
spaces and confirmed that each can see only its own data and media.

## Rollback

There is no automatic downgrade migration. If the upgrade fails, stop the new
stack and restore both the pre-upgrade database and matching upload backup.
Restoring only one of them may leave missing files or stale media records.
