import { normalizeDetections } from "../../utils/scene.mjs";
import { filterRoomDetections } from "../../utils/obstacles.mjs";

// One model, one load promise, one inference at a time. No API key or image uploads.
export class Detector {
  constructor(
    loadRuntime = () =>
      Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/coco-ssd"),
      ]),
  ) {
    this.loadRuntime = loadRuntime;
    this.pending = null;
    this.model = null;
    this.busy = false;
    this.backend = null;
    this.base = "mobilenet_v2";
  }
  async load(onStatus = () => {}) {
    if (this.model) return this.model;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      onStatus("Preparing on-device AI…");
      const [tf, coco] = await this.loadRuntime();
      let accelerated = false;
      try {
        accelerated = await tf.setBackend("webgl");
      } catch {
        /* CPU fallback below */
      }
      if (!accelerated) await tf.setBackend("cpu");
      await tf.ready();
      this.backend = tf.getBackend();
      onStatus("Downloading the recognition model. First use takes longer…");
      this.model = await coco.load({ base: this.base });
      return this.model;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async detect(source, threshold = 0.5, onStatus) {
    if (this.busy) throw new Error("A scan is already running.");
    this.busy = true;
    try {
      const model = await this.load(onStatus);
      const width = source.videoWidth || source.naturalWidth || source.width;
      const height =
        source.videoHeight || source.naturalHeight || source.height;
      if (!(width > 0 && height > 0))
        throw new Error("The image or camera is not ready yet.");
      const start = performance.now();
      const predictions = await model.detect(source, 40, threshold);
      return {
        detections: filterRoomDetections(
          normalizeDetections(predictions, width, height, threshold),
        ),
        elapsed: Math.round(performance.now() - start),
        width,
        height,
        backend: this.backend,
        model: this.base,
      };
    } finally {
      this.busy = false;
    }
  }
}
export const detector = new Detector();
