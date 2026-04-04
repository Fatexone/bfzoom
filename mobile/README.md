# BFZoom Mobile (iOS)

Expo React Native app for iOS, in the same repository as the Next.js backend.

## Prerequisites

- Node.js 18+
- Xcode (for iOS simulator/device)
- Backend running locally or deployed (`/api/livekit/token` available)

## Setup

```bash
cd mobile
cp .env.example .env
npm install
```

Update `.env`:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
EXPO_PUBLIC_LIVEKIT_URL=wss://your-livekit-url
EXPO_PUBLIC_REALTIME_URL=
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

If you run on a real iPhone, use your machine LAN IP instead of `localhost`.

## Run

LiveKit native requires an Expo development build.

```bash
cd mobile
npm run ios
```

## Current scope

- 3 native modules in one app:
  - `Conference`: Firebase auth + LiveKit room + live translation/captions/TTS
  - `Coach conversation IA`: guided coaching + voice transcription + practice history in conversation mode
  - `Chat`: Firestore real-time direct/group chats (text) with group creation and member management
- Firebase auth for host mode (email/password) + manual bearer fallback.
- Lobby setup (API URL, LiveKit URL, room, role, identity).
- LiveKit room join on iOS with camera/microphone toggles.
- Realtime voice translation loop:
  - Native PCM streaming over WebSocket when `EXPO_PUBLIC_REALTIME_URL` is set
  - Automatic fallback to segmented mode when native realtime WS is unavailable
  - Per-user persistence: source/target language, captions/voice/realtime toggles, Realtime voice, and TTS voice by target language

## Notes

- Your existing backend auth rules still apply:
  - `host` token request needs allowlisted Firebase user
  - `/api/openai`, `/api/transcribe`, `/api/tts` require bearer auth
- For Expo Go, native LiveKit modules are limited; prefer `npx expo run:ios`.

## App Store Copy

Ready-to-use App Store metadata is stored in:

- `mobile/app-store/ios/metadata-fr.md`
- `mobile/app-store/ios/metadata-en.md`
- `mobile/app-store/ios/whats-new-fr.txt`
- `mobile/app-store/ios/whats-new-en.txt`
