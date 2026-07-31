# Privacy notes

PairNest is a self-hosted relationship app. It can contain highly sensitive
information, and self-hosting transfers operational responsibility to the
person running the server.

This document is a technical summary, not a legal privacy policy.

## Data stored by PairNest

Depending on the features used, an instance may store:

- Member identity slots, device sessions, and authentication metadata
- Chat text, reactions, read state, stickers, images, audio, and video
- Timeline entries, wishes, anniversaries, and check-ins
- Menstrual and other health-related records
- Game, gacha, report, and shared-pet state
- AI conversations, memories, summaries, and generated reports

Structured data is stored in MySQL. Uploaded media is stored in the
`pairnest_uploads` Docker volume. PairNest v0.1 is designed for one couple per
deployment; it is not a multi-tenant isolation boundary.

## External data processing

The default self-hosted stack does not require an AI or transcription service.
These integrations stay disabled when their configuration is blank.

When enabled:

- An AI provider may receive prompts, relationship context, memories, titles,
  or recent activity used by the selected feature.
- A transcription provider receives the audio selected for transcription.

The operator is responsible for understanding each provider's retention,
training, access, and data-location terms, and for obtaining both partners'
agreement before enabling it.

Do not mount personal directories as AI context. The default Compose file does
not mount a context directory.

## Network and mobile configuration

Production mobile builds do not contain a private or default PairNest server
address. The instance URL is supplied at runtime.

Use HTTPS whenever traffic leaves a trusted development LAN. Without HTTPS,
network observers can read authentication material and private content.

PairNest does not make a public MySQL port available in the default Compose
file. The API binds to localhost by default; exposing it to a LAN or the
Internet is an explicit operator decision.

## Authentication

PairNest v0.1 binds each activated device to a server-confirmed `partnerA` or
`partnerB` identity. Authorization uses the authenticated server context rather
than a role claimed by a request header or body field.

Keep the activation secret and JWT signing secret private and independent.
Revoke sessions for lost or untrusted devices. One technical partner slot must
not be treated as a gender or as proof that a person is entitled to view every
category of health data.

## Backups and deletion

Backups contain the same sensitive data as the live instance. Protect database
dumps and media archives with strict filesystem access and remove obsolete
copies.

Deleting an item in the app may not remove it from existing backups. Full
instance deletion requires removing both the database and upload volume, plus
every external backup. PairNest v0.1 does not provide an encrypted backup
system.

## Public repository hygiene

Never commit:

- `.env` files or API keys
- Database dumps, Docker volumes, or uploads
- Android/iOS signing material
- Production logs or backups
- Personal photos used as application branding or demo data

Before publishing a fork, run a secret scanner and manually review all images,
prompts, fixtures, examples, documentation, lockfile registry URLs, and Git
history.
