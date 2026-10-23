import { getPosition } from "./scene.mjs";

// Image-space prominence is NOT depth. Never infer that another side is safe.
const BACKGROUND = new Set([
  "kite",
  "bird",
  "airplane",
  "clock",
  "traffic light",
  "stop sign",
]);
export function getGuidance(detections) {
  const candidates = detections
    .filter((item) => {
      const [top, , bottom] = item.bbox;
      return (
        !BACKGROUND.has(item.class) && bottom > 0.45 && bottom - top >= 0.14
      );
    })
    .map((item) => {
      const [top, left, bottom, right] = item.bbox;
      const centralOverlap = Math.max(
        0,
        Math.min(right, 0.64) - Math.max(left, 0.36),
      );
      const ahead = centralOverlap >= Math.min(0.12, (right - left) * 0.45);
      const position = ahead ? "ahead" : getPosition(item.bbox);
      const prominent = ahead && bottom - top >= 0.55 && bottom >= 0.65;
      const area = (right - left) * (bottom - top);
      const level = prominent ? "pause" : ahead ? "ahead" : "side";
      const name = item.class[0].toUpperCase() + item.class.slice(1);
      const speech = `${name} ${position === "ahead" ? "ahead" : `on ${position}`}.${prominent ? " Pause." : ""}`;
      return {
        ...item,
        position,
        level,
        speech,
        key: `${item.class}:${position}:${level}`,
        rank: (prominent ? 4 : ahead ? 2 : 0) + area + item.score * 0.1,
      };
    })
    .sort((a, b) => b.rank - a.rank);
  const alert = candidates[0] || null;
  return {
    alert,
    title: alert
      ? alert.level === "pause"
        ? "Pause and check."
        : alert.speech
      : "No object alert.",
    detail:
      alert?.level === "pause"
        ? `${alert.class} fills the center of the view.`
        : alert
          ? "Position in the camera view. Check before moving."
          : "Unrecognized hazards may still be present.",
    speech: alert?.speech || "",
  };
}

// Stabilize changes for two frames, but never delay a prominent central warning.
export class GuidanceFilter {
  key = null;
  count = 0;
  update(guidance) {
    const key = guidance.alert?.key || null;
    this.count = key && key === this.key ? this.count + 1 : 1;
    this.key = key;
    return guidance.alert &&
      (guidance.alert.level === "pause" || this.count >= 2)
      ? guidance
      : null;
  }
  reset() {
    this.key = null;
    this.count = 0;
  }
}
