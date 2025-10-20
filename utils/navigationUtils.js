/**
 * Navigation Utilities for Object Detection-based Navigation
 * 
 * Provides:
 * - Distance estimation from bounding boxes
 * - Obstacle spatial analysis (left/center/right positioning)
 * - Navigation command generation (turn left/right, stop, proceed)
 * - Region of Interest filtering
 */

// Known real-world heights of common objects (in meters)
const KNOWN_OBJECT_HEIGHTS = {
  person: 1.7,
  car: 1.5,
  truck: 2.5,
  bus: 3.0,
  bicycle: 1.2,
  motorcycle: 1.3,
  chair: 0.9,
  couch: 0.85,
  bench: 0.8,
  door: 2.0,
  'traffic light': 3.5,
  'stop sign': 2.0,
  'fire hydrant': 0.75,
  dog: 0.6,
  cat: 0.3,
  'potted plant': 0.5,
  'dining table': 0.75,
  bottle: 0.25,
  cup: 0.15,
};

// Approximate focal length for typical smartphone camera (pixels)
// This should be calibrated per device for accuracy
const DEFAULT_FOCAL_LENGTH = 700;

/**
 * Estimate distance to an object using monocular depth estimation
 * Based on pinhole camera model: distance = (realHeight * focalLength) / pixelHeight
 * 
 * @param {Array} bbox - Normalized bounding box [ymin, xmin, ymax, xmax] (0-1)
 * @param {string} className - Detected object class name
 * @param {number} imageHeight - Image height in pixels
 * @param {number} focalLength - Camera focal length in pixels (optional)
 * @returns {number} Estimated distance in meters
 */
export function estimateDistance(bbox, className, imageHeight, focalLength = DEFAULT_FOCAL_LENGTH) {
  const knownHeight = KNOWN_OBJECT_HEIGHTS[className] || 1.5; // default 1.5m
  
  const [ymin, , ymax] = bbox;
  const bboxHeightNormalized = ymax - ymin;
  const bboxHeightPixels = bboxHeightNormalized * imageHeight;
  
  if (bboxHeightPixels < 10) {
    // Object too small/far - return large distance
    return 10.0;
  }
  
  const distance = (knownHeight * focalLength) / bboxHeightPixels;
  
  // Clamp to reasonable range (0.3m - 20m)
  return Math.max(0.3, Math.min(20.0, distance));
}

/**
 * Determine spatial position of object relative to camera center
 * 
 * @param {Array} bbox - Normalized bounding box [ymin, xmin, ymax, xmax]
 * @param {number} imageWidth - Image width in pixels
 * @returns {string} Position: 'left', 'center', or 'right'
 */
export function getObjectPosition(bbox, imageWidth) {
  const [, xmin, , xmax] = bbox;
  const centerX = ((xmin + xmax) / 2) * imageWidth;
  
  const leftBoundary = imageWidth * 0.4;
  const rightBoundary = imageWidth * 0.6;
  
  if (centerX < leftBoundary) return 'left';
  if (centerX > rightBoundary) return 'right';
  return 'center';
}

/**
 * Check if an object is within the region of interest (ground-level path)
 * ROI is a trapezoid focusing on the walkable area
 * 
 * @param {Array} bbox - Normalized bounding box [ymin, xmin, ymax, xmax]
 * @param {Object} imageSize - { width, height } in pixels
 * @returns {boolean} True if object is in ROI
 */
export function isInROI(bbox, imageSize) {
  const { width, height } = imageSize;
  const [ymin, xmin, ymax, xmax] = bbox;
  
  // Object center point
  const centerX = ((xmin + xmax) / 2) * width;
  const centerY = ((ymin + ymax) / 2) * height;
  
  // Define ROI trapezoid (focusing on ground level, center path)
  const roiTop = height * 0.2;
  const roiBottom = height * 0.95;
  const roiLeftTop = width * 0.4;
  const roiRightTop = width * 0.6;
  const roiLeftBottom = width * 0.2;
  const roiRightBottom = width * 0.8;
  
  // Check if point is within vertical bounds
  if (centerY < roiTop || centerY > roiBottom) return false;
  
  // Calculate horizontal bounds at this Y position (linear interpolation)
  const verticalRatio = (centerY - roiTop) / (roiBottom - roiTop);
  const leftBound = roiLeftTop + (roiLeftBottom - roiLeftTop) * verticalRatio;
  const rightBound = roiRightTop + (roiRightBottom - roiRightTop) * verticalRatio;
  
  return centerX >= leftBound && centerX <= rightBound;
}

/**
 * Analyze detected objects and generate obstacle information
 * 
 * @param {Array} detections - Array of { class, score, bbox } from model
 * @param {Object} imageSize - { width, height } in pixels
 * @param {number} confidenceThreshold - Minimum confidence (default 0.5)
 * @returns {Array} Array of obstacle objects with position, distance, etc.
 */
export function analyzeObstacles(detections, imageSize, confidenceThreshold = 0.5) {
  return detections
    .filter(d => d.score >= confidenceThreshold)
    .filter(d => isInROI(d.bbox, imageSize)) // Only consider objects in walkable path
    .map(d => {
      const position = getObjectPosition(d.bbox, imageSize.width);
      const distance = estimateDistance(d.bbox, d.class, imageSize.height);
      
      const [ymin, xmin, ymax, xmax] = d.bbox;
      const centerX = ((xmin + xmax) / 2) * imageSize.width;
      const centerY = ((ymin + ymax) / 2) * imageSize.height;
      
      return {
        class: d.class,
        confidence: d.score,
        position,
        distance,
        centerX,
        centerY,
        bbox: d.bbox,
        // Calculate object width for additional context
        width: (xmax - xmin) * imageSize.width,
        height: (ymax - ymin) * imageSize.height,
      };
    })
    .sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)
}

/**
 * Generate navigation command based on obstacle analysis
 * 
 * @param {Array} obstacles - Analyzed obstacles from analyzeObstacles()
 * @returns {Object} Navigation command with direction, message, and details
 */
export function generateNavigationCommand(obstacles) {
  if (!obstacles || obstacles.length === 0) {
    return {
      command: 'CLEAR',
      direction: 'forward',
      message: 'Path clear ahead',
      speech: 'Path clear, keep moving',
      obstacles: [],
    };
  }
  
  // Filter obstacles by danger zone (within 2 meters)
  const closeObstacles = obstacles.filter(o => o.distance < 2.0);
  const veryCloseObstacles = obstacles.filter(o => o.distance < 1.0);
  
  if (veryCloseObstacles.length > 0) {
    const closest = veryCloseObstacles[0];
    return {
      command: 'STOP',
      direction: 'stop',
      message: `STOP! ${closest.class} at ${closest.distance.toFixed(1)}m`,
      speech: `Stop! ${closest.class} directly ahead at ${closest.distance.toFixed(1)} meters`,
      obstacles: veryCloseObstacles,
      closestObstacle: closest,
    };
  }
  
  if (closeObstacles.length === 0) {
    // Some objects detected but far away
    const nearest = obstacles[0];
    return {
      command: 'PROCEED',
      direction: 'forward',
      message: `Nearest: ${nearest.class} at ${nearest.distance.toFixed(1)}m`,
      speech: 'Path mostly clear, proceed forward',
      obstacles: obstacles.slice(0, 3),
      closestObstacle: nearest,
    };
  }
  
  // Analyze close obstacles by position
  const centerObstacles = closeObstacles.filter(o => o.position === 'center');
  const leftObstacles = closeObstacles.filter(o => o.position === 'left');
  const rightObstacles = closeObstacles.filter(o => o.position === 'right');
  
  // Center path blocked
  if (centerObstacles.length > 0) {
    const centerObstacle = centerObstacles[0];
    
    // Determine clearer side
    const leftScore = leftObstacles.length + (leftObstacles[0]?.distance < 1.5 ? 2 : 0);
    const rightScore = rightObstacles.length + (rightObstacles[0]?.distance < 1.5 ? 2 : 0);
    
    if (leftScore < rightScore) {
      return {
        command: 'TURN_LEFT',
        direction: 'left',
        message: `${centerObstacle.class} ahead - Move left`,
        speech: `${centerObstacle.class} at ${centerObstacle.distance.toFixed(1)} meters ahead. Move left`,
        obstacles: closeObstacles,
        closestObstacle: centerObstacle,
      };
    } else if (rightScore < leftScore) {
      return {
        command: 'TURN_RIGHT',
        direction: 'right',
        message: `${centerObstacle.class} ahead - Move right`,
        speech: `${centerObstacle.class} at ${centerObstacle.distance.toFixed(1)} meters ahead. Move right`,
        obstacles: closeObstacles,
        closestObstacle: centerObstacle,
      };
    } else {
      // Both sides equally blocked
      return {
        command: 'STOP',
        direction: 'stop',
        message: 'Path blocked - proceed carefully',
        speech: `${centerObstacle.class} ahead. Path is narrow, proceed with caution`,
        obstacles: closeObstacles,
        closestObstacle: centerObstacle,
      };
    }
  }
  
  // Side obstacles only
  if (leftObstacles.length > 0 && rightObstacles.length > 0) {
    return {
      command: 'NARROW',
      direction: 'forward',
      message: 'Narrow passage - center path',
      speech: 'Obstacles on both sides. Stay centered',
      obstacles: closeObstacles,
    };
  }
  
  if (leftObstacles.length > 0) {
    const leftObstacle = leftObstacles[0];
    return {
      command: 'KEEP_RIGHT',
      direction: 'slight_right',
      message: `${leftObstacle.class} on left - keep right`,
      speech: `${leftObstacle.class} on your left at ${leftObstacle.distance.toFixed(1)} meters. Keep right`,
      obstacles: closeObstacles,
      closestObstacle: leftObstacle,
    };
  }
  
  if (rightObstacles.length > 0) {
    const rightObstacle = rightObstacles[0];
    return {
      command: 'KEEP_LEFT',
      direction: 'slight_left',
      message: `${rightObstacle.class} on right - keep left`,
      speech: `${rightObstacle.class} on your right at ${rightObstacle.distance.toFixed(1)} meters. Keep left`,
      obstacles: closeObstacles,
      closestObstacle: rightObstacle,
    };
  }
  
  // Default: proceed
  return {
    command: 'PROCEED',
    direction: 'forward',
    message: 'Path clear',
    speech: 'Path clear ahead',
    obstacles: closeObstacles,
  };
}

/**
 * Get visual ROI overlay coordinates for debugging/visualization
 * 
 * @param {Object} imageSize - { width, height }
 * @returns {Object} Trapezoid vertices
 */
export function getROIVertices(imageSize) {
  const { width, height } = imageSize;
  
  return {
    topLeft: { x: width * 0.4, y: height * 0.2 },
    topRight: { x: width * 0.6, y: height * 0.2 },
    bottomRight: { x: width * 0.8, y: height * 0.95 },
    bottomLeft: { x: width * 0.2, y: height * 0.95 },
  };
}
