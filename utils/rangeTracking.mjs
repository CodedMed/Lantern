import { RIGID_CLASSES, filterRoomDetections } from "./obstacles.mjs";

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const shape = ([top, left, bottom, right]) => ({
  w: right - left,
  h: bottom - top,
  x: (left + right) / 2,
  y: (top + bottom) / 2,
});
const fullBox = (box) =>
  box.every(Number.isFinite) &&
  box[0] > 0.02 &&
  box[1] > 0.02 &&
  box[2] < 0.98 &&
  box[3] < 0.98;
const iou = (a, b) => {
  const intersection =
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const sa = shape(a),
    sb = shape(b);
  return intersection / (sa.w * sa.h + sb.w * sb.h - intersection || 1);
};

// A pinhole size-ratio estimator for ONE explicitly calibrated stationary object.
// It is not learned monocular depth, identity recognition, or a collision sensor.
export class RangeTracker {
  constructor() {
    this.reset();
  }
  reset() {
    this.tracks = [];
    this.nextId ||= 1;
    this.reference = null;
    this.status = "Not calibrated";
    this.aspect = null;
  }
  clearCalibration(reason = "Not calibrated") {
    this.reference = null;
    this.status = reason;
  }
  update(items, timestamp, { width, height }) {
    const aspect = width / height;
    if (this.aspect && Math.abs(aspect / this.aspect - 1) > 0.03) this.reset();
    this.aspect = aspect;
    const available = this.tracks.filter(
      (track) => timestamp - track.lastAt <= 650,
    );
    const matched = new Set();
    const next = [];
    const output = filterRoomDetections(items).map((item) => {
      const current = shape(item.bbox);
      const candidates = available
        .filter((track) => !matched.has(track.id) && track.class === item.class)
        .map((track) => ({ track, overlap: iou(item.bbox, track.bbox) }))
        .filter(({ overlap }) => overlap > 0.25)
        .sort((a, b) => b.overlap - a.overlap);
      const ambiguous =
        candidates.length > 1 &&
        candidates[0].overlap - candidates[1].overlap < 0.15;
      let track = !ambiguous && candidates[0]?.track;
      if (track) {
        const previous = shape(track.bbox);
        if (
          Math.abs(Math.log(current.w / previous.w)) > 0.35 ||
          Math.abs(Math.log(current.h / previous.h)) > 0.35
        )
          track = null;
      }
      if (!track)
        track = {
          id: this.nextId++,
          class: item.class,
          samples: [],
          firstAt: timestamp,
        };
      matched.add(track.id);
      const samples = [
        ...track.samples,
        { at: timestamp, w: current.w, h: current.h },
      ]
        .filter((sample) => timestamp - sample.at <= 1800)
        .slice(-12);
      track = {
        ...track,
        bbox: item.bbox,
        samples,
        lastAt: timestamp,
        score: item.score,
      };
      next.push(track);
      let trend = "unknown";
      if (samples.length >= 5 && timestamp - samples[0].at >= 700) {
        const first = samples.slice(0, 2),
          last = samples.slice(-2);
        const rw = median(last.map((s) => s.w)) / median(first.map((s) => s.w));
        const rh = median(last.map((s) => s.h)) / median(first.map((s) => s.h));
        if (rw > 1.13 && rh > 1.13) trend = "growing";
        else if (rw < 0.87 && rh < 0.87) trend = "shrinking";
        else trend = "steady";
      }
      return { ...item, trackId: track.id, trend, range: null };
    });
    this.tracks = next; // Missing even one frame invalidates a meter reference.
    if (this.reference && !next.some((track) => track.id === this.reference.id))
      this.clearCalibration("Tracking lost. Recalibrate.");
    if (this.reference) {
      const item = output.find(
        (candidate) => candidate.trackId === this.reference.id,
      );
      if (
        output.some(
          (candidate) =>
            candidate.trackId !== item.trackId &&
            candidate.class === item.class &&
            iou(candidate.bbox, item.bbox) > 0.05,
        )
      ) {
        this.clearCalibration("Similar objects overlap. Recalibrate.");
        return output;
      }
      const current = shape(item.bbox),
        reference = this.reference;
      const wr = reference.w / current.w,
        hr = reference.h / current.h;
      const stableAxes = Math.abs(Math.log(wr / hr)) <= 0.16;
      const sameBearing =
        Math.abs(current.x - reference.x) < 0.12 &&
        Math.abs(current.y - reference.y) < 0.12;
      const inRange = Math.sqrt(wr * hr) >= 0.6 && Math.sqrt(wr * hr) <= 1.6;
      if (
        !fullBox(item.bbox) ||
        !stableAxes ||
        !sameBearing ||
        !inRange ||
        item.score < 0.6
      )
        this.clearCalibration("View changed. Recalibrate.");
      else {
        const meters = reference.meters * Math.sqrt(wr * hr);
        reference.estimates = [...reference.estimates, meters].slice(-3);
        const smoothed = median(reference.estimates);
        item.range = {
          meters: smoothed,
          label: `About ${Math.max(0.5, Math.round(smoothed * 2) / 2).toFixed(1)} m`,
          method: "calibrated-size-ratio",
        };
        this.status = "Rough estimate for the calibrated object only";
      }
    }
    return output;
  }
  canCalibrate(id, now) {
    const track = this.tracks.find((item) => item.id === id);
    if (
      !track ||
      !RIGID_CLASSES.has(track.class) ||
      track.score < 0.6 ||
      !fullBox(track.bbox) ||
      now - track.lastAt > 450 ||
      track.samples.length < 4 ||
      now - track.firstAt < 600
    )
      return false;
    const recent = track.samples.slice(-4);
    const currentShape = shape(track.bbox);
    if (
      currentShape.w < 0.08 ||
      currentShape.h < 0.12 ||
      currentShape.x < 0.33 ||
      currentShape.x > 0.67 ||
      this.tracks.some(
        (other) =>
          other.id !== id &&
          other.class === track.class &&
          iou(other.bbox, track.bbox) > 0.05,
      )
    )
      return false;
    const widths = recent.map((s) => s.w),
      heights = recent.map((s) => s.h);
    return (
      Math.max(...widths) / Math.min(...widths) < 1.12 &&
      Math.max(...heights) / Math.min(...heights) < 1.12
    );
  }
  calibrate(id, meters, now) {
    if (!Number.isFinite(meters) || meters < 0.5 || meters > 8)
      throw new Error("Enter a measured distance between 0.5 and 8 meters.");
    if (!this.canCalibrate(id, now))
      throw new Error(
        "Hold the whole stationary object in view until tracking is stable.",
      );
    const track = this.tracks.find((item) => item.id === id);
    const recent = track.samples.slice(-4);
    this.reference = {
      id,
      meters,
      w: median(recent.map((s) => s.w)),
      h: median(recent.map((s) => s.h)),
      x: shape(track.bbox).x,
      y: shape(track.bbox).y,
      estimates: [],
    };
    this.status = "Calibrated. Keep the same object and angle in view.";
  }
}
