# Demo validation — October 22, 2026

## Automated

- Clean `npm ci --prefix web`: successful, no dependency overrides needed.
- `npm run test:web`: 14 passing tests covering coordinates, invalid boxes,
  conservative descriptions, corrupted preferences, deduplicated model loading,
  failed-load retry, failed-inference unlock, CPU initialization fallback, camera
  denial, video-only permissions, missing camera APIs, and stale-camera cleanup.
- `npm run build:web`: successful production build. TensorFlow is lazy-loaded;
  Vite warns that its inference chunk is large. It is not in the initial UI chunk.
- `npm audit --prefix web`: no known vulnerabilities at validation time.
- Native local JS/import bundle check via esbuild: passed. This is **not** a
  native SDK build or physical-device test.

## Browser checks

- Bundled beach scene: real model returned 7 people/kite detections; displayed
  inference took 215 ms on this computer, excluding initial model loading.
- Separate cat photograph selected through the actual file chooser: real model
  returned a cat at 93% model confidence, 193 ms displayed inference.
- High contrast and larger text settings remained enabled after a reload.
- A Markdown file selected in the photo chooser produced a readable validation
  error without replacing the selected scene.
- Phone-width and desktop-width layouts checked without horizontal overflow.
- No browser error/warning logs observed during the tested photo flows.

These are individual observed runs, not a benchmark, accuracy evaluation, or
before/after comparison. Cold startup, CPU-only devices, and mobile hardware may
be significantly slower. Confidence is a model score, not measured accuracy.

## Still requires a human/device check

- Grant camera permission on a physical phone and test scanning, auto-scan,
  backgrounding, and return-to-camera behavior in its browser.
- Confirm audible playback on that device; browser autoplay and OS voice
  services vary. Tap Read again if automatic speech is blocked.
- Run the Expo native app on real iOS/Android hardware before claiming native
  compatibility. Its older TensorFlow adapter has legacy peer constraints.
- Accessibility testing with VoiceOver/TalkBack users and an actual accuracy
  evaluation remain future work. Do not use this prototype as a mobility aid.
