// Canonical boxes are normalized [ymin, xmin, ymax, xmax] on every platform.
export const SAFETY_NOTE =
  "Object-awareness prototype, not a navigation or safety aid. It can miss hazards and cannot measure distance or read text.";

const clamp = (value) => Math.max(0, Math.min(1, value));

export function normalizeDetections(
  predictions,
  width,
  height,
  threshold = 0.5,
) {
  if (!(width > 0 && height > 0))
    throw new Error("Image dimensions must be positive.");
  return predictions.flatMap((prediction) => {
    const { bbox, score, class: name } = prediction;
    if (
      !Array.isArray(bbox) ||
      bbox.length !== 4 ||
      !bbox.every(Number.isFinite) ||
      !Number.isFinite(score) ||
      score < threshold ||
      score > 1 ||
      !name
    )
      return [];
    const [x, y, w, h] = bbox;
    if (w <= 0 || h <= 0) return [];
    const box = [
      clamp(y / height),
      clamp(x / width),
      clamp((y + h) / height),
      clamp((x + w) / width),
    ];
    if (box[2] <= box[0] || box[3] <= box[1]) return [];
    return [{ class: name, score, bbox: box }];
  });
}

export function getPosition(bbox) {
  const center = (bbox[1] + bbox[3]) / 2;
  return center < 1 / 3 ? "left" : center > 2 / 3 ? "right" : "center";
}

export function describeScene(detections) {
  const objects = detections.map((item) => ({
    ...item,
    position: getPosition(item.bbox),
  }));
  const groups = new Map();
  for (const object of objects) {
    const key = `${object.class}|${object.position}`;
    const group = groups.get(key) || {
      name: object.class,
      position: object.position,
      count: 0,
      score: 0,
    };
    group.count += 1;
    group.score = Math.max(group.score, object.score);
    groups.set(key, group);
  }
  const descriptions = [...groups.values()].sort((a, b) => b.score - a.score);
  const parts = descriptions
    .slice(0, 5)
    .map(
      ({ name, position, count }) =>
        `${count > 1 ? `${count} instances of ${name}` : name} ${position === "center" ? "in the center" : `on the ${position}`}`,
    );
  const message = parts.length
    ? `Detected: ${parts.join("; ")}.${descriptions.length > 5 ? " More objects are listed on screen." : ""}`
    : "No recognized objects in this frame. This does not mean the area is clear.";
  return {
    objects,
    message,
    speech: `${message} Distance and path safety are unknown.`,
  };
}
