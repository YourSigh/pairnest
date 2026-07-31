# PairNest v0.1 open-source migration report

Status: **v0.1 migration and local verification complete**

The source tree is prepared for a single sanitized initial commit. The remote
repository has not been created or configured.

This report records the minimal migration from the original private deployment
to an independently runnable PairNest source tree. It intentionally avoids
copying private Git history or redesigning the product as a multi-tenant
platform.

## Scope

Included in v0.1:

- Allowlist-based source copy into a new directory
- Removal or replacement of private data, assets, names, dates, prompts,
  domains, paths, and examples
- PairNest branding, application identifiers, URL schemes, package names, and
  container names
- A new empty Prisma schema baseline and committed init migration
- Runtime configuration for API, WebSocket, asset, and update endpoints
- Server-confirmed `partnerA` / `partnerB` device identity in JWT-backed
  authentication
- MySQL, migration, and API Compose services with persistent volumes and
  healthchecks
- Minimal English/Chinese documentation and privacy notes

Deferred work is listed in [ROADMAP.md](ROADMAP.md).

## Isolation

The migration must not include:

- The private repository's `.git` directory or commit history
- `.env` files, API keys, tokens, or other live secrets
- Signing keys or mobile provisioning files
- Database contents, Docker volumes, uploads, backups, or dumps
- Generated native projects, dependency directories, build caches, APKs, or
  compiled server output
- Personal photos or unlicensed demo assets

The original private project must remain unchanged throughout the migration.

## Deployment result

The minimal server stack is defined in `compose.yaml`:

- `db`: MySQL 8.4 with a persistent named volume and healthcheck
- `migrate`: one-shot `prisma migrate deploy`
- `api`: non-root Node.js API with uploaded-media volume and healthcheck

The default stack has no public database port, no private image registry, no
private network dependency, and no bundled reverse proxy.

## Authentication result

The v0.1 authorization boundary is:

- An activated device is assigned `partnerA` or `partnerB` by the server.
- The confirmed member identity is stored with the device session and included
  in signed JWT claims.
- HTTP routes and WebSocket actions derive the actor from authentication
  context.
- Client-supplied role headers and actor fields are ignored for authorization.
- One deployment continues to represent exactly one couple.

Legacy role-named business fields may remain for compatibility; a full naming
rewrite is deferred.

## Verification record

| Check | Command or method | Result |
| --- | --- | --- |
| Private Git history absent | independent repository and root-commit review | Pass; no history was copied from the private project |
| Forbidden files absent | allowlist plus final 232-file filesystem scan | Pass |
| Private text absent | approved nickname/date/domain/path/identifier scan | Pass |
| Secrets absent | known-token, credential-URL, private-key, literal-secret, and high-entropy pattern scan plus manual review | Pass |
| Public lockfile sources | parsed every `resolved` lockfile URL | Pass; npm registry only |
| Root dependencies install | `npm ci --ignore-scripts` | Pass |
| Mobile lint | `npm run lint` | Pass |
| Mobile typecheck | `npm run typecheck` | Pass |
| Android production bundle | `expo export --platform android` with no default API environment value | Pass; exported bundle also passed the private-value scan |
| Server dependencies install | `cd server && npm ci --ignore-scripts` | Pass |
| Server build | `cd server && npm run build` | Pass |
| Prisma baseline matches schema | fresh `prisma migrate diff --from-empty` compared with committed init SQL | Pass |
| Compose resolves | `docker compose config --quiet` with isolated verification values | Pass |
| API container image builds | `docker build` from `server/Dockerfile` | Pass |
| Fresh database migration | isolated `docker compose up -d`; `prisma migrate deploy` applied `20260730000000_init` | Pass |
| API health | `/health`, `/v1/ping`, and Compose healthchecks | Pass |
| Data persists after container recreation | force-recreated MySQL and API containers; rechecked member binding, migration state, and upload marker | Pass |
| Role spoofing blocked | live JWT, HTTP header/body, WebSocket payload, and same-device role-switch negative tests | Pass |
| Image privacy review | contact-sheet review of all 50 PNGs; removed EXIF from 34 files with identical pixel digests | Pass |
| License | SPDX identifier and full license text | Pass; `AGPL-3.0-only` |
| Initial commit metadata | root history and author/committer review | Pass; public GitHub identity only |
| Dependency advisory review | `npm audit` in both projects | API: 0; mobile tree: 15 moderate, 27 high, 0 critical |
| Original source unchanged | source HEAD and worktree comparison | Pass; original worktree remained clean |

Dependency directories, Expo caches, the Android export, and compiled server
output were removed from the delivery tree after verification. The isolated
Compose containers, network, database volume, and upload volume used for the
smoke test were also removed.

## Owner follow-up

- Set the public GitHub owner, repository links, and security contact when the
  remote repository is created.
- Confirm redistribution rights for every retained image, sound, font, and
  other media asset.
- Confirm that screenshots and examples contain no personal data.
- Configure a private security-reporting contact.
- Review and schedule a tested Expo/React Native dependency upgrade for the
  current npm advisory backlog. The available npm fixes cross major framework
  versions, so they were not applied automatically during this minimal
  migration.
- Review the privacy terms of any optional AI, transcription, or OpenClaw
  provider before enabling it.

## Known limitations

- v0.1 is single-couple and single-space.
- HTTPS and reverse proxy configuration are operator-managed.
- iOS distribution and automated public release workflows are not included.
- Legacy role field names remain where changing them would risk mature
  features.
- Encrypted backup automation and a universal feature capability layer are not
  included.
- The bundled API does not publish mobile release metadata or APK files.
  Update URLs are instance-relative and contain no private host, but operators
  must provide the matching endpoints if they enable self-hosted app updates.
- The mobile dependency tree has a recorded npm advisory backlog. Resolving it
  safely requires a tested Expo/React Native upgrade rather than a forced
  lockfile rewrite.
