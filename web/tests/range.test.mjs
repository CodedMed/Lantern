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
test("missing a calibrated target discards its range and does not transfer it to another chair", () => {
  const { tracker, id } = ready();
  tracker.calibrate(id, 2, 750);
  tracker.update([], 1000, camera);
  const [replacement] = tracker.update([make()], 1250, camera);
  assert.notEqual(replacement.trackId, id);
  assert.equal(replacement.range, null);
  assert.equal(tracker.reference, null);
});
test("partial/clipped views invalidate the reference instead of inflating distance", () => {
  const { tracker, id } = ready("chair", [0.08, 0.3, 0.48, 0.6]);
  tracker.calibrate(id, 2, 750);
  const [item] = tracker.update(
    [make("chair", [0.01, 0.3, 0.41, 0.6])],
    1000,
    camera,
  );
  assert.equal(item.range, null);
  assert.equal(tracker.reference, null);
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
  assert.equal(tracker.reference, null);
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
  assert.throws(() => tracker.calibrate(id, 2, 1500), /stationary/);
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
  assert.equal(tracker.reference, null);
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
  assert.equal(tracker.reference, null);
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
