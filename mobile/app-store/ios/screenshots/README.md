# iOS Screenshots (App Store)

## 1) Ajouter tes captures brutes

Dépose tes captures dans:

`mobile/app-store/ios/raw/`

Formats acceptés: `png`, `jpg`, `jpeg`, `webp`.

## 2) Générer les tailles App Store

Depuis `mobile/`:

```bash
python3 scripts/generate_appstore_screenshots.py
```

Ta sortie sera dans:

`mobile/app-store/ios/screenshots/`

Tailles générées par défaut:

- `1284x2778`
- `2778x1284`
- `1242x2688`
- `2688x1242`

## 3) Générer seulement portrait (recommandé)

```bash
python3 scripts/generate_appstore_screenshots.py \
  --targets 1284x2778,1242x2688
```

## 4) Upload App Store Connect

Dans App Store Connect > iOS screenshots, tu peux glisser les PNG générés.
