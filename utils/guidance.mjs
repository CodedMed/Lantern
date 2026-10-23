import { getPosition } from "./scene.mjs";
import {
  filterRoomDetections,
  roomLabel,
  inspectionAdvice,
} from "./obstacles.mjs";

// Image-space prominence is NOT depth. Never infer that another side is safe.
export function getGuidance(detections) {
  const candidates = filterRoomDetections(detections)
    .filter((item) => {
      const [top, , bottom] = item.bbox;
      return bottom > 0.45 && bottom - top >= 0.14;
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
      const label = roomLabel(item.class);
      const name = label[0].toUpperCase() + label.slice(1);
      const advice = ahead ? inspectionAdvice(detections) : null;
      const roundedRange = item.range
        ? Math.max(0.5, Math.round(item.range.meters * 2) / 2)
        : null;
      const pauseCue = prominent
        ? advice.check === "around" || advice.check === "both"
          ? " Pause."
          : ` Pause; check ${advice.check}.`
        : "";
      const speech = roundedRange
        ? `${name}, about ${roundedRange} meters.${pauseCue}`
        : `${name} ${position === "ahead" ? "ahead" : `on ${position}`}.${pauseCue}`;
      return {
        ...item,
        position,
        level,
        speech,
        advice,
        key: `${item.class}:${position}:${level}:${advice?.check || "none"}:${roundedRange || "unknown"}`,
        rank:
          (prominent ? 4 : ahead ? 2 : 0) +
          (item.trend === "growing" ? 0.5 : 0) +
          area +
          item.score * 0.1,
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
    advice: alert?.advice || null,
    proximity:
      alert?.range?.label ||
      (alert?.trend === "growing"
        ? "Getting larger in view"
        : alert?.trend === "shrinking"
          ? "Getting smaller in view"
          : "Distance unknown"),
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
