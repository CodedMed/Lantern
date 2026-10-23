# Lantern LiDAR — native iPhone prototype

Real ARKit LiDAR scene depth, without a measured-chair reference or API key.
Intended hardware: **iPhone 15 Pro Max** (or another device passing the runtime
LiDAR capability check), iOS 17+. **Not a validated navigation/mobility aid.**

This is a separate Apple-framework-only SwiftUI app. It is **not** Safari/PWA
functionality, Expo Go, an App Store/TestFlight release, or an update to the
Render website. The existing web app and legacy Expo app are preserved.

## Run on your iPhone

1. Install **full Xcode** from Apple's Mac App Store and complete Apple's setup
   yourself. Command Line Tools do not contain the iOS SDK or necessarily XCTest.
2. Open `native/LanternLiDAR/LanternLiDAR.xcodeproj` in Xcode.
3. Connect/unlock your iPhone by USB-C. Complete its Trust prompt yourself.
4. Select the **LanternLiDAR** scheme and your physical phone. Under the app
   target's **Signing & Capabilities**, choose your own **Personal Team** and
   automatic signing. If necessary, change the bundle ID to a unique value.
   No signing identity or credentials are committed. Personal Team installation
   is development testing on your device, not public/permanent distribution.
5. Follow Xcode's instructions to enable **Developer Mode** on your phone. Handle
   the security setting and any required restart yourself.
6. Press Run, allow camera access, then tap **Start LiDAR**. Aim at an opaque
   nearby surface while stationary. No distance entry is needed. Stop/background
   clears readings and releases the session. Restart is explicit.

## Distance pipeline

- Runtime checks for ARKit scene depth **and** a real rear LiDAR capture device.
  Unsupported phones/simulators get an explanation, not fake depth.
- Reads `ARFrame.sceneDepth.depthMap` with that frame's own `confidenceMap`.
  Validates buffer formats, dimensions, locks, and independent byte-row strides.
- Applies inverse ARKit display transformation for portrait rotation and camera
  aspect-fill cropping. Unprojects the sampled depth pixel's center using the
  frame's actual camera intrinsics; computes its Euclidean/slant range.
- Samples three screen regions, 10 × 12 cells each (360 total), at most 10 times
  per second. That is a scheduling cap, **not measured phone FPS**.
- Accepts only high-confidence, finite readings within a prototype software
  window of 0.2–4.5 m. Invalid/out-of-window/missing data stays Unknown.
- Requires at least 35% valid coverage and a connected patch of six samples.
  Uses the nearest supported patch's 20th percentile, not a single noisy minimum
  pixel. This can still miss thin/small obstacles and is not exact minimum range.
- Uses a three-reading median, bypassing old history for a substantially closer
  new surface. Readings expire after 0.5 seconds; uncertain/missing frames remove
  distances immediately. Frames predating the latest Start are rejected.
- Excludes points near **classified floor boundary polygons**, not a bounding box, a guessed
  floor height or every horizontal table. Before floor classification, ground
  may be included in readings; side-selection suggestions are withheld.
- Gives short **pause/check** cues, never a verified safe walking route. iOS
  speech is throttled and not queued. A new warning can replace routine speech
  (at most once a second); loss of a previously measured distance cancels old
  speech immediately. Repeated missing frames do not cut that warning off.
  No paid voice API is needed.

Each region explains missing meters: insufficient confident depth, outside the
software range window, only classified floor sampled, or no supported surface
patch. Unknown still clears the old number immediately; no lowered confidence
threshold, invented distance, or stale-number grace period is used. The displayed
sample percentage describes in-range, high-confidence grid coverage, **not sensor
accuracy**. The in-app help explains positioning and these limits.

Leaving and returning reads new depth. There is no chair identity, stored chair
size, runtime distance calibration, or manual same-chair confirmation.

Filters/thresholds are engineering heuristics, not established safety margins or
validated accuracy guarantees. LiDAR can fail on glass, mirrors, dark/reflective
surfaces, sunlight, occlusion, motion and uncertain tracking. Floor classification
may be absent or wrong. Hazards outside the sampling grid can be missed. Unknown
does not mean clear. Do not rely on this for stairs/drop-offs, curbs, traffic,
overhead clearance, mobility-aid replacement or road crossing.

## Deliberate limitations

This native prototype measures **surface geometry**. It does not yet fuse the web
COCO-SSD people/furniture labels with native depth or announce laptop/TV/keyboard
class labels. Per-object LiDAR requires native detections aligned to the **same
ARFrame** before claiming those capabilities. No RGB/depth data is recorded or
uploaded. No analytics, API keys, microphone, location or photo-library access.

## Tests and build checks

The GitHub **Native LiDAR checks** workflow runs:

1. SwiftPM depth-core XCTest tests on macOS with full Xcode.
2. Xcode app build and the same core tests on an installed iPhone simulator.
3. Unsigned Release compilation for physical iOS/ARM64 devices.
4. Existing website tests and production build, in a separate Ubuntu job.

It saves XML, Xcode result bundles and build logs for diagnosis. A simulator or
unsigned device build does **not** validate a real LiDAR feed, signing, actual
phone performance or distance accuracy. No Apple Account is used in CI.

Locally, full Xcode allows `swift test --package-path native/LanternLiDAR` and
Product > Test in the supplied scheme. With only Command Line Tools:

```sh
swift build --package-path native/LanternLiDAR --target DepthCore
```

The core may compile while XCTest and all iOS SDK checks remain unavailable.
Tests use synthetic grids for confidence/coverage, connected patches vs outliers,
floor masking, stale/out-of-order frames, loss/return, closer surfaces, smoothing,
unprojection and conservative cues. They do not establish sensor accuracy.

## Physical-device acceptance checklist

Initial iPhone 15 Pro Max smoke test: installed and launched using Personal Team
signing; the user reported wall distances decreasing as the phone moved closer,
with intermittent Unknown readings. This confirms a basic live-depth interaction,
**not measured accuracy, comprehensive acceptance, or safe navigation**. The
checklist below still needs systematic physical testing; automated tests cannot
replace it.

While stationary (with a sighted helper if needed):

- Check an opaque surface at known camera-to-surface distances around 0.5, 1, 2,
  and 3 m. Record actual error/variability and time to first reading before
  reporting accuracy. Measuring here is **validation, not operating calibration**.
- Pan away and return: fresh meters must reappear without a chair measurement
  or confirmation; absent/uncertain data must not leave a stale reading.
- Test portrait alignment/crop, floor vs table, dark/reflective surfaces, and
  covering the sensor. Unreliable readings must remain Unknown.
- Test first permission grant/denial, Stop, background/return and interruptions.
  Camera and voice must stop correctly. Do not test by walking toward obstacles.

## Primary research

- [Apple: iPhone 15 Pro Max LiDAR hardware](https://support.apple.com/en-us/111828)
- [Apple: scene depth and capability checks](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth)
- [Apple: depth in meters](https://developer.apple.com/documentation/arkit/ardepthdata/depthmap)
- [Apple: confidence and surface limitations](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap)
- [Apple: depth unprojection sample](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth)
- [WebKit engineer: iOS WebXR unsupported](https://bugs.webkit.org/show_bug.cgi?id=309550#c2)
- [Apple: physical-device development](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
- [Apple: Personal Team signing](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html)
- [Apple: Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
- [Google: Android ARCore depth](https://developers.google.com/ar/develop/depth)

ARCore is an Android alternative, often depth-from-motion with optional ToF
fusion—not a way to expose iPhone LiDAR in Safari. Installing the website as a
PWA does not grant it native ARKit access.
