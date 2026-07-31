# PairNest roadmap

PairNest v0.1 focuses on a stable self-hosted experience for one couple, with a
standalone MySQL/API deployment and runtime server configuration.

The following work is not currently included:

- Multi-tenant hosting
- A complete `PairSpace` domain abstraction
- A persistent `PairInvite` model
- Invitation links and QR-code onboarding
- Multiple spaces per account or deployment
- iOS distribution
- Bundled Caddy or automatic HTTPS
- Multi-architecture container publishing
- Automated GHCR publishing
- Automated APK builds attached to GitHub Releases
- SBOM, provenance, and CodeQL pipelines
- An encrypted backup and restore system
- A full rewrite of legacy `female` / `male` database fields
- A universal feature-capability system
- Large directory-layout changes

Potential follow-up priorities:

1. Add focused authorization and integration tests.
2. Document and implement session management and recovery.
3. Decide health-record ownership and sharing semantics.
4. Replace legacy role field names without breaking existing features.
5. Add opt-in remote notification support for Android and iOS.
6. Add reproducible release and container publishing workflows.
7. Add versioned backup, restore, and upgrade tooling.
8. Upgrade Expo and React Native with regression testing to resolve the
   inherited mobile dependency advisory backlog.
