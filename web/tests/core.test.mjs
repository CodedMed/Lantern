import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDetections,
  getPosition,
  describeScene,
} from "../../utils/scene.mjs";
import {
  readSettings,
  sanitizeSettings,
  DEFAULT_SETTINGS,
} from "../../utils/preferences.mjs";
import { Detector } from "../src/detector.mjs";
import { requestCamera, stopStream } from "../src/camera.mjs";

test("camera asks for video only and propagates denied permissions", async () => {
  const stream = { getTracks: () => [] };
  let requested;
  assert.equal(
    await requestCamera({
      getUserMedia: async (options) => {
        requested = options;
        return stream;
      },
    }),
    stream,
  );
  assert.equal(requested.audio, false);
  assert.equal(requested.video.facingMode.ideal, "environment");
  await assert.rejects(
    requestCamera({
      getUserMedia: async () => {
        throw new Error("permission denied");
      },
    }),
    /denied/,
  );
});
test("a late camera permission result releases every track rather than opening a stale preview", async () => {
  let stops = 0;
  const stream = {
    getTracks: () => [{ stop: () => stops++ }, { stop: () => stops++ }],
  };
  assert.equal(
    await requestCamera({ getUserMedia: async () => stream }, () => false),
    null,
  );
  assert.equal(stops, 2);
  stopStream(null);
});
test("missing camera APIs fail clearly without preventing photo mode", async () => {
  await assert.rejects(requestCamera(undefined), /HTTPS/);
});

test("COCO pixel boxes map to canonical coordinates, clipped to the frame", () => {
  const [object] = normalizeDetections(
    [{ class: "person", score: 0.9, bbox: [-10, 20, 40, 200] }],
    100,
    100,
  );
  assert.deepEqual(object.bbox, [0.2, 0, 1, 0.3]);
  assert.equal(getPosition(object.bbox), "left");
});
test("invalid boxes, NaN, offscreen boxes and low-confidence detections are discarded", () => {
  const predictions = [null, [NaN, 0, 5, 5], [0, 0, -2, 5], [120, 0, 2, 2]].map(
    (bbox) => ({ bbox, score: 0.9, class: "car" }),
  );
  predictions.push({ bbox: [0, 0, 20, 20], score: 0.2, class: "car" });
  assert.deepEqual(normalizeDetections(predictions, 100, 100), []);
  assert.throws(() => normalizeDetections([], 0, 100));
});
test("positions use consistent left, center and right zones", () => {
  assert.equal(getPosition([0, 0.02, 1, 0.25]), "left");
  assert.equal(getPosition([0, 0.35, 1, 0.65]), "center");
  assert.equal(getPosition([0, 0.75, 1, 1]), "right");
});
test("empty detection never implies a safe path", () => {
  const scene = describeScene([]);
  assert.match(scene.message, /does not mean the area is clear/);
  assert.match(scene.speech, /safety are unknown/);
});
test("objects are grouped without inventing distances or directions to walk", () => {
  const detections = Array.from({ length: 2 }, () => ({
    class: "person",
    score: 0.9,
    bbox: [0, 0.1, 0.8, 0.25],
  }));
  const scene = describeScene(detections);
  assert.match(scene.message, /2 instances of person on the left/);
  assert.doesNotMatch(scene.message, /turn|meters|metres|proceed|path clear/i);
});
test("corrupted, blocked and malicious settings recover safely", () => {
  assert.deepEqual(
    readSettings({ getItem: () => "{broken" }),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    readSettings({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  const settings = sanitizeSettings({
    speech: "false",
    rate: 100,
    threshold: -1,
    contrast: "yes",
  });
  assert.equal(settings.speech, true);
  assert.equal(settings.rate, 1.5);
  assert.equal(settings.threshold, 0.35);
  assert.equal(settings.contrast, false);
});

function fixture({
  failLoad = false,
  failDetection = false,
  webgl = true,
} = {}) {
  let loads = 0,
    inferences = 0,
    disposals = 0;
  const model = {
    detect: async () => {
      inferences++;
      if (failDetection) throw new Error("inference failed");
      return [{ class: "cat", score: 0.9, bbox: [0, 0, 50, 50] }];
    },
    dispose: () => {
      disposals++;
    },
  };
  const runtime = async () => [
    {
      setBackend: async (name) => name === "cpu" || webgl,
      ready: async () => {},
      getBackend: () => (webgl ? "webgl" : "cpu"),
    },
    {
      load: async () => {
        loads++;
        if (failLoad && loads === 1) throw new Error("network error");
        return model;
      },
    },
  ];
  return {
    service: new Detector(runtime),
    counts: () => ({ loads, inferences, disposals }),
  };
}
test("concurrent model loads share one download, and later scans reuse the model", async () => {
  const { service, counts } = fixture();
  await Promise.all([service.load(), service.load(), service.load()]);
  const result = await service.detect({ width: 100, height: 100 });
  await service.detect({ width: 100, height: 100 });
  assert.equal(counts().loads, 1);
  assert.equal(counts().inferences, 2);
  assert.deepEqual(result.detections[0].bbox, [0, 0, 0.5, 0.5]);
});
test("failed model download can be retried", async () => {
  const { service, counts } = fixture({ failLoad: true });
  await assert.rejects(service.load(), /network/);
  await service.load();
  assert.equal(counts().loads, 2);
});
test("failed inference releases the scan lock", async () => {
  const { service } = fixture({ failDetection: true });
  await assert.rejects(
    service.detect({ width: 100, height: 100 }),
    /inference/,
  );
  assert.equal(service.busy, false);
});
test("overlapping scans are rejected rather than queued indefinitely", async () => {
  const { service } = fixture();
  const first = service.detect({ width: 100, height: 100 });
  await assert.rejects(
    service.detect({ width: 100, height: 100 }),
    /already running/,
  );
  await first;
});
test("CPU fallback works and empty inputs fail without leaving a lock", async () => {
  const { service } = fixture({ webgl: false });
  const result = await service.detect({ width: 100, height: 100 });
  assert.equal(result.backend, "cpu");
  await assert.rejects(service.detect({ width: 0, height: 0 }), /not ready/);
  assert.equal(service.busy, false);
});
