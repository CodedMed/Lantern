# Lantern LiDAR — native iPhone prototype

Automatic **visible-surface proximity alerts** using real ARKit LiDAR. This is
not validated navigation, full-body clearance checking, or a replacement for a
cane, guide dog or trained assistance. Intended hardware: iPhone 15 Pro Max or
another device passing the runtime LiDAR check; iOS 17+.

This is a separate SwiftUI app. It is not Safari/PWA LiDAR functionality, an
App Store/TestFlight release, or an update to the Render website. The website
and legacy Expo app are preserved.

## Run on your iPhone

1. Install full Xcode and finish Apple's initial setup. Command Line Tools alone
   do not provide the iOS SDK.
2. Open `native/LanternLiDAR/LanternLiDAR.xcodeproj` and select the
   LanternLiDAR scheme.
3. Connect and unlock a supported phone by USB-C; complete Trust yourself.
4. In Signing & Capabilities, choose your Personal Team and automatic signing.
   Use your own unique bundle ID if needed. No signing credentials are committed.
   Personal Team signing is development testing, not public distribution.
5. Enable Developer Mode on the phone following Xcode's instructions. Handle
   security settings, passwords, trust prompts and any restart yourself.
6. Press Run, allow camera access, then tap **Start**. Hold the phone upright,
   pointing along the body's forward direction. Stop camera/background releases
   the session and clears readings; restarting is explicit.

There is **one live flow**. No obstacle-demo toggle, floor scan, room scan,
calibration step, or left/right scan checklist. Floor classification can improve
filtering automatically but is never required to obtain a proximity reading.

## What it says

| Situation | Display / short speech |
| --- | --- |
| Forward band has usable depth and no close measured surface | FORWARD VIEW / “No close surface measured ahead.” |
| Farther obstacle ahead | OBSTACLE AHEAD / approximate distance and “Slow down.” |
| Close obstacle plus a reliably farther measured side | STOP · TURN LEFT/RIGHT / “Stop. Turn left/right and recheck.” |
| Very close sampled surface anywhere in the three bands | STOP / “Surface very close.” |
| Side surface is close but the forward band is farther | CLOSE ON LEFT/RIGHT / “Keep clear.” |
| Neither side is reliably measured around a close obstacle | STOP / “Obstacle ahead.” |
| Close surfaces measured in all three bands | STOP · VIEW BLOCKED / “Close surfaces left, ahead and right.” |
| Fresh depth is insufficient or the phone is pointed away | DEPTH UNCERTAIN / pause, or POINT CAMERA FORWARD |

The arrow compares **visible surfaces**, not a certified route. A turn means
stop and reorient **in place**, then check again before a step. Body orientation
is not independently measured; the phone must remain aligned with the body.
There is no instruction to sidestep or back into unseen space.

Pointing directly at a wall around 1.1 m away can correctly measure close
surfaces in all three bands. **VIEW BLOCKED** distinguishes this from missing
depth or a loading/scan step. It does not identify the material as a wall or
claim the entire room is blocked. A turn target is highlighted only after a
farther side meets the existing confidence, coverage and stability checks.
Changes in the current view update advice automatically; there is no manual
scan sequence or assumption about space outside the camera view.

Prototype fixed thresholds: 2.3 m early warning (exit at 2.6 m), 1.4 m avoidance
hint, 0.65 m close-surface STOP. These are **unvalidated engineering heuristics**,
not safe stopping distances or settings adapted to walking speed. Do not defer
stopping until a threshold if a helper, mobility aid or your assessment indicates
danger. A 2.2 m wall alone should warn rather than initiate a turn.

## Measurement pipeline

1. Check ARKit scene-depth support and a real rear LiDAR capture device. The
   simulator/unsupported phones show an explanation, not fake depth.
2. Read the same frame's raw scene depth and confidence buffers. Validate formats,
   dimensions, independent byte-row strides and buffer locks.
3. Build **360 gravity-level rays**: 10 columns × 12 rows in each of three bands.
   Horizontal angles are left −24…−8°, ahead −10…10°, right 8…24°; vertical angles
   are ±12°. Use the frame's real camera transform and intrinsics to project the
   rays into the raw sensor image, independent of portrait rotation/preview crop.
   Out-of-view or invalid rays remain Unknown.
4. Unproject each sampled pixel centre using its camera-Z depth and intrinsics;
   report Euclidean/slant distance. Accept only finite, high-confidence (2)
   samples inside the 0.2–4.5 m software window. A confidence value is not an
   accuracy guarantee.
5. Automatically exclude samples lying within classified floor boundary polygons,
   if available. No guessed floor height or “everything horizontal is floor”
   rule. The **level sensing band** avoids looking broadly at the floor, but this
   also means low and overhead hazards may be missed.
6. Keep both the closest individual non-floor hit and the nearest connected
   surface patch (at least six neighboring samples, patch 20th percentile).
   A thin closer hit can override a dominant far wall. The big distance cards,
   warning distance and on-demand Distances speech all use closest samples;
   diagnostics distinguish patch distance from closest-hit distance.
7. Require a usable forward patch plus ≥50% coverage, ≥35% non-floor coverage in
   each height band and ≥20% in each lateral column. A side hint is stricter:
   ≥75% overall coverage, ≥60% non-floor coverage per height band, ≥50% per
   lateral column, patch ≥2 m and ≥0.7 m farther than ahead, and **no individual
   measured side hit closer than 1.8 m**. Unknown never becomes “far away.”
   A measured side can be considered without measuring the opposite side.
8. Prefer an already-confirmed side until a challenger has at least 0.5 m more
   measured distance. A turn requires three distinct frames and ≥0.25 s of
   consistent evidence; at a 10 Hz scheduling cap that normally needs a fourth
   frame. Forward/warning output does not wait for a stationary floor/body scan.
   Do not treat these constants as measured response time or phone FPS.
9. Withdraw a turn on new close/unknown depth, side reversal, stale/out-of-order
   frames, or changed heading. Current raw data drives advice; there is no old
   clear-space map or display median hiding a new close hit. Frames expire after
   0.5 s. A cumulative 10° change from an instructed heading forces rechecking.
10. Process at most 10 times/second, keeping only scalar advice/debounce state.
    No queued or retained ARFrames, RGB images, depth maps, room map or uploads.
    “Last analysis pass” measures local processing wall time, **not sensor-to-
    speech latency**.

These checks are for a **limited sensing band**. Even a fully measured band does
not establish person-sized clearance, footing, a destination route, or a safe
walking direction. Steps, holes, glass, thin hazards and obstacles outside the
camera field may be missed. Do not use this for independent blind walking or
road crossing.

## Speech

- Short action-first messages use Apple's on-device speech synthesizer.
- Normal sentences finish; only a new STOP revokes a lower-priority obsolete
  instruction immediately. Turn hints do not interrupt ordinary speech.
- No utterance backlog: only the latest advice is offered. Actual completion
  callbacks and a 0.8 s gap pace speech. Persistent semantic states can remind
  after 12 s; decimal distance changes do not restart narration.
- Repeat waits for idle speech. Distances speaks the three **current closest
  sampled** readings, including Unknown, after checking freshness.
- A speed slider is available. Apple's assistive-technology voice/speed settings
  take precedence when VoiceOver is enabled. Stop, mute and background cancel speech.

## Removed workflow

The floor-gated 75-probe / seven-heading obstacle demo and its scan-memory engine
were removed from the app and source. Its assumptions made the interaction
unusable in the user's room: good distance readings could still lead to repeated
floor/side scans. That implementation remains recoverable in Git history
(commit `1ba98fd`).

The generic older inspection utilities and their compatibility tests remain in
DepthCore, but **the app does not call their SCAN/CHECK or floor-gated guidance**.
The production native flow calls LiveProximityGuide only.

## Build and test checks

The GitHub **Native LiDAR checks** workflow runs:

1. SwiftPM core tests on macOS with full Xcode.
2. The app build and the same core tests on an installed iPhone simulator.
3. Unsigned Release compilation for physical iOS/ARM64.
4. Website regression tests and production build in a separate Ubuntu job.

Logs, XML and Xcode result bundles are saved for diagnosis. CI does not need an
Apple Account. A simulator/unsigned build does **not** validate signing, sensor
behavior, physical accuracy, end-to-end latency or safe navigation.

Locally:

```sh
swift test --package-path native/LanternLiDAR
```

With only Command Line Tools, core compilation may work while XCTest/iOS checks
remain unavailable:

```sh
swift build --package-path native/LanternLiDAR --target DepthCore
```

Tests cover fresh/stale/invalid depth, floor filtering, thin hits vs far patches,
coverage across height and lateral bands, left/right selection, unknown-side
rejection, close warnings, temporal stability, cumulative turns, speech completion
and immediate STOP cancellation. The live guide is checked over all 343
combinations of seven synthetic distances across three regions. A synthetic
portrait-camera fixture checks ray visibility and projection round trips; it is
not a measured iPhone FOV or accuracy result.

## Physical checks still required

Earlier iPhone 15 Pro Max tests confirmed live wall readings changing with
distance and improved sentence completion. User feedback rejected the old
floor-scan interaction. Neither observation validates this replacement.

For the new version, test **stationary with a sighted helper**:

- Start and face an opaque surface around 2 m away. Confirm a warning appears
  without any floor/room scan. Record time to first reading and actual errors.
- Stay still while a helper brings an opaque surface closer. Confirm a STOP and,
  if one side is well measured, the correct relative stop-and-turn hint. Do not
  test by walking into an obstacle.
- Remove/obscure a side: its hint must withdraw, not retain old advice.
- Reorient in place; obsolete turns must cancel before new advice.
- Check close side surfaces, thin objects, dark/reflective materials, low and
  overhead hazards, stairs/drop-offs, and out-of-view limitations under supervision.
- Check permission denial, mute, speed, Repeat, Distances, Stop, background and
  session interruption. Listen for complete non-overlapping normal sentences.

No measured accuracy, safe-route success rate, walking speed, or latency claim
is established by these tests.

## Privacy and scope

No API keys, microphone, location, photo-library access, analytics, recording or
uploads. Sensor processing stays on the phone. Native object labels are not
implemented: this measures geometry rather than naming laptops/TVs/keyboards.
Fusing semantic detections with depth would require alignment to the same frame.

## Primary references

- [Apple: scene-depth capability](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth)
- [Apple: confidence and surface limitations](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap)
- [Apple: scene-depth point cloud / unprojection](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth)
- [Apple: physical-device development](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
- [Apple: Personal Team signing](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html)
