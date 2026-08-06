# PairNest backend deployment

[简体中文](deployment.zh-CN.md)

This guide deploys one self-hosted PairNest API that can hold many isolated
couple spaces. The included Compose stack contains MySQL, a one-shot Prisma
migration service, and the API. All commands below act on the Docker engine of
the machine where you run them; they do not configure a remote server,
registry, domain, reverse proxy, or automatic HTTPS.

## 1. Requirements

- Docker Engine
- Docker Compose v2 (`docker compose version`)
- Approximately 1 GB of free memory for a small instance
- Your own HTTPS termination before the API is reachable from the Internet

## 2. Create local configuration

From the repository root:

```bash
cp .env.example .env
```

Fill every required blank. Generate independent values:

```bash
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 32
```

Use the first two URL-safe hexadecimal values for `PAIRNEST_DB_PASSWORD` and
`PAIRNEST_DB_ROOT_PASSWORD`. Use the final value for
`PAIRNEST_AUTH_TOKEN_SECRET`, which must contain at least 32 characters.

Never commit `.env`. Do not reuse passwords, JWT secrets, signing keys, or data
from another deployment.

Important settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAIRNEST_DB_NAME` / `PAIRNEST_DB_USER` | `pairnest` | MySQL database and application user |
| `PAIRNEST_DB_PASSWORD` / `PAIRNEST_DB_ROOT_PASSWORD` | required | Independent MySQL passwords |
| `PAIRNEST_AUTH_TOKEN_SECRET` | required | Signs access tokens and pseudonymizes authentication-attempt keys |
| `PAIRNEST_ALLOW_OPEN_COUPLE_CREATE` | `true` | Allow anonymous couple creation; set `false` on public instances |
| `PAIRNEST_ALLOW_LEGACY_SHARED_SECRET_ACTIVATE` | `true` | Allow old shared-secret activation into `legacy-default-couple`; set `false` after migration |
| `PAIRNEST_API_BIND` / `PAIRNEST_API_PORT` | `127.0.0.1` / `4000` | Host interface and port |
| `PAIRNEST_CORS_ORIGIN` | `*` | Browser origin or comma-separated origins |
| `PAIRNEST_TRUST_PROXY` | `false` | Trust proxy-provided client addresses and protocol |
| `PAIRNEST_TIMEZONE` | `UTC` | MySQL and API container timezone |
| `PAIRNEST_REQUEST_TIMEOUT_MS` | `300000` | HTTP request timeout; clamped to 30 seconds–30 minutes |
| `PAIRNEST_STORAGE_QUOTA_BYTES` | `2147483648` | Recorded upload quota for each couple (2 GiB) |
| `PAIRNEST_MAX_VIDEO_UPLOAD_BYTES` | `104857600` | Maximum single video upload (100 MiB) |
| `PAIRNEST_AI_REQUEST_TIMEOUT_MS` | `120000` | AI upstream timeout |
| `PAIRNEST_TRANSCRIPTION_REQUEST_TIMEOUT_MS` | `120000` | Transcription upstream timeout |

Enable `PAIRNEST_TRUST_PROXY` only when every direct path to the API passes
through a trusted proxy that overwrites forwarding headers. PairNest uses the
resolved client IP for anonymous rate limits.

AI and transcription settings are optional. Blank URL, key, or model values
keep the corresponding integration disabled. PairNest does not support a
server-wide external AI context directory.

## 3. Validate and start

Validate the resolved Compose file before starting:

```bash
docker compose config --quiet
```

Start the local stack:

```bash
docker compose up -d
docker compose ps
```

Startup order is:

1. MySQL starts and passes its healthcheck.
2. `migrate` runs `prisma migrate deploy` against that MySQL service.
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

## 4. Publish through HTTPS

For local development on another device, set `PAIRNEST_API_BIND=0.0.0.0` and
use the host's trusted-LAN address, for example `http://192.168.x.x:4000`.

Plain HTTP exposes credentials and relationship data to the network. Do not
use it over the public Internet. Keep the API bound to `127.0.0.1`, put it
behind your own HTTPS reverse proxy, and configure WebSocket forwarding for
`/ws`. Allow a request body slightly larger than your configured video limit;
128 MiB is sufficient for the default 100 MiB video limit plus multipart
overhead.

Example Nginx location settings (certificate and DNS configuration omitted):

```nginx
client_max_body_size 128m;

location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Then set `PAIRNEST_TRUST_PROXY=true` and restrict
`PAIRNEST_CORS_ORIGIN` if a browser client is used. The repository intentionally
does not ship Caddy or any automatic TLS configuration.

## 5. Create and recover a couple space

On first launch a user creates a space or enters an invitation. Creation
returns two different secrets:

- A 26-significant-character invitation, displayed in groups, which expires
  after 24 hours and is consumed after the target member joins.
- A persistent recovery key with the same entropy, which stays valid until an
  authenticated member rotates it.

Only hashes are stored on the server. Keep the recovery key in a password
manager or similarly protected location. Creating a new invitation invalidates
the previous invitation; rotating the recovery key invalidates the old key.
Expired invitation hashes are cleared by a maintenance task that runs every six
hours. An open space that never activated any device session is treated as
abandoned and deleted after seven days.

The server binds each device to Partner A or Partner B. A valid session's JWT
contains that confirmed member and couple identity. Logging out revokes the
session, and a recovery activation replaces and disconnects the previous
session for that slot.

## 6. Tenant isolation, limits, and deletion

All business tables are scoped by `coupleId` and linked to the owning couple by
foreign keys with cascading deletion. API and WebSocket operations derive the
couple and role from the authenticated session.

The main fixed-window defaults are:

| Scope | Operation | Default |
| --- | --- | --- |
| IP | Create a couple | 5/hour |
| IP | Validate or activate | 30/15 minutes |
| IP + device | Failed activations | 5/15 minutes, then a 60-minute lock |
| Couple | Media uploads | 120/hour |
| Couple | AI requests | 60/hour and 300/day |
| Couple | Transcription | 20/hour and 100/day |
| Couple | Invitations / recovery-key rotation | 10/hour / 5/hour |

Additional generation and deletion endpoints have couple-scoped limits. These
controls reduce abuse but do not replace host monitoring or provider-side
spending limits.

An unpaired space is deleted immediately on request. A paired space requires
confirmation by the other member, or a second confirmation by the requester
after seven days. Database rows are removed immediately; recorded media is
queued for asynchronous cleanup (`mediaCleanupPending` may be true until the
job finishes, with failed jobs dead-lettered after repeated attempts). Active
WebSockets are disconnected. Independent backups and third-party provider data
must be handled separately. See [Privacy](privacy.md).

## 7. Persistent data and backups

Compose creates two named volumes:

- `pairnest_db-data` for MySQL
- `pairnest_uploads` for chat, timeline, and sticker media

The exact prefix follows the Compose project name. `docker compose down`
removes containers and the network but keeps both volumes.

Do not run `docker compose down -v` unless you intentionally want to destroy
all PairNest data. Database contents and uploaded files belong together and
must be backed up and restored as one set. PairNest v0.1 does not provide
encrypted or automatic backups.

## 8. Update and migrate

Back up both volumes before updating. For a source checkout:

```bash
docker compose build api migrate
docker compose up -d
docker compose ps
```

The one-shot migration service applies committed Prisma migrations before the
new API starts. Do not replace `prisma migrate deploy` with `prisma db push` in
production. Read [Migration notes](migration.md) before upgrading a legacy
single-couple database.

## 9. Optional AI and transcription

Enabling either integration sends data to the configured third party. Keep
provider URLs, workspace identifiers, and keys only in `.env` and review the
provider's privacy and spending controls.

PairNest accepts an OpenAI-compatible chat-completions URL for AI. For audio it
supports an OpenAI-compatible `audio/transcriptions` endpoint and a
Qwen-compatible `chat/completions` endpoint:

```dotenv
PAIRNEST_AI_API_URL=https://provider.example/v1
PAIRNEST_AI_API_KEY=replace-me
PAIRNEST_AI_MODEL=replace-me
PAIRNEST_AI_REQUEST_TIMEOUT_MS=120000

PAIRNEST_TRANSCRIPTION_API_MODE=audio-transcriptions
PAIRNEST_TRANSCRIPTION_API_URL=https://provider.example/v1/audio/transcriptions
PAIRNEST_TRANSCRIPTION_API_KEY=replace-me
PAIRNEST_TRANSCRIPTION_MODEL=whisper-1
PAIRNEST_TRANSCRIPTION_LANGUAGE=zh
PAIRNEST_TRANSCRIPTION_REQUEST_TIMEOUT_MS=120000
```

For `qwen-chat-completions`, the transcription URL may be either the API base
or the complete `/chat/completions` URL. A 120-second local timeout does not
guarantee that a provider stops processing a request already received.

## 10. Troubleshooting

`migrate` exits with a non-zero status:

```bash
docker compose logs migrate
docker compose ps db
```

Confirm that database values are non-empty, URL-safe, and consistent.

The API is unhealthy:

```bash
docker compose logs api
docker compose exec api node -e \
  "fetch('http://127.0.0.1:4000/health').then(async r=>console.log(r.status,await r.text()))"
```

The phone cannot connect:

- Confirm that the app uses the correct runtime PairNest instance URL.
- Confirm that `PAIRNEST_API_BIND` permits the intended interface.
- Check DNS, the host firewall, the reverse proxy, `/v1/ping`, and `/ws`.
- Use HTTPS outside a local or trusted development LAN.
