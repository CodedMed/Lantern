# Lantern

**[Open the live browser demo](https://lantern-vision-demo.onrender.com)** · [Repair pull request](https://github.com/CodedMed/Lantern/pull/4)

An accessibility-focused **object-awareness prototype**: point a camera at a scene, or select a photo, and hear the objects it recognizes and their positions in the image.

**Not a navigation or safety aid.** Lantern can miss or misidentify hazards. It cannot measure reliable distance, determine a safe route, detect drop-offs, or read signs. Do not use it to cross roads or replace established mobility aids.

## Try the browser demo

The browser app lives in `web/`. It needs **no backend, database, account, .env file, or API key**. It is suitable for free static hosting and works on desktop and mobile browsers.

1. Click **Try the demo** to run real recognition on the bundled sample scene. No camera permission is needed.
2. Choose **Upload photo** (JPG, PNG, WebP, AVIF; up to 15 MB), or **Use camera** and allow camera access. Phone cameras require HTTPS; `localhost` is allowed for development.
3. Click **Scan scene**. Results include actual model labels, confidence scores, left/center/right image positions, bounding boxes, and inference timing.
4. Toggle spoken descriptions or click **Read again**. Some browsers require this explicit tap before allowing speech. Camera auto-scan performs one scan at a time and throttles repeated speech.
5. **Settings** saves speech speed, speech on/off, contrast, text size, and recognition threshold in this browser.

The first scan downloads TensorFlow.js and the pretrained model. Later scans reuse the same loaded model. Initial download time and inference speed depend on the network and device; the displayed timing measures **inference only**, not initial setup. The app uses WebGL where available and falls back to CPU if WebGL cannot initialize.

### Run locally (macOS, Windows, Linux)

Install Node.js **22.12 or later**. From the repository root:

```sh
npm run web:install
npm run web
```

Open the local URL printed by Vite (normally `http://localhost:5173`). You do **not** need to install the root Expo dependencies for the web app.

```sh
npm run test:web
npm run build:web
npm run preview --prefix web
```

## Architecture

```text
web/                     React + Vite browser application (separate locked dependencies)
  src/main.jsx           Camera, uploads, overlays, speech, accessible controls
  src/detector.mjs       Lazy-loaded model, deduplicated initialization, scan lock
  public/                Licensed sample scene, icon, third-party notices
  tests/core.test.mjs    Shared logic, retry/concurrency, backend fallback tests
utils/scene.mjs          Shared box normalization and conservative scene descriptions
utils/preferences.mjs    Shared validated preferences
App.js, screens/         Existing Expo/React Native mobile app
services/YOLODetector.js Native COCO-SSD wrapper; historical filename, NOT YOLO
```

Recognition uses **TensorFlow.js 4.22 / COCO-SSD 2.2.3, Lite MobileNet V2**, pretrained for 80 COCO categories. This project does not include custom-trained YOLO weights. Old design/training guides describe experiments or plans, not verified capabilities of the current demo. `config/modelConfig.js` and `services/OpenCVUtils.js` are legacy experiments and are not used by the current scanner.

COCO boxes arrive as pixel `[x, y, width, height]`; the shared layer converts them to normalized `[ymin, xmin, ymax, xmax]`. Both clients use the same coordinate convention and object-awareness descriptions. No fabricated distance or "path clear" result is generated. Model confidence is not measured accuracy.

Photos and camera frames are processed locally, not uploaded or stored by Lantern. Static assets and model weights still require network requests; model files come from Google's public TensorFlow.js model hosting. Speech uses the browser/OS voice service, which may have its own network requirements. Preferences are stored locally; no analytics or camera recording is added.

## Free Render deployment

Create a **Static Site**, not a Web Service, using this Git repository and the repair branch (or the branch after merging):

| Setting           | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Root directory    | Leave empty (shared code lives outside `web/`)                          |
| Build command     | `npm ci --prefix web && npm run test:web && npm run build:web`          |
| Publish directory | `web/dist`                                                              |
| Environment       | `NODE_VERSION=22`, `SKIP_INSTALL_DEPS=true` (non-secret build settings) |

There are no client-side routes requiring SPA rewrites. The static site needs no sleeping backend. Render's workspace bandwidth/build-minute limits still apply; no paid compute or database is required. The dependency lockfile is committed for reproducible installs. GitHub Actions also runs tests and the production build.

## Native app status

The original Expo app is retained. Its scanner now identifies the actual COCO-SSD model, disposes decoded tensors and temporary captures, requests camera permission explicitly, serializes auto-scans, stops camera/speech when backgrounded, and uses real saved preferences. The simulated microphone transcription button was removed rather than presented as working speech recognition.

The native TensorFlow adapter is older than Expo SDK 54 and has legacy peer dependency constraints. The **browser build is the tested demo target**; these native changes require a physical-device Expo/development-build test before claiming native support. Do not assume the hosted browser app is an App Store-ready native release.

For native development only, the pre-existing dependency setup is:

```sh
npm install --legacy-peer-deps
npm start
```

Use the browser demo if Expo Go or the native GL adapter is incompatible with your device. The web build deliberately does not depend on those native modules.

## Source and credits

Repairs are based on the fuller `new_andrew` app branch, not the largely starter-only `main` branch. Deployment changes are isolated on `fix/lantern-web-demo` for review.

Sample image and TensorFlow model credits are in `web/public/THIRD_PARTY_NOTICES.txt`; the upstream Apache license is included alongside it. Sample results are calculated live, not mocked.
