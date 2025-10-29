/**
 * Navigation Utilities for Object Detection-based Navigation
 * 
 * FIXES APPLIED:
 * 1. Significantly expanded ROI to catch more obstacles
 * 2. Made ROI less restrictive - now covers almost full frame
 * 3. Lowered confidence threshold recommendation to 0.4
 * 4. Added better logging for debugging
 * 5. Improved distance danger zones
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
  backpack: 0.5,
  handbag: 0.4,
  suitcase: 0.6,
  umbrella: 0.8,
  laptop: 0.35,
  keyboard: 0.03,
  'cell phone': 0.15,
  book: 0.25,
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
  
  // Widened center zone for better navigation
  const leftBoundary = imageWidth * 0.33;  // Was 0.35
  const rightBoundary = imageWidth * 0.67; // Was 0.65
  
  if (centerX < leftBoundary) return 'left';
  if (centerX > rightBoundary) return 'right';
  return 'center';
}

/**
 * Check if an object is within the region of interest (ground-level path)
 * ROI is a trapezoid focusing on the walkable area
 * 
 * CRITICAL FIX: Made ROI MUCH LESS RESTRICTIVE to catch more obstacles
 * Previous issues:
 * - ROI was too narrow, filtering out valid obstacles
 * - Only focused on distant ground area
 * 
 * New approach:
 * - Cover almost entire frame (5-95% vertical, 5-95% horizontal)
 * - Only filter out extreme edges and top sky
 * - Trapezoid shape still helps prioritize ground-level obstacles
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
  
  // MUCH MORE PERMISSIVE ROI - catch almost everything except extreme edges
  // Start from top 5% to bottom 95% (covers 90% of frame vertically)
  const roiTop = height * 0.05;     // Was 0.1 - now starts at 5%
  const roiBottom = height * 0.95;  // Same
  
  // Wide horizontal coverage - only exclude extreme edges
  // Top: 5-95% (90% width) - was 30-70% (40% width)
  const roiLeftTop = width * 0.05;    // Was 0.3 - MUCH wider now
  const roiRightTop = width * 0.95;   // Was 0.7 - MUCH wider now
  // Bottom: 5-95% (90% width) - was 10-90% (80% width)  
  const roiLeftBottom = width * 0.05; // Was 0.1 - slightly narrower at bottom
  const roiRightBottom = width * 0.95; // Was 0.9 - slightly narrower at bottom
  
  // Check if point is within vertical bounds
  if (centerY < roiTop || centerY > roiBottom) {
    console.log(`  ❌ Object outside vertical ROI (Y: ${centerY.toFixed(0)} not in ${roiTop.toFixed(0)}-${roiBottom.toFixed(0)})`);
    return false;
  }
  
  // Calculate horizontal bounds at this Y position (linear interpolation)
  const verticalRatio = (centerY - roiTop) / (roiBottom - roiTop);
  const leftBound = roiLeftTop + (roiLeftBottom - roiLeftTop) * verticalRatio;
  const rightBound = roiRightTop + (roiRightBottom - roiRightTop) * verticalRatio;
  
  const inBounds = centerX >= leftBound && centerX <= rightBound;
  
  if (!inBounds) {
    console.log(`  ❌ Object outside horizontal ROI (X: ${centerX.toFixed(0)} not in ${leftBound.toFixed(0)}-${rightBound.toFixed(0)})`);
  }
  
  return inBounds;
}

/**
 * Analyze detected objects and generate obstacle information
 * 
 * @param {Array} detections - Array of { class, score, bbox } from model
 * @param {Object} imageSize - { width, height } in pixels
 * @param {number} confidenceThreshold - Minimum confidence (default 0.4, lowered from 0.5)
 * @returns {Array} Array of obstacle objects with position, distance, etc.
 */
export function analyzeObstacles(detections, imageSize, confidenceThreshold = 0.4) {
  console.log(`\nAnalyzing ${detections.length} detections with confidence >= ${confidenceThreshold}`);
  
  const highConfidence = detections.filter(d => d.score >= confidenceThreshold);
  console.log(`After confidence filter: ${highConfidence.length} objects`);
  
  const inROI = highConfidence.filter(d => {
    const inRoi = isInROI(d.bbox, imageSize);
    if (!inRoi) {
      console.log(`  Filtered out: ${d.class} (${(d.score * 100).toFixed(1)}%)`);
    }
    return inRoi;
  });
  
  console.log(`After ROI filter: ${inROI.length} objects in walking path`);
  
  const obstacles = inROI.map(d => {
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
  });
  
  // Sort by distance (closest first)
  return obstacles.sort((a, b) => a.distance - b.distance);
}

/**
 * Generate navigation command based on obstacle analysis
 * 
 * SIMPLIFIED: Generic "obstacle found" messaging instead of specific object identification
 * 
 * @param {Array} obstacles - Analyzed obstacles from analyzeObstacles()
 * @returns {Object} Navigation command with direction, message, and details
 */
export function generateNavigationCommand(obstacles) {
  if (!obstacles || obstacles.length === 0) {
    return {
      command: 'CLEAR',
      direction: 'forward',
      message: 'Path clear',
      speech: 'Path clear.',
      obstacles: [],
    };
  }
  
  // Filter obstacles by danger zones
  const veryCloseObstacles = obstacles.filter(o => o.distance < 1.5);  // Immediate danger
  const closeObstacles = obstacles.filter(o => o.distance < 3.0);     // Warning zone
  
  console.log(`\nDanger zones: ${veryCloseObstacles.length} very close (<1.5m), ${closeObstacles.length} close (<3m)`);
  
  // VERY CLOSE - immediate stop required
  if (veryCloseObstacles.length > 0) {
    const closest = veryCloseObstacles[0];
    console.log(`⚠️ VERY CLOSE: obstacle at ${closest.distance.toFixed(1)}m - ${closest.position}`);
    
    return {
      command: 'STOP',
      direction: 'stop',
      message: 'Obstacle found - Stop!',
      speech: 'Obstacle found. Stop immediately.',
      obstacles: veryCloseObstacles,
      closestObstacle: closest,
    };
  }
  
  // No close obstacles - path clear
  if (closeObstacles.length === 0) {
    console.log('✓ Path clear');
    return {
      command: 'CLEAR',
      direction: 'forward',
      message: 'Path clear',
      speech: 'Path clear.',
      obstacles: [],
    };
  }
  
  // Analyze close obstacles by position
  const centerObstacles = closeObstacles.filter(o => o.position === 'center');
  const leftObstacles = closeObstacles.filter(o => o.position === 'left');
  const rightObstacles = closeObstacles.filter(o => o.position === 'right');
  
  console.log(`Position breakdown: ${centerObstacles.length} center, ${leftObstacles.length} left, ${rightObstacles.length} right`);
  
  // CENTER PATH BLOCKED
  if (centerObstacles.length > 0) {
    const centerObstacle = centerObstacles[0];
    console.log(`⚠️ Center blocked - obstacle at ${centerObstacle.distance.toFixed(1)}m`);
    
    // Determine clearer side
    const leftScore = leftObstacles.length + (leftObstacles[0]?.distance < 2.0 ? 2 : 0);
    const rightScore = rightObstacles.length + (rightObstacles[0]?.distance < 2.0 ? 2 : 0);
    
    console.log(`  Side scores: left=${leftScore}, right=${rightScore}`);
    
    if (leftScore < rightScore) {
      return {
        command: 'TURN_LEFT',
        direction: 'left',
        message: 'Obstacle found - Turn left',
        speech: 'Obstacle found ahead. Turn left.',
        obstacles: closeObstacles,
        closestObstacle: centerObstacle,
      };
    } else if (rightScore < leftScore) {
      return {
        command: 'TURN_RIGHT',
        direction: 'right',
        message: 'Obstacle found - Turn right',
        speech: 'Obstacle found ahead. Turn right.',
        obstacles: closeObstacles,
        closestObstacle: centerObstacle,
      };
    } else {
      // Both sides equally blocked
      return {
        command: 'STOP',
        direction: 'stop',
        message: 'Obstacle found - Path blocked',
        speech: 'Obstacle found. Path blocked.',
        obstacles: closeObstacles,
        closestObstacle: centerObstacle,
      };
    }
  }
  
  // SIDE OBSTACLES ONLY (center clear)
  if (leftObstacles.length > 0 && rightObstacles.length > 0) {
    return {
      command: 'NARROW',
      direction: 'forward',
      message: 'Obstacles found - Stay centered',
      speech: 'Obstacles found on both sides. Stay centered.',
      obstacles: closeObstacles,
    };
  }
  
  if (leftObstacles.length > 0) {
    return {
      command: 'KEEP_RIGHT',
      direction: 'slight_right',
      message: 'Obstacle found on left',
      speech: 'Obstacle found on left. Keep right.',
      obstacles: closeObstacles,
      closestObstacle: leftObstacles[0],
    };
  }
  
  if (rightObstacles.length > 0) {
    return {
      command: 'KEEP_LEFT',
      direction: 'slight_left',
      message: 'Obstacle found on right',
      speech: 'Obstacle found on right. Keep left.',
      obstacles: closeObstacles,
      closestObstacle: rightObstacles[0],
    };
  }
  
  // Default fallback: proceed with caution
  return {
    command: 'PROCEED',
    direction: 'forward',
    message: 'Obstacle found',
    speech: 'Obstacle found. Proceed carefully.',
    obstacles: closeObstacles,
  };
}

/**
 * Get visual ROI overlay coordinates for debugging/visualization
 * Returns the expanded trapezoid vertices
 * 
 * @param {Object} imageSize - { width, height }
 * @returns {Object} Trapezoid vertices
 */
export function getROIVertices(imageSize) {
  const { width, height } = imageSize;
  
  return {
    topLeft: { x: width * 0.05, y: height * 0.05 },
    topRight: { x: width * 0.95, y: height * 0.05 },
    bottomRight: { x: width * 0.95, y: height * 0.95 },
    bottomLeft: { x: width * 0.05, y: height * 0.95 },
  };
}