# Privacy notes

[简体中文](privacy.zh-CN.md)

PairNest is a self-hosted relationship app. It can contain highly sensitive
information, and self-hosting transfers operational responsibility to the
person or organization running the server.

This document is a technical summary, not a legal privacy policy.

## Data stored by PairNest

Depending on the features used, an instance may store:

- Couple membership slots, device sessions, and authentication metadata
- Chat text, reactions, read state, stickers, images, audio, and video
- Timeline entries, wishes, anniversaries, and check-ins
- Menstrual and other health-related records
- Game, gacha, report, and shared-pet state
- AI conversations, memories, summaries, and generated reports

Structured data is stored in MySQL. Uploaded media is stored in the
`pairnest_uploads` Docker volume.

One PairNest API can host many couples. Each business row carries a `coupleId`,
API queries are scoped to the authenticated couple, and database foreign keys
associate tenant rows with their owning couple. Deleting a couple cascades
through those rows. These controls form PairNest's application-level tenant
boundary; they do not isolate couples into separate processes, databases, or
hosts. The instance operator and anyone with database, volume, or host access
can access every couple's data.

## Pairing, sessions, and recovery

PairNest uses the neutral technical identities Partner A and Partner B. During
activation the server binds a device session to one of these slots. The
confirmed couple and role are carried in the JWT and checked against the live
session. API routes and WebSocket messages use this authenticated context and
do not trust a role claimed by a client header, body field, or message.

A new invitation contains 26 random characters, expires after 24 hours, and is
replaced when another invitation is issued. It is consumed after the target
slot joins. A separate 26-character recovery key stays valid until it is
rotated. Only hashes are stored in MySQL, but anyone who obtains a valid
invitation or recovery key may be able to join or replace a member session.
Share them through a secure channel and do not include them in screenshots,
logs, source code, issue reports, or backups stored without protection.

Expired invitation hashes are cleared on a six-hour maintenance cycle. An
open space with no device session is automatically deleted seven days after it
was created, so an unfinished setup must not be used as permanent storage.

Logging out revokes the server session and disconnects its WebSocket. A
recovery activation revokes the previous active session for the recovered
slot. Operators should still protect the JWT signing secret and monitor a
public instance for suspicious activity.

## External data processing

The default self-hosted stack does not require an AI or transcription service.
These integrations stay disabled when their URL, key, or model configuration
is blank.

When enabled:

- An AI provider may receive prompts, relationship context, memories, titles,
  or recent activity used by the selected feature.
- A transcription provider receives the audio selected for transcription.

AI context is built from the authenticated couple's PairNest data. v0.1 does
not read or inject a server-wide external context directory. AI and
transcription requests time out after 120 seconds by default; a local timeout
does not guarantee that a provider immediately stops processing a request it
already received.

The operator is responsible for understanding each provider's retention,
training, access, and data-location terms, and for obtaining both partners'
agreement before enabling it.

## Network, quotas, and abuse controls

Production mobile builds must use an HTTPS PairNest API. Plain HTTP is intended
only for local or trusted-LAN development. Without HTTPS, network observers can
read authentication material and private content.

PairNest does not publish a MySQL port in the default Compose file. The API
binds to localhost by default; exposing it to a LAN or the Internet is an
explicit operator action. The included Compose stack does not configure a
domain, reverse proxy, firewall, or automatic HTTPS.

Each couple has a default 2 GiB recorded-upload quota, and a single video is
limited to 100 MiB by default. IP-scoped limits cover anonymous creation,
pairing validation, activation, and token refresh. Couple-scoped limits cover
media, AI, transcription, invitation, report, and selected generation
operations. These are defense-in-depth controls, not a promise that an
Internet-facing instance cannot be abused or incur third-party charges.

## Deletion and backups

An unpaired space can be deleted immediately. A paired space is deleted after
the other member confirms the request, or after the original requester waits
seven days and confirms again. Deletion removes the couple row, cascaded
business rows, device sessions, and recorded media files. Active WebSockets
for those sessions are disconnected.

File removal can fail because of host permissions or storage errors, so an
operator should monitor API logs and verify the upload volume after a deletion
failure. Deletion cannot recall data already processed by a third-party AI or
transcription provider.

Backups contain the same sensitive data as the live instance. Deleting a
couple does not remove it from independent database dumps, volume snapshots,
or other backups. Protect them with strict access controls, define a retention
policy, and remove expired copies. PairNest v0.1 does not provide an encrypted
backup system.

## Public repository hygiene

Never commit:

- `.env` files, provider keys, invitation keys, recovery keys, or JWT secrets
- Database dumps, Docker volumes, or uploads
- Android/iOS signing material
- Production logs or backups
- Personal photos used as application branding or demo data

Before publishing a fork, run a secret scanner and manually review all images,
prompts, fixtures, examples, documentation, lockfile registry URLs, and Git
history.
