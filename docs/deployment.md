# PairNest v0.1 deployment

[简体中文](deployment.zh-CN.md)

This guide deploys one PairNest instance for one couple. The included Compose
stack contains MySQL, a one-shot Prisma migration service, and the API. It does
not include a reverse proxy, automatic HTTPS, or a container registry workflow.

## 1. Requirements

- Docker Engine
- Docker Compose v2 (`docker compose version`)
- Approximately 1 GB of free memory for a small instance
- HTTPS termination when the API is reachable from the Internet

## 2. Create local configuration

```bash
cp .env.example .env
```

Fill every required blank in `.env`. Generate independent secrets:

```bash
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
```

Use the first two URL-safe hexadecimal values for
`PAIRNEST_DB_PASSWORD` and `PAIRNEST_DB_ROOT_PASSWORD`. Use the remaining
values for `PAIRNEST_APP_SHARED_SECRET` and
`PAIRNEST_AUTH_TOKEN_SECRET`.

Never commit `.env`. Do not reuse passwords, JWT secrets, signing keys, or data
from another PairNest deployment.

Important settings:

| Variable | Purpose |
| --- | --- |
| `PAIRNEST_DB_*` | Database name, user, and independent passwords |
| `PAIRNEST_APP_SHARED_SECRET` | Secret used to activate an authorized device |
| `PAIRNEST_AUTH_TOKEN_SECRET` | Signs and protects authentication state |
| `PAIRNEST_API_BIND` | Host interface; defaults to `127.0.0.1` |
| `PAIRNEST_API_PORT` | Host API port; defaults to `4000` |
| `PAIRNEST_CORS_ORIGIN` | Allowed browser origin or comma-separated origins |
| `PAIRNEST_TRUST_PROXY` | Enable only behind a correctly configured proxy |
| `PAIRNEST_TIMEZONE` | Container timezone; defaults to `UTC` |

AI and transcription variables are optional. Blank values keep the
corresponding external integration disabled.

## 3. Validate and start

Validate the resolved Compose file before starting:

```bash
docker compose config
```

Start the stack:

```bash
docker compose up -d
docker compose ps
```

Startup order is:

1. MySQL starts and passes its healthcheck.
2. `migrate` runs `prisma migrate deploy` against the new database.
3. The API starts and passes `/health`.

The migration container is expected to show `Exited (0)` after a successful
run. This is not an error.

Check the API:

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/ping
```

Follow logs when startup fails:

```bash
docker compose logs -f db migrate api
```

## 4. Connect the mobile app

For local development on another device, set `PAIRNEST_API_BIND=0.0.0.0` and
use the host's trusted-LAN address in the app, for example
`http://192.168.x.x:4000`.

Plain HTTP exposes credentials and relationship data to the network. Do not use
it over the public Internet. Put the API behind an HTTPS reverse proxy and set
the mobile app's runtime instance URL to that public HTTPS URL.

The v0.1 Compose file intentionally does not ship Caddy or another automatic
TLS service.

## 5. Persistent data

Compose creates two named volumes:

- `pairnest_db-data` for MySQL
- `pairnest_uploads` for chat and timeline media

The exact prefix follows the Compose project name. `docker compose down`
removes containers and the network but keeps both volumes.

Do not remove volumes unless you intentionally want to destroy all PairNest
data. Database contents and uploaded files belong together and must be backed
up and restored as one set.

## 6. Update

Before updating, back up both the MySQL database and upload volume using your
normal host or Docker backup procedure.

For a source checkout:

```bash
docker compose build api
docker compose up -d
docker compose ps
```

The migration service runs pending committed migrations before the new API
starts. Review migration notes before upgrading across versions.

## 7. Optional integrations

Enabling AI or transcription can send prompts, relationship history, titles,
memories, or raw audio to the configured third party. Read
[privacy.md](privacy.md) first.

AI context directories are not mounted by the default Compose file. If you
choose to use one, add an explicit read-only bind mount in a private Compose
override and set `PAIRNEST_AI_CONTEXT_DIR` to the matching path inside the
container. Never mount a home directory or filesystem root.

## 8. Troubleshooting

`migrate` exits with a non-zero status:

```bash
docker compose logs migrate
docker compose ps db
```

Confirm that the database values are non-empty, URL-safe, and consistent. Do
not replace `prisma migrate deploy` with `prisma db push` in production.

The API is unhealthy:

```bash
docker compose logs api
docker compose exec api node -e \
  "fetch('http://127.0.0.1:4000/health').then(async r=>console.log(r.status,await r.text()))"
```

The phone cannot connect:

- Confirm the app uses the runtime PairNest instance URL.
- Confirm `PAIRNEST_API_BIND` permits the intended interface.
- Check the host firewall and reverse proxy.
- Use HTTPS outside a trusted LAN.
