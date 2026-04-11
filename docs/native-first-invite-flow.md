# Native-First Invite Flow

## Decision

BFZoom should be `native-first, backend-first, web-fallback`.

That means:
- the only public guest identifier is `inviteId`
- the only public guest URL is `https://www.bfzoom.fr/join/<inviteId>`
- iOS joins directly from the app by redeeming the invite with the backend
- web remains a fallback for desktop and users without the app
- raw `roomId` stays internal to host/session flows

## Canonical Flow

### Host

1. Host creates or resumes an internal `roomId`.
2. Host requests `POST /api/livekit/invite` with that `roomId`.
3. Backend returns `inviteId`.
4. App or web shares `https://www.bfzoom.fr/join/<inviteId>`.

### Guest on iOS

1. Universal Link opens the app.
2. App extracts `inviteId`.
3. App calls `POST /api/livekit/invite/redeem`.
4. Backend returns `room`, `token`, and optional `guestTtsToken`.
5. App joins LiveKit directly.

### Guest on Web

1. `/join/<inviteId>` validates the invite token.
2. Mobile web prioritizes `Open app` / `Download app`.
3. Desktop can continue into `/videoconference?invite=...`.
4. Web redeems the invite and joins with the returned LiveKit token.

## Rules

- Guests never join by public `roomId`.
- Public share helpers must only build invite links.
- `invite/redeem` must be idempotent for the same `inviteId + identity`.
- `roomId` can remain in URLs only for internal authenticated host flows.

## Phase 1

- make invite redeem idempotent by identity
- use canonical invite link helpers on iOS and web
- remove divergent invite parsing helpers

## Next Phases

- move web mobile to explicit fallback-only UX
- remove remaining guest-facing room semantics from naming and routes
- optionally rename legacy `/join/[room]` internals to reflect invite semantics
