// Deliberately narrow room-level awareness, not all 80 COCO categories.
export const ROOM_CLASSES = new Set([
  "person",
  "chair",
  "couch",
  "bed",
  "dining table",
  "bench",
  "potted plant",
  "toilet",
  "refrigerator",
  "oven",
  "suitcase",
  "backpack",
  "dog",
  "cat",
]);
export const RIGID_CLASSES = new Set([
  "chair",
  "couch",
  "bed",
  "dining table",
  "bench",
  "potted plant",
  "toilet",
  "refrigerator",
  "oven",
]);
export const roomLabel = (name) =>
  ({ "dining table": "table", "potted plant": "plant", couch: "sofa" })[name] ||
  name;
export const filterRoomDetections = (items) =>
  items.filter((item) => ROOM_CLASSES.has(item.class));

function unionArea(rectangles) {
  const edges = [...new Set(rectangles.flatMap((r) => [r[0], r[2]]))].sort(
    (a, b) => a - b,
  );
  let area = 0;
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1],
      right = edges[i];
    const spans = rectangles
      .filter((r) => r[0] < right && r[2] > left)
      .map((r) => [r[1], r[3]])
      .sort((a, b) => a[0] - b[0]);
    let bottom = -Infinity,
      coverage = 0;
    for (const [start, end] of spans) {
      coverage += Math.max(0, end - Math.max(start, bottom));
      bottom = Math.max(bottom, end);
    }
    area += coverage * (right - left);
  }
  return area;
}

export function inspectionAdvice(detections) {
  const zones = {
    left: [0.05, 0.34],
    ahead: [0.36, 0.64],
    right: [0.66, 0.95],
  };
  const coverage = Object.fromEntries(
    Object.entries(zones).map(([name, [left, right]]) => {
      const boxes = filterRoomDetections(detections).flatMap(
        ({ bbox: [top, x1, bottom, x2] }) => {
          const rectangle = [
            Math.max(left, x1),
            Math.max(0.42, top),
            Math.min(right, x2),
            Math.min(0.98, bottom),
          ];
          return rectangle[2] > rectangle[0] && rectangle[3] > rectangle[1]
            ? [rectangle]
            : [];
        },
      );
      return [name, unionArea(boxes) / ((right - left) * 0.56)];
    }),
  );
  // This selects where to LOOK/CHECK, not where it is safe to step.
  let check = "both";
  if (coverage.left > 0.22 && coverage.left - coverage.right > 0.14)
    check = "right";
  else if (coverage.right > 0.22 && coverage.right - coverage.left > 0.14)
    check = "left";
  const blocked = coverage.left > 0.55 && coverage.right > 0.55;
  return {
    coverage,
    check: blocked ? "around" : check,
    message: blocked
      ? "Pause. Check around you."
      : `Pause. Check ${check === "both" ? "both sides" : check}.`,
    detail: blocked
      ? "Objects occupy both sides of this view."
      : check === "both"
        ? "Neither side has been verified clear."
        : `Less detected object coverage on the ${check}; not a verified clear path.`,
  };
}
