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
- Gives short, action-first **pause/check** cues, never a verified safe walking
  route. Ordinary distance, direction, and uncertainty changes finish the current
  sentence. Only an escalation to a close-ahead warning can interrupt lower-priority
  speech, bounded to avoid repeated interruptions during level oscillation.
- Keeps only current-frame speech context, not an utterance backlog. Requires a
  brief stable cue (0.45 s unconfirmed ordinary / 0.8 s unknown), uses an actual synthesis
  completion callback and a 0.8 s gap, and can remind persistent context after
  12 seconds. Close-ahead escalations do not wait for stability. These are UX
  heuristics, not validated safety response times. Visual meters still clear
  immediately even if a spoken snapshot finishes.
- Repeat does not restart an active sentence. A voice-speed control is available;
  VoiceOver voice/speed preferences take precedence through Apple's assistive
  technology setting. iOS manages the speech audio session. No paid voice API.

Each region explains missing meters: insufficient confident depth, outside the
software range window, only classified floor sampled, or no supported surface
patch. Unknown still clears the old number immediately; no lowered confidence
threshold, invented distance, or stale-number grace period is used. The displayed
sample percentage describes in-range, high-confidence grid coverage, **not sensor
accuracy**. The in-app help explains positioning and these limits.

Leaving and returning reads new depth. There is no chair identity, stored chair
size, runtime distance calibration, or manual same-chair confirmation.

## Direction to inspect (not permission to walk)

The three numbers cannot establish a traversable corridor, detect every step or
drop-off, or account for body width. The native app therefore says **Check left,
Check ahead, Check right**, or explains why no direction is selected. These are
phone-relative regions to inspect while stationary, not navigation commands.

- Requires fresh, ordered data, a classified floor, and a valid distance with
  at least 60% in-range/high-confidence grid coverage in **all three** regions
  **for a CHECK comparison**. If a region is missing/low-coverage, the app instead
  gives a distinct **SCAN [region]** instruction to acquire depth with the phone.
  A SCAN is never a confirmed comparison or a walking recommendation; that region
  stays Unknown if depth is absent. The raw sensor/coverage thresholds are unchanged.
  A floor somewhere in the map does not establish a continuous floor under a route.
- Requires an upright portrait view, aiming within 25° of level; restarts the
  comparison after more than 12 cm translation or 10° rotation from the reference
  view. These pose checks reduce mixing scenes; they do not detect walking reliably.
- Normally a candidate must persist for at least 0.8 s across five distinct
  frames, without a gap longer than 0.5 s. A **strong-reading fast path** requires
  at least 0.35 s and four distinct frames: every contributing frame must have
  >=80% coverage in all regions, each region's range variation <=0.2 m, and
  stronger margins. A side needs >=2 m range, >=1 m advantage over ahead and
  >=0.8 m over the opposite side; ahead needs >=2.25 m with both sides >=1.25 m.
  These are acquisition thresholds, **not measured end-to-end response times or
  accuracy percentages**. Other usable readings still take the normal path.
  Raw current-frame distances determine eligibility, so display smoothing
  cannot preserve a now-ineligible side.
- Prefers inspecting ahead if its supported surface is at least 1.75 m away and
  neither side has a supported surface closer than 0.75 m. Otherwise, a side
  needs a surface at least 1.75 m away, at least 0.6 m farther than ahead, and
  at least 0.5 m farther than the opposite side. A large value alone never wins.
- Similar distances, all-nearby surfaces, missing/low-coverage depth, unclassified
  floor, excessive tilt, or a changed view immediately withdraw the visual choice.
  Reversals must settle again; the previous direction is not held through uncertainty.
- Recovery prioritizes missing Ahead depth; otherwise it keeps one uncertain side
  until that side recovers, avoiding scan-prompt flipping as coverage fluctuates.
  Once all regions recover, CHECK acquisition starts again from zero. An unknown
  side is not inserted into a distance ranking or treated as farther/open space.
- Close-ahead warnings still start without waiting for direction acquisition.
  Short prompts put the action first ("Pause. Check right with the phone."). A
  direction that has already stabilized does not wait through a second voice
  debounce or the ordinary three-second start cooldown; it still waits for the
  current sentence and the 0.8 s completion gap. No ordinary change cuts speech.
  The already-playing spoken snapshot can briefly differ from the live panel.

The large advice card and Start/Stop/Repeat controls are above the preview and
distances, not hidden below the camera. Full reasons are in "Why this advice?".
This makes the recommendation easier to find without inventing certainty.
Primary direction prompts stay brief; **Distances** reads all three current
surface measurements on demand, including Unknown. Like Repeat, it never cuts
off a sentence already playing. It rechecks freshness at the tap and does not
queue an old distance readout.

All thresholds above are **unvalidated engineering heuristics**, not measured
error bounds, clinically established margins, or a collision-avoidance guarantee.
The app never says a path is safe or tells someone to start walking. It needs
systematic supervised physical and accessibility testing before navigation use.

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
Direction tests cover all 343 combinations of seven synthetic distances in three
regions, plus missing/floor-only depth, stronger coverage, pose changes, tilt,
reversals, flickering candidates, stale/repeated frames, and speech completion.

## Physical-device acceptance checklist

Initial iPhone 15 Pro Max smoke test: installed and launched using Personal Team
signing; the user reported wall distances decreasing as the phone moved closer,
with intermittent Unknown readings. This confirms a basic live-depth interaction,
**not measured accuracy, comprehensive acceptance, or safe navigation**. The
checklist below still needs systematic physical testing; automated tests cannot
replace it.

Audio/direction smoke test: the user reported clearer, complete iPhone speech and
confirmed that the initial direction panel and speech work. This is user feedback,
not an accessibility study or proof of safe route selection. The subsequent larger
advice card, adaptive fast acquisition and shorter prompts were installed. The user
then reported unavailable guidance and supplied a screenshot: Left ~1.9 m/77%,
Ahead ~1.4 m/83%, Right Unknown/low-confidence, with a classified floor. This
identified the all-three-region comparison gate, not a floor-classification failure.
The follow-up targeted SCAN recovery and Stop-label contrast fix require a new
physical check; automated tests alone do not confirm sensor behavior or response time.

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
- In a stationary supervised setup, compare a near opaque surface ahead with a
  farther side. Wait for a steady-view check, then pan/tilt, obscure one region,
  or bring a surface into that side; the direction must withdraw and settle anew.
  Similar side distances must not cause rapid left/right flipping. Listen for
  complete, non-overlapping sentences and check Repeat/mute/voice speed.

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
