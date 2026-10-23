# Lantern

**[Open the live browser demo](https://lantern-vision-demo.onrender.com)** · [Repair pull request](https://github.com/CodedMed/Lantern/pull/4)

An accessibility-focused **object-awareness prototype**: point a camera at a scene, or select a photo, and hear the objects it recognizes and their positions in the image.

**Not a navigation or safety aid.** Lantern can miss or misidentify hazards. Optional calibrated ranges are rough and unvalidated, not depth-sensor measurements. It cannot determine a safe route, detect drop-offs, or read signs. Do not use it to cross roads or replace established mobility aids.

## Try the browser demo

The browser app lives in `web/`. It needs **no backend, database, account, .env file, or API key**. It is suitable for free static hosting and works on desktop and mobile browsers.

1. On your phone, tap **Start camera** and allow camera access. The rear camera is preferred. Recognition begins automatically; no repeated scan button presses are needed.
2. Keep your phone steady. Boxes update continuously. Alerts focus on people, furniture, pets, and larger room obstacles—not laptops, TVs, keyboards, or other desk clutter. Brief cues such as **“Person on left”** and **“Chair ahead. Pause; check right.”** describe image positions and where to inspect, not verified safe routes.
3. **Pause/Resume** controls recognition, **Switch** changes cameras, **Voice** mutes/enables alerts, and **Repeat** replays the current brief cue. **Stop camera** releases the camera. Switching apps also turns it off.
4. Use **Demo photo** without camera permission, or **Upload photo** (JPG, PNG, WebP, AVIF; up to 15 MB). These are explicitly labeled still-photo modes, not live guidance.
5. **Settings** saves speech speed, speech on/off, larger text, detection threshold, and **Detail/Fast** model choice. Switching models restarts the page/camera. The interface is phone-first, white/black/grayscale, without a marketing landing page.
6. Optional: **Set distance** opens the measured-reference setup described below. Otherwise the app explicitly says **Distance unknown**, or describes sustained image-size growth/shrinkage without inventing meters.

The live loop targets a 250 ms frame period (roughly four updates per second on capable devices), scheduling the next frame only after the previous inference completes. It never builds a queue. Camera frames are bounded to a 640-pixel longest edge; the model is reused. Slower phones run at a lower rate. Results older than 1.4 seconds are discarded and overlays expire rather than remaining on screen indefinitely.

Ordinary object cues require two matching frames to reduce flicker. A prominent central object can trigger a brief pause cue immediately. Prominence is a **bounding-box heuristic, not measured depth or collision prediction**. Direction suggestions compare the union of detected box coverage in lower-left/right image sectors: **check** the less-covered side, never **walk** into it. If both sides are occupied or ambiguous, pause and inspect around/both sides. Empty detections do not prove free floor space. Ordinary unchanged cues are silent; a persistent prominent warning can repeat after 12 seconds. Voice output does not queue scene descriptions or continually restart the same phrase. Device/browser speech may require tapping Repeat once.

The first scan downloads TensorFlow.js and the pretrained model. Later scans reuse the same loaded model. Initial download time and inference speed depend on the network and device; the displayed timing measures **inference only**, not initial setup. The app uses WebGL where available and falls back to CPU if WebGL cannot initialize.

### Optional calibrated range

1. While stationary, measure the actual camera-to-object distance to one stationary, rigid piece of furniture (0.5–8 m). Do not guess a distance or calibrate on a person/pet.
2. Start the live camera, center the whole object, and hold the phone steady. In **Set distance**, select a stable furniture track, enter your measurement, and confirm you measured it. Photo mode cannot calibrate.
3. Keep the same object, lens/zoom, and viewing angle. The range uses the pinhole apparent-size relationship: `range = measured range × sqrt((reference width/current width) × (reference height/current height))`. Width/height are normalized detection-box dimensions. Readings are median-smoothed and rounded to 0.5 m.

This is **not automatic metric depth**, custom-trained ranging, or an accuracy guarantee. The estimator assumes unchanged camera intrinsics and an approximately fixed object face/bearing; it approximates camera-axis range for a centered object, not precise distance to its nearest surface. Geometric tracking is not identity recognition. Box jitter, occlusion, rotation, moving furniture, zoom, or an undetected similar-object swap can produce errors. Some such changes cannot be detected automatically. Numeric readings are withheld after detected tracking loss, clipped/ambiguous/changed views, or excessive size/bearing changes, and are reset by pause, camera changes, or settings. Recalibrate after moving/changing the view. No physical distance accuracy has been validated; never use these estimates to decide where it is safe to step.

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
  src/main.jsx           Phone-first camera UI, uploads, overlays and controls
  src/detector.mjs       Lazy-loaded model, deduplicated initialization, scan lock
  src/liveLoop.mjs       Backpressure, pause/cancel and frame freshness checks
  src/narrator.mjs       Short cues, duplicate suppression, no speech queue
  public/                Licensed sample scene, icon, third-party notices
  tests/core.test.mjs    Shared logic, retry/concurrency, backend fallback tests
utils/scene.mjs          Shared box normalization and conservative scene descriptions
utils/guidance.mjs       Browser image-space object prioritization and brief cues
utils/obstacles.mjs      Room-class whitelist and lower-image inspection suggestions
utils/rangeTracking.mjs  Short-lived geometric tracks, image growth, calibrated size ratio
utils/preferences.mjs    Shared validated preferences
App.js, screens/         Existing Expo/React Native mobile app
services/YOLODetector.js Native COCO-SSD wrapper; historical filename, NOT YOLO
```

Recognition uses **TensorFlow.js 4.22 / COCO-SSD 2.2.3**, pretrained for 80 COCO categories, with a room-focused output filter. The web default **Detail** uses MobileNet V2; **Fast** uses Lite MobileNet V2. The model's official documentation describes MobileNet V2 as the higher-accuracy variant and Lite as the smallest/fastest; this is not a measured Lantern accuracy gain. Weight downloads are approximately 67 MB vs 18 MB (excluding TensorFlow/runtime files). Fast is useful on slower phones. Native retains Lite. This project does not include custom-trained YOLO weights. Old design/training guides describe experiments or plans, not verified capabilities of the current demo. `config/modelConfig.js` and `services/OpenCVUtils.js` are legacy experiments and are not used by the current scanner.

COCO boxes arrive as pixel `[x, y, width, height]`; the shared layer converts them to normalized `[ymin, xmin, ymax, xmax]`. Both clients use the same coordinate convention. The web app adds short prioritized cues; native retains its separate scene-description UI. Uncalibrated objects never receive meter readings, and no "path clear" result is generated. Model confidence is not measured accuracy. Walls, doors, stairs, glass and small floor hazards are not reliably covered by these categories.

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
