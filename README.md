# PairNest

**A private, self-hosted space for two.**

[简体中文](README.zh-CN.md)

PairNest combines an Expo React Native client with a self-hosted Express,
Prisma, and MySQL API. A single API deployment can host many couples. Each
couple gets one isolated space for exactly two server-confirmed member slots,
Partner A and Partner B.

Every business record is scoped by `coupleId`. The API derives the couple and
member identity from the authenticated JWT/session context; request bodies,
role headers, and WebSocket messages cannot choose another identity.

## Features

- Private chat with text, images, audio, video, stickers, and read receipts
- Timeline, wishes, anniversaries, and couple check-ins
- Period tracking and relationship reports
- Two-player games, gacha, and a shared virtual pet
- Optional AI chat and audio transcription
- Custom app colors, timeline scenes, chat backgrounds, and bottom navigation

## Start the backend

Install Docker Engine and Docker Compose v2, then run these commands on the
machine that will self-host PairNest:

```bash
cp .env.example .env
```

Set `PAIRNEST_DB_PASSWORD`, `PAIRNEST_DB_ROOT_PASSWORD`, and
`PAIRNEST_AUTH_TOKEN_SECRET` to independent random values.

A fresh instance must also set `PAIRNEST_ALLOW_OPEN_COUPLE_CREATE=true` long
enough to create its first space. A private one-couple instance can disable it
again after pairing. A public multi-couple instance must leave it enabled and
add HTTPS, capacity monitoring, and upstream spending limits.

Then start and verify the local stack:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

Compose builds the API locally, starts MySQL, runs `prisma migrate deploy`, and
keeps the database and uploads in named volumes. It does not publish an image,
configure DNS, or provide automatic HTTPS. Put the API behind your own HTTPS
reverse proxy before making it reachable from the Internet.

See [Backend deployment](docs/deployment.md) for configuration, persistence,
limits, backups, updates, and troubleshooting.

## Pairing, recovery, and deletion

The creator first chooses the female or male role. The server atomically binds
that device, then returns a 26-significant-character invitation that is valid
only for the opposite role. The invited partner is bound automatically after
entering it. Invitations expire after 24 hours, are consumed on use, and are
replaced whenever a new invitation is created. After that role has joined once,
the other partner cannot issue a replacement takeover invitation.

The client securely retains unfinished creation or activation state. If the
server commits but the response is lost to a timeout or network failure, the
same installation can retry and recover the same result; another device cannot
replay the consumed invitation. v0.1 has no space list or space switching: one
installation holds one member identity in one couple space at a time.

Each role has its own recovery key, which can recover only that role. Recovery
revokes the previous device session; the key remains valid until that member
explicitly rotates it while signed in. One partner's recovery key can never be
used to assume the other partner's identity. Rotation requests are persisted
locally and replayed idempotently after a lost response. Until a rotation is
confirmed, the client hides the possibly stale old key and blocks sign-out or
server changes.

The server binds a device to the female (`partnerA`) or male (`partnerB`) role
and includes that confirmed identity in its session and JWT. Logging out revokes the server session and
disconnects its WebSocket. A recovery flow can replace a lost or logged-out
device and revokes the previous session for the recovered slot.

Deleting an open space completes immediately. For a paired space, deletion
requires the other partner to confirm, or the requester to confirm again after
seven days. The operation removes the couple's database rows and recorded
media, but cannot erase independent backups or data already sent to an enabled
third-party provider.

## Run and build the app

Local development requires Node.js 20 and npm. Android native builds also need
Java 17, Android Studio, and the Android SDK.

```bash
npm ci
npm run typecheck
npm run lint
npm run android
```

The app uses a runtime PairNest API URL. Production builds accept HTTPS
instances; plain HTTP is reserved for local or trusted-LAN development. An
operator may provide a public default with
`EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL`, but this value is embedded in the app
and must never contain a secret.

See [App builds](docs/app-build.md) for Android APK/AAB, iOS, EAS cloud builds,
and local builds.

## Server development

```bash
cd server
npm ci
npm run build
npm run dev
```

Local server development requires `PAIRNEST_DATABASE_URL` and a
`PAIRNEST_AUTH_TOKEN_SECRET` of at least 32 characters. Docker Compose is the
simplest option for most contributors.

## Privacy and security

PairNest stores sensitive relationship, health, chat, and media data. The
default per-couple upload quota is 2 GiB and the default single-video limit is
100 MiB. IP- and couple-scoped rate limits reduce accidental and anonymous
abuse, but they are not a substitute for HTTPS, backups, monitoring, and a
properly secured host.

Read [Privacy](docs/privacy.md) and the
[migration notes](docs/migration.md) before exposing an instance to the
Internet or upgrading a legacy database. Report security issues privately as
described in [SECURITY.md](SECURITY.md).

Deferred work is listed in [ROADMAP.md](ROADMAP.md).

## License

Copyright (C) 2026 yoursigh.

PairNest is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
Operators who modify PairNest and make it available over a network must comply
with the corresponding-source requirements of the license.
