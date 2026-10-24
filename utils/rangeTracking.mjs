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
const TRACK_GRACE_MS = 800;
// Keep eligibility within the UI's 1.4 s frame expiry, but don't make a 500–700
// ms inference ineligible immediately on delivery. Calibration requires stillness.
const REFERENCE_FRAME_AGE_MS = 1200;

function compatibleView(box, reference) {
  const current = shape(box);
  const wr = reference.w / current.w,
    hr = reference.h / current.h;
  return (
    fullBox(box) &&
    Math.abs(Math.log(wr / hr)) <= 0.16 &&
    Math.abs(current.x - reference.x) < 0.12 &&
    Math.abs(current.y - reference.y) < 0.12 &&
    Math.sqrt(wr * hr) >= 0.6 &&
    Math.sqrt(wr * hr) <= 1.6
  );
}

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
  // Keep the measured reference, but never retain a stale live meter reading.
  park(reason = "Calibration saved. Confirm the same object to resume.") {
    if (!this.reference) return;
    this.reference.id = null;
    this.reference.verifiedFrames = 0;
    this.reference.recoveryConfirmed = false;
    this.reference.estimates = [];
    this.status = reason;
  }
  suspend(reason) {
    this.tracks = [];
    this.park(reason);
  }
  update(items, timestamp, { width, height }) {
    const aspect = width / height;
    if (this.aspect && Math.abs(aspect / this.aspect - 1) > 0.03) this.reset();
    this.aspect = aspect;
    const available = this.tracks.filter(
      (track) => timestamp - track.lastAt <= TRACK_GRACE_MS,
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
        .filter((sample) => timestamp - sample.at <= 3000)
        .slice(-12);
      track = {
        ...track,
        bbox: item.bbox,
        samples,
        lastAt: timestamp,
        score: item.score,
        visible: true,
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
    // Brief detector flicker should not churn IDs. Missing tracks aren't rendered
    // and cannot be calibrated; they only remain association candidates briefly.
    this.tracks = [
      ...next,
      ...available
        .filter((track) => !matched.has(track.id))
        .map((track) => ({ ...track, visible: false })),
    ];
    if (this.reference) {
      if (this.reference.id === null) return output;
      const item = output.find(
        (candidate) => candidate.trackId === this.reference.id,
      );
      if (!item) {
        this.reference.verifiedFrames = 0;
        this.reference.recoveryConfirmed = false;
        this.reference.estimates = [];
        if (timestamp - this.reference.lastVisibleAt > TRACK_GRACE_MS)
          this.park(
            "Calibration saved. Find the same object and confirm to resume.",
          );
        else this.status = "Calibration saved. Looking for the object…";
        return output;
      }
      // A long gap also requires confirmation if the next processed frame is
      // the returning object (there may have been no intervening empty frame).
      if (timestamp - this.reference.lastVisibleAt > TRACK_GRACE_MS) {
        this.park("Calibration saved. Confirm the same object to resume.");
        return output;
      }
      this.reference.lastVisibleAt = timestamp;
      if (
        this.reference.verifiedFrames === 0 &&
        !this.reference.recoveryConfirmed &&
        output.some(
          (candidate) =>
            candidate.trackId !== item.trackId &&
            candidate.class === item.class,
        )
      ) {
        this.park(
          "Calibration saved. Multiple similar objects; confirm the same one to resume.",
        );
        return output;
      }
      if (
        output.some(
          (candidate) =>
            candidate.trackId !== item.trackId &&
            candidate.class === item.class &&
            iou(candidate.bbox, item.bbox) > 0.05,
        )
      ) {
        this.park(
          "Calibration saved. Similar objects overlap; confirm the same object when separated.",
        );
        return output;
      }
      const current = shape(item.bbox),
        reference = this.reference;
      const wr = reference.w / current.w,
        hr = reference.h / current.h;
      if (!compatibleView(item.bbox, reference) || item.score < 0.6) {
        reference.verifiedFrames = 0;
        reference.recoveryConfirmed = false;
        reference.estimates = [];
        this.status =
          "Calibration saved. Center the whole object at the original angle.";
      } else {
        reference.verifiedFrames++;
        if (reference.verifiedFrames < 2) {
          this.status = "Calibration saved. Checking the returning object…";
          return output;
        }
        const meters = reference.meters * Math.sqrt(wr * hr);
        reference.estimates = [...reference.estimates, meters].slice(-5);
        const smoothed = median(reference.estimates);
        item.range = {
          meters: smoothed,
          label: `About ${Math.max(0.5, Math.round(smoothed * 2) / 2).toFixed(1)} m`,
          method: "calibrated-size-ratio",
        };
        reference.recoveryConfirmed = false;
        this.status = "Rough estimate for the calibrated object only";
      }
    }
    return output;
  }
  canCalibrate(id, now) {
    const track = this.tracks.find((item) => item.id === id);
    if (
      !track ||
      !track.visible ||
      !RIGID_CLASSES.has(track.class) ||
      track.score < 0.6 ||
      !fullBox(track.bbox) ||
      now - track.lastAt > REFERENCE_FRAME_AGE_MS ||
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
          other.visible &&
          other.class === track.class &&
          iou(other.bbox, track.bbox) > 0.05,
      )
    )
      return false;
    const widths = recent.map((s) => s.w),
      heights = recent.map((s) => s.h);
    return (
      Math.max(...widths) / Math.min(...widths) < 1.18 &&
      Math.max(...heights) / Math.min(...heights) < 1.18
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
      class: track.class,
      meters,
      w: median(recent.map((s) => s.w)),
      h: median(recent.map((s) => s.h)),
      x: shape(track.bbox).x,
      y: shape(track.bbox).y,
      estimates: [],
      verifiedFrames: 2,
      lastVisibleAt: now,
    };
    this.status = "Calibrated. Keep the same object and angle in view.";
  }
  canResume(id, now) {
    const track = this.tracks.find((item) => item.id === id);
    return Boolean(
      this.reference &&
      this.reference.id === null &&
      track?.class === this.reference.class &&
      this.canCalibrate(id, now) &&
      compatibleView(track.bbox, this.reference),
    );
  }
  // Confirmation reattaches the original size reference, NOT the old distance
  // reading at the new position. It never learns an estimated distance as truth.
  resume(id, now) {
    if (!this.canResume(id, now))
      throw new Error(
        "Center the same stationary object at the original angle and hold still.",
      );
    this.reference.id = id;
    this.reference.lastVisibleAt = now;
    this.reference.verifiedFrames = 0;
    this.reference.recoveryConfirmed = true;
    this.reference.estimates = [];
    this.status = "Checking the confirmed object…";
  }
}
