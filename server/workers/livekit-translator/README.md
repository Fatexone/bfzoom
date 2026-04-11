# LiveKit Translator Worker

Worker Node qui rejoint une room LiveKit en tant que `translator`, lit les captions
(`bfzoom-captions`) et publie une piste audio traduite dans la room.

## Prérequis

- Installer le runtime RTC Node:

```bash
npm i @livekit/rtc-node
```

- Configurer les variables d'environnement (copie de `.env.example`).

## Endpoint token worker

`POST /api/livekit/translator/token`

Headers:

- `Content-Type: application/json`
- `x-translator-worker-secret: <TRANSLATOR_WORKER_SECRET>`

Body:

```json
{
  "room": "room-abc123",
  "sourceLanguage": "fr",
  "targetLanguage": "en",
  "voice": "alloy"
}
```

Réponse:

```json
{
  "token": "<livekit-jwt>",
  "identity": "bfzoom-translator-en-xxxxxx",
  "name": "BFZoom Translator (EN)",
  "metadata": {
    "role": "translator",
    "room": "room-abc123",
    "sourceLanguage": "fr",
    "targetLanguage": "en",
    "voice": "alloy"
  }
}
```

## Contrat côté worker

1. Se connecter à LiveKit avec le JWT.
2. Publier une piste audio traduite (source recommandée: `ScreenShareAudio`).
3. Conserver l'identité préfixée `bfzoom-translator-...`.

Les clients web/mobile BFZoom détectent déjà automatiquement cette piste et la priorisent.

## Orchestration auto (par room)

`POST /api/livekit/translator/session`

Body (`action: "ensure"`):

```json
{
  "action": "ensure",
  "room": "room-abc123",
  "sourceLanguage": "fr",
  "targetLanguage": "en",
  "voice": "alloy"
}
```

Body (`action: "release"`):

```json
{
  "action": "release",
  "room": "room-abc123"
}
```

Le client hôte appelle automatiquement cet endpoint lors de l'activation/désactivation Realtime.

## Lancer le worker

```bash
cp server/workers/livekit-translator/.env.example server/workers/livekit-translator/.env
# puis adapte les valeurs

set -a
source server/workers/livekit-translator/.env
set +a

npm run worker:translator
```
