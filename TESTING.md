# Demo validation — October 22, 2026

## Live camera revision

- Replaced the 1.8-second inter-scan wait with a serialized loop targeting a
  250 ms frame period. This is a scheduling target, **not a measured phone FPS**.
- Added tests for frame backpressure, slow inference, cancellation during a scan,
  rapid pause/resume, stale-result rejection, and browser timer receiver binding.
- Added tests for image-space alert priority, two-frame cue stability, short
  narration, duplicate suppression, no speech queues, mute, manual replay and
  12-second prominent-object reminders.
- Physical phone camera/voice checks remain necessary; no phone performance or
  safe navigation capability is claimed by the automated tests.
- With explicit user permission, a real local computer webcam was tested: live
  video and central-person recognition worked; Pause removed overlays; Resume
  restored detection; camera switching/restart worked; mute persisted across a
  restart; Stop returned to Camera off with zero video elements or overlays.
  No camera screenshots or recordings were saved. This is not a physical-phone
  test or confirmation that two distinct cameras were available on that computer.

## Automated

- Clean `npm ci --prefix web`: successful, no dependency overrides needed.
- Initial repair `npm run test:web`: 14 passing tests covering coordinates, invalid boxes,
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

## Room-obstacle and calibrated-range revision

- `npm run test:web`: **54 passing tests** including the existing regression tests,
  room-output filtering, model selection, union-area sector coverage, conservative
  check-direction suggestions, image-size trends, synthetic pinhole range math,
  stale/clipped/off-center/tiny/ambiguous targets, changed bearing/aspect/shape,
  non-reused track IDs, and invalid measurement rejection.
- `npm run build:web`: passed. No dependencies or API keys were added. The
  larger lazy TensorFlow chunk still produces Vite's bundle-size warning.
- Detail is now the browser default, with Fast available in Settings. This uses
  official pretrained variants, not custom training or a validated accuracy gain.
- Real Detail inference on a temporary COCO room photo produced sofa/cat boxes
  and omitted remote-control boxes. The temporary test photo is not bundled or
  distributed with the app. This single fixture is not an accuracy evaluation.
- Distance setup was checked with the camera off: it explains the need for a
  live view and measured reference, offers no reference, and disables submission.
  Photo mode cannot provide a valid measurement reference.
- Changing to Fast restarted the page with Camera off, persisted the selected
  option, and successfully ran the bundled sample photo with real inference.
- One warmed Detail inference on the room fixture displayed 22 ms on this
  computer's WebGL backend. This excludes download/setup and camera latency;
  it is not a mobile benchmark or before/after speed claim.
- Range tests use **synthetic boxes and known mathematical ratios**, not physical
  measurements. They validate implementation and rejection rules only. Physical
  calibration error, different lenses, moving cameras/furniture, similar-object
  substitutions, and safe navigation have **not** been validated. Ranging is
  explicitly marked rough/unvalidated and cannot serve as collision avoidance.
- No private camera frames were recorded or uploaded for this revision.
