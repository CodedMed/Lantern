import test from "node:test";
import assert from "node:assert/strict";
import {
  filterRoomDetections,
  inspectionAdvice,
} from "../../utils/obstacles.mjs";
import { RangeTracker } from "../../utils/rangeTracking.mjs";
import { getGuidance } from "../../utils/guidance.mjs";
import { Detector } from "../src/detector.mjs";

const camera = { width: 640, height: 960 };
const make = (name = "chair", box = [0.2, 0.3, 0.6, 0.6], score = 0.9) => ({
  class: name,
  bbox: box,
  score,
});
function ready(name = "chair", box = [0.2, 0.3, 0.6, 0.6]) {
  const tracker = new RangeTracker();
  let result;
  for (const at of [0, 250, 500, 750])
    result = tracker.update([make(name, box)], at, camera);
  return { tracker, id: result[0].trackId };
}

test("room filtering removes desk electronics from both alerts and returned detections", () => {
  const names = [
    "laptop",
    "tv",
    "keyboard",
    "mouse",
    "remote",
    "cell phone",
    "cup",
    "person",
    "chair",
    "couch",
    "dining table",
    "bed",
  ];
  const detections = names.map((name) => make(name));
  assert.deepEqual(
    filterRoomDetections(detections).map((item) => item.class),
    ["person", "chair", "couch", "dining table", "bed"],
  );
  assert.equal(getGuidance([make("laptop")]).alert, null);
});
test("model output is filtered and the detail model is requested by default", async () => {
  let config;
  const service = new Detector(async () => [
    {
      setBackend: async () => true,
      ready: async () => {},
      getBackend: () => "webgl",
    },
    {
      load: async (options) => {
        config = options;
        return {
          detect: async () => [
            { class: "laptop", bbox: [10, 10, 40, 40], score: 0.99 },
            { class: "chair", bbox: [10, 10, 40, 40], score: 0.9 },
          ],
        };
      },
    },
  ]);
  const result = await service.detect({ width: 100, height: 100 });
  assert.equal(config.base, "mobilenet_v2");
  assert.deepEqual(
    result.detections.map((item) => item.class),
    ["chair"],
  );
});
test("inspection suggests checking the lower-coverage side, never a walking command", () => {
  const advice = inspectionAdvice([make("chair", [0.4, 0.05, 0.98, 0.34])]);
  assert.equal(advice.check, "right");
  assert.match(advice.message, /Check right/);
  assert.match(advice.detail, /not a verified clear path/);
  assert.doesNotMatch(advice.message, /walk|move|safe|clear|turn/i);
});
test("no detections on either side remain unknown rather than a safe route", () => {
  const advice = inspectionAdvice([]);
  assert.equal(advice.check, "both");
  assert.match(advice.detail, /Neither side has been verified clear/);
});
test("overlapping duplicate boxes do not double-count object coverage", () => {
  const detection = make("chair", [0.4, 0.05, 0.98, 0.34]);
  assert.deepEqual(
    inspectionAdvice([detection]).coverage,
    inspectionAdvice([detection, detection]).coverage,
  );
});
test("both heavily occupied sides produce a pause rather than choosing an arbitrary escape route", () => {
  assert.equal(
    inspectionAdvice([
      make("chair", [0.3, 0.01, 0.99, 0.4]),
      make("couch", [0.3, 0.6, 0.99, 0.99]),
    ]).check,
    "around",
  );
});
test("uncalibrated tracks never invent meter readings", () => {
  const { tracker } = ready();
  const [item] = tracker.update([make()], 1000, camera);
  assert.equal(item.range, null);
});
test("a measured reference follows inverse apparent size under pinhole assumptions", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  const [item] = tracker.update(
    [make("chair", [0.15, 0.2625, 0.65, 0.6375])],
    1000,
    camera,
  );
  assert.ok(Math.abs(item.range.meters - 1.6) < 1e-8);
  assert.equal(item.range.label, "About 1.5 m");
  assert.equal(item.range.method, "calibrated-size-ratio");
});
test("a brief missing detection keeps calibration but hides meters until two returning frames", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.update([], 1000, camera);
  const [replacement] = tracker.update([make()], 1250, camera);
  assert.equal(replacement.trackId, id);
  assert.equal(replacement.range, null);
  assert.equal(tracker.reference.meters, 2);
  const [recovered] = tracker.update([make()], 1500, camera);
  assert.equal(recovered.range.meters, 2);
});
test("partial/clipped views hide meters while retaining the measured reference", () => {
  const { tracker, id } = ready("chair", [0.08, 0.3, 0.48, 0.6]);
  tracker.calibrate(id, 2, 750);
  const [item] = tracker.update(
    [make("chair", [0.01, 0.3, 0.41, 0.6])],
    1000,
    camera,
  );
  assert.equal(item.range, null);
  assert.equal(tracker.reference.meters, 2);
});
test("non-uniform width/height changes are rejected as changed view or occlusion", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  const [item] = tracker.update(
    [make("chair", [0.2, 0.26, 0.6, 0.64])],
    1000,
    camera,
  );
  assert.equal(item.range, null);
  assert.equal(tracker.reference.meters, 2);
});
test("orientation/aspect changes clear calibration and track IDs are never reused", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  const [item] = tracker.update([make()], 1000, { width: 960, height: 640 });
  assert.equal(item.range, null);
  assert.ok(item.trackId > id);
  tracker.reset();
  const [other] = tracker.update([make()], 1250, camera);
  assert.ok(other.trackId > item.trackId);
});
test("people and animals cannot be stationary calibration references", () => {
  for (const name of ["person", "cat", "dog"]) {
    const { tracker, id } = ready(name);
    assert.equal(tracker.canCalibrate(id, 750), false);
    assert.throws(() => tracker.calibrate(id, 2, 750), /stationary object/);
  }
});
test("calibration rejects invalid measured ranges and stale targets", () => {
  const { tracker, id } = ready();
  for (const value of [NaN, Infinity, -1, 0.1, 10])
    assert.throws(() => tracker.calibrate(id, value, 750));
  assert.throws(() => tracker.calibrate(id, 2, 2000), /stationary/);
});
test("small targets and insufficient stabilization cannot be calibrated", () => {
  const { tracker, id } = ready("chair", [0.2, 0.4, 0.3, 0.45]);
  assert.equal(tracker.canCalibrate(id, 750), false);
  const fresh = new RangeTracker();
  const [item] = fresh.update([make()], 0, camera);
  assert.equal(fresh.canCalibrate(item.trackId, 0), false);
});
test("overlapping similar furniture invalidates the range instead of guessing identity", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  const results = tracker.update(
    [make(), make("chair", [0.22, 0.32, 0.62, 0.62])],
    1000,
    camera,
  );
  assert.equal(tracker.reference.id, null);
  assert.equal(tracker.reference.meters, 2);
  assert.ok(results.every((item) => item.range === null));
});
test("consistent size growth is only labeled image growth, not measured speed or distance", () => {
  const tracker = new RangeTracker();
  let item;
  for (let i = 0; i < 8; i++) {
    const s = 1 + i * 0.035;
    [item] = tracker.update(
      [
        make("chair", [
          0.4 - 0.2 * s,
          0.45 - 0.15 * s,
          0.4 + 0.2 * s,
          0.45 + 0.15 * s,
        ]),
      ],
      i * 250,
      camera,
    );
  }
  assert.equal(item.trend, "growing");
  assert.equal(item.range, null);
  assert.match(getGuidance([item]).proximity, /larger in view/);
});
test("off-center furniture cannot be used as a calibrated distance reference", () => {
  const { tracker, id } = ready("chair", [0.2, 0.05, 0.6, 0.3]);
  assert.equal(tracker.canCalibrate(id, 750), false);
});
test("substantial sideways bearing changes discard meter estimates", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  const [item] = tracker.update(
    [make("chair", [0.2, 0.43, 0.6, 0.73])],
    1000,
    camera,
  );
  assert.equal(item.range, null);
  assert.equal(tracker.reference.meters, 2);
});
test("ambiguous overlapping furniture cannot be calibrated to begin with", () => {
  const tracker = new RangeTracker();
  let results;
  for (const at of [0, 250, 500, 750]) {
    results = tracker.update(
      [make(), make("chair", [0.22, 0.35, 0.62, 0.65])],
      at,
      camera,
    );
  }
  assert.ok(results.every((item) => !tracker.canCalibrate(item.trackId, 750)));
});
test("a rough calibrated distance can be spoken without excessive precision", () => {
  const cue = getGuidance([
    { ...make(), range: { meters: 1.61, label: "About 1.5 m" } },
  ]);
  assert.match(cue.speech, /about 1.5 meters/);
  assert.doesNotMatch(cue.speech, /1.61/);
});

test("leaving the frame for several seconds keeps the reference and requires same-object confirmation", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  for (const at of [1000, 1500, 2500, 5000]) tracker.update([], at, camera);
  assert.equal(tracker.reference.meters, 2);
  assert.equal(tracker.reference.id, null);
  let item;
  for (const at of [5250, 5500, 5750, 6000]) {
    [item] = tracker.update([make()], at, camera);
    assert.equal(item.range, null);
  }
  assert.notEqual(item.trackId, id);
  assert.ok(tracker.canResume(item.trackId, 6000));
  tracker.resume(item.trackId, 6000);
  assert.equal(tracker.update([make()], 6250, camera)[0].range, null);
  assert.equal(tracker.update([make()], 6500, camera)[0].range.meters, 2);
});

test("confirmed return uses the original size reference at the new distance, not the previous reading", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.update([], 2000, camera);
  const closer = make("chair", [0.15, 0.2625, 0.65, 0.6375]);
  let item;
  for (const at of [2250, 2500, 2750, 3000])
    [item] = tracker.update([closer], at, camera);
  tracker.resume(item.trackId, 3000);
  tracker.update([closer], 3250, camera);
  const [returned] = tracker.update([closer], 3500, camera);
  assert.ok(Math.abs(returned.range.meters - 1.6) < 1e-8);
  assert.equal(tracker.reference.meters, 2);
});

test("a missing track is not a visible calibration or resume candidate", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.update([], 1000, camera);
  assert.equal(tracker.canCalibrate(id, 1000), false);
  assert.equal(tracker.canResume(id, 1000), false);
});

test("pause/settings suspension retains the measured reference but requires confirmation", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.suspend();
  assert.equal(tracker.reference.meters, 2);
  assert.equal(tracker.reference.id, null);
  assert.equal(tracker.tracks.length, 0);
  assert.throws(() => tracker.resume(id, 1000), /same stationary object/);
});

test("wrong class, changed shape, and expired candidates cannot reuse the saved chair reference", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.suspend();
  let items;
  for (const at of [1000, 1250, 1500, 1750]) {
    items = tracker.update(
      [make("couch"), make("chair", [0.2, 0.25, 0.5, 0.65])],
      at,
      camera,
    );
  }
  assert.ok(items.every((item) => !tracker.canResume(item.trackId, 1750)));
  assert.equal(tracker.reference.meters, 2);
  tracker.suspend();
  for (const at of [2000, 2250, 2500, 2750])
    items = tracker.update([make()], at, camera);
  assert.ok(tracker.canResume(items[0].trackId, 2750));
  assert.equal(tracker.canResume(items[0].trackId, 4200), false);
});

test("similar objects on a short-gap return disable automatic reacquisition", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.update([], 1000, camera);
  const items = tracker.update(
    [make(), make("chair", [0.3, 0.7, 0.7, 0.95])],
    1250,
    camera,
  );
  assert.equal(tracker.reference.id, null);
  assert.ok(items.every((item) => item.range === null));
});

test("short bad-view glitches recover without erasing or re-entering the measurement", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  assert.equal(
    tracker.update([make("chair", [0.2, 0.26, 0.6, 0.64])], 1000, camera)[0]
      .range,
    null,
  );
  assert.equal(tracker.update([make()], 1250, camera)[0].range, null);
  assert.equal(tracker.update([make()], 1500, camera)[0].range.meters, 2);
});

test("ending the camera session or explicitly clearing still removes calibration", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.suspend();
  tracker.clearCalibration();
  assert.equal(tracker.reference, null);
  const fresh = ready();
  fresh.tracker.calibrate(fresh.id, 2, 750);
  fresh.tracker.reset();
  assert.equal(fresh.tracker.reference, null);
});

test("multiple distinct stable chairs are offered for explicit selection, never auto-bound", () => {
  const { tracker, id } = ready("chair", [0.2, 0.4, 0.6, 0.6]);
  tracker.calibrate(id, 2, 750);
  tracker.suspend();
  let items;
  for (const at of [1000, 1250, 1500, 1750]) {
    items = tracker.update(
      [
        make("chair", [0.2, 0.3, 0.6, 0.5]),
        make("chair", [0.2, 0.5, 0.6, 0.7]),
      ],
      at,
      camera,
    );
  }
  assert.equal(tracker.reference.id, null);
  assert.equal(
    items.filter((item) => tracker.canResume(item.trackId, 1750)).length,
    2,
  );
  tracker.resume(items[0].trackId, 1750);
  const chairs = [
    make("chair", [0.2, 0.3, 0.6, 0.5]),
    make("chair", [0.2, 0.5, 0.6, 0.7]),
  ];
  tracker.update(chairs, 2000, camera);
  const returned = tracker.update(chairs, 2250, camera);
  assert.ok(Math.abs(returned[0].range.meters - 2) < 1e-8);
  assert.equal(returned[1].range, null);
});
test("a long processing gap cannot silently reactivate the previous track", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  const [returned] = tracker.update([make()], 5000, camera);
  assert.equal(returned.range, null);
  assert.equal(tracker.reference.id, null);
  assert.equal(tracker.reference.meters, 2);
});
test("calibration remains eligible when delivery takes 650 ms on a slower device", () => {
  const tracker = new RangeTracker();
  let item;
  for (const at of [0, 700, 1400, 2100])
    [item] = tracker.update([make()], at, camera);
  assert.ok(tracker.canCalibrate(item.trackId, 2750));
  tracker.calibrate(item.trackId, 2, 2750);
  assert.equal(tracker.reference.meters, 2);
  assert.equal(tracker.canCalibrate(item.trackId, 3400), false);
});
