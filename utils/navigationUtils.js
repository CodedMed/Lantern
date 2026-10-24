// Compatibility API: monocular object detection cannot establish safe navigation.
import { describeScene, getPosition } from "./scene.mjs";
export function getObjectPosition(bbox) {
  return getPosition(bbox);
}
export function estimateDistance() {
  return null;
}
export function isInROI() {
  return true;
}
export function analyzeObstacles(detections, imageSize, threshold = 0.5) {
  return describeScene(
    detections.filter((item) => item.score >= threshold),
  ).objects.map((item) => ({
    ...item,
    confidence: item.score,
    distance: null,
  }));
}
export function generateNavigationCommand(objects) {
  const scene = describeScene(objects);
  return {
    command: "AWARENESS",
    direction: null,
    message: scene.message,
    speech: scene.speech,
    obstacles: scene.objects,
  };
}
export function getROIVertices({ width, height }) {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: width, y: 0 },
    bottomRight: { x: width, y: height },
    bottomLeft: { x: 0, y: height },
  };
}
