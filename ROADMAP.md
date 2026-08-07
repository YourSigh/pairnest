# PairNest roadmap

PairNest v0.1 provides a self-hosted API for multiple independent couples. A
couple has exactly two server-confirmed member slots, and every business record
is scoped by `coupleId`. v0.1 also includes role-bound invitations, separate
member recovery keys, revocable device sessions, per-couple storage quotas, and
couple-level deletion.

This is intentionally a small multi-couple model, not a complete account and
workspace platform. The following work remains out of scope for v0.1:

- A complete `PairSpace` domain abstraction
- A persistent `PairInvite` history and management model
- Invitation links and QR-code onboarding
- User accounts that can join or switch among multiple spaces
- More than two members in one space
- iOS distribution
- Bundled Caddy or automatic HTTPS
- Multi-architecture container publishing
- Automated GHCR publishing
- Automated APK builds attached to GitHub Releases
- SBOM, provenance, and CodeQL pipelines
- An encrypted backup and restore system
- A full rewrite of legacy `female` / `male` business-data fields
- A universal feature-capability system
- Large directory-layout changes or unrelated refactors

Potential follow-up priorities:

1. Add broader authorization, migration, concurrency, and WebSocket tests.
2. Add account-level session/device management without weakening the two-slot
   couple model.
3. Decide health-record ownership and sharing semantics.
4. Replace legacy role field names without breaking existing data or clients.
5. Add opt-in remote notification support for Android and iOS.
6. Add reproducible release and container publishing workflows.
7. Add versioned, encrypted backup, restore, and upgrade tooling.
8. Add operator observability and configurable abuse controls for public
   instances.
9. Upgrade Expo and React Native with regression testing to resolve the
   inherited mobile dependency advisory backlog.
10. Add a conservative orphan-media sweeper for files left behind if the API
    process stops after upload storage succeeds but before the database commit.
