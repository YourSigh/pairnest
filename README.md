# PairNest

**A private, self-hosted space for two.**

[简体中文](README.zh-CN.md)

PairNest (双栖) is an Expo React Native app with a self-hosted
Express/Prisma/MySQL API. Version 0.1 keeps the existing couple-focused
features while removing the original private deployment, personal data, and
server addresses.

One PairNest deployment is intentionally designed for one couple. Multi-user
hosting and multiple spaces are not part of v0.1.

## Features

- Private chat with image, audio, video, and sticker support
- Timeline, wishes, anniversaries, and couple check-ins
- Period tracking
- Reports, games, gacha, and a shared virtual pet
- Optional AI chat and audio transcription

Optional integrations are disabled until the operator supplies their own
configuration. A production mobile build does not contain a default PairNest
server address.

## Quick start

Requirements:

- Docker Engine with Docker Compose v2
- An HTTPS reverse proxy for an Internet-facing deployment

```bash
cp .env.example .env
```

Open `.env`, set the four required secret values, then start the stack:

```bash
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

The stack contains MySQL, a one-shot Prisma migration service, and the API.
Database and uploaded files are stored in named Docker volumes.

See [Deployment](docs/deployment.md) for configuration, networking, updates,
and troubleshooting.

## Mobile development

Requirements:

- Node.js 20
- npm
- Java 17 and the Android SDK for Android native builds

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run android
```

Set the PairNest instance URL through the app's runtime server configuration.
Use HTTPS outside a trusted development LAN.

## Server development

```bash
cd server
npm ci
npm run build
npm run dev
```

A local server also requires `PAIRNEST_DATABASE_URL` and the authentication environment
variables documented in [Deployment](docs/deployment.md).

## Privacy and security

PairNest stores highly sensitive relationship, health, chat, and media data.
Read [Privacy](docs/privacy.md) before exposing an instance to the Internet or
enabling a third-party AI/transcription service.

Please follow [SECURITY.md](SECURITY.md) to report security issues privately.

## Project status

PairNest v0.1 focuses on safe separation from the original private app,
self-hosted deployment, and preservation of existing behavior. Larger product
and infrastructure changes are listed in [Roadmap](ROADMAP.md).

The migration and verification record is in
[OPEN_SOURCE_MIGRATION_REPORT.md](OPEN_SOURCE_MIGRATION_REPORT.md).

## License

Copyright (C) 2026 yoursigh.

PairNest is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
Operators who modify PairNest and make it available over a network must comply
with the corresponding-source requirements of the license.
