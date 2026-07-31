# PairNest

**A private, self-hosted space for two.**

[简体中文](README.zh-CN.md)

PairNest combines an Expo React Native client with a self-hosted
Express, Prisma, and MySQL API. One deployment serves one couple; it is not a
multi-tenant service.

## Features

- Private chat with text, images, audio, video, stickers, and read receipts
- Timeline, wishes, anniversaries, and couple check-ins
- Period tracking and relationship reports
- Two-player games, gacha, and a shared virtual pet
- Optional AI chat and audio transcription
- Custom app colors, timeline scenes, chat backgrounds, and bottom navigation

## Start the backend

Install Docker Engine and Docker Compose v2, then:

```bash
cp .env.example .env
```

Set `PAIRNEST_DB_PASSWORD`, `PAIRNEST_DB_ROOT_PASSWORD`,
`PAIRNEST_APP_SHARED_SECRET`, and `PAIRNEST_AUTH_TOKEN_SECRET` to independent
random values. Start and verify the stack:

```bash
docker compose config
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

Use an HTTPS reverse proxy before exposing the API to the Internet. See
[Backend deployment](docs/deployment.md) for networking, persistence, backups,
updates, and troubleshooting.

## Run and build the app

Local development requires Node.js 20 and npm. Android native builds also need
Java 17, Android Studio, and the Android SDK.

```bash
npm ci
npm run typecheck
npm run lint
npm run android
```

The app asks for the PairNest backend URL on first launch. Use HTTPS outside a
trusted development network.

See [App builds](docs/app-build.md) for Android APK/AAB, iOS, EAS cloud builds,
and local builds.

## Server development

```bash
cd server
npm ci
npm run build
npm run dev
```

Local server development requires `PAIRNEST_DATABASE_URL`,
`PAIRNEST_APP_SHARED_SECRET`, and `PAIRNEST_AUTH_TOKEN_SECRET`. Docker Compose
is the simplest option for most contributors.

## Privacy and security

PairNest stores sensitive relationship, health, chat, and media data. Read
[Privacy](docs/privacy.md) before exposing an instance to the Internet or
enabling third-party AI/transcription services.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 yoursigh.

PairNest is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
Operators who modify PairNest and make it available over a network must comply
with the corresponding-source requirements of the license.
