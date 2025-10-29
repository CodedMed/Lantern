/*
 * Model Configuration
 * 
 * Centralized configuration for YOLO models and detection parameters
 */

export const MODEL_TYPES = {
  YOLOV5_NANO: 'YOLOV5_NANO',
  YOLOV5_SMALL: 'YOLOV5_SMALL',
  YOLOV8_NANO: 'YOLOV8_NANO',
  CUSTOM: 'CUSTOM',
};

// Pre-trained models (fallback: uses COCO-SSD since we don't have hosted YOLO URLs)
export const PRETRAINED_MODELS = {
  [MODEL_TYPES.YOLOV5_NANO]: {
    name: 'YOLOv5 Nano',
    description: 'Fastest, smallest model (6MB)',
    inputSize: 640,
    classes: 80,
    url: null, // Uses COCO-SSD fallback
    performance: {
      fps: '20-30',
      accuracy: 'Good',
      size: '6 MB',
    },
  },
  [MODEL_TYPES.YOLOV5_SMALL]: {
    name: 'YOLOv5 Small',
    description: 'Balanced speed and accuracy (22MB)',
    inputSize: 640,
    classes: 80,
    url: null, // Uses COCO-SSD fallback
    performance: {
      fps: '15-25',
      accuracy: 'Better',
      size: '22 MB',
    },
  },
  [MODEL_TYPES.YOLOV8_NANO]: {
    name: 'YOLOv8 Nano',
    description: 'Latest YOLO architecture (6MB)',
    inputSize: 640,
    classes: 80,
    url: null, // Uses COCO-SSD fallback
    performance: {
      fps: '25-35',
      accuracy: 'Excellent',
      size: '6 MB',
    },
  },
};

// Custom trained models (add your models here)
export const CUSTOM_MODELS = {
  // Example custom model configuration
  OBSTACLE_V1: {
    name: 'Lantern Obstacle Detector v1',
    description: 'Custom trained for navigation obstacles',
    url: null, // Set to your hosted model URL
    inputSize: 640,
    classes: [
      'person',
      'car',
      'bicycle',
      'motorcycle',
      'stairs',
      'door',
      'obstacle',
      'curb',
      'pole',
      'sign',
      'traffic_light',
      'wheelchair',
      'stroller',
      'pet',
      'barrier',
    ],
    version: '1.0.0',
    performance: {
      fps: '20-30',
      accuracy: 'High',
      size: '3 MB (quantized)',
    },
  },
  
  // Add more custom models here
  // INDOOR_NAV: { ... },
  // OUTDOOR_NAV: { ... },
};

// Detection parameters
export const DETECTION_CONFIG = {
  // Confidence thresholds
  confidence: {
    min: 0.1,
    max: 1.0,
    default: 0.4,
    recommended: 0.45,
  },
  
  // IoU threshold for NMS
  iou: {
    min: 0.1,
    max: 1.0,
    default: 0.45,
    recommended: 0.5,
  },
  
  // Frame processing
  frameSkip: {
    min: 0,
    max: 10,
    default: 2, // Process every 3rd frame
  },
  
  // ROI (Region of Interest) for obstacle filtering
  roi: {
    // Bottom 70% of image (where obstacles typically appear)
    topPercent: 0.3,
    bottomPercent: 1.0,
    leftPercent: 0.2,
    rightPercent: 0.8,
  },
  
  // Maximum detections per frame
  maxDetections: 100,
};

// Object categories for navigation
export const OBJECT_CATEGORIES = {
  CRITICAL: [
    'person',
    'car',
    'bicycle',
    'motorcycle',
    'bus',
    'truck',
    'traffic light',
  ],
  OBSTACLES: [
    'chair',
    'couch',
    'potted plant',
    'bench',
    'suitcase',
    'backpack',
  ],
  WARNINGS: [
    'stop sign',
    'fire hydrant',
    'parking meter',
  ],
  IGNORE: [
    'book',
    'clock',
    'vase',
    'remote',
    'cell phone',
  ],
};

// Distance estimation parameters (based on bbox size)
export const DISTANCE_CONFIG = {
  // Reference object sizes (in meters)
  referenceSize: {
    person: 1.7,      // Average person height
    car: 4.5,         // Average car length
    bicycle: 1.8,     // Average bicycle length
    chair: 0.8,       // Average chair height
  },
  
  // Camera parameters (adjust for your device)
  focalLength: 1000,  // Pixels (approximate)
  
  // Distance zones
  zones: {
    immediate: 1.0,   // < 1m - STOP
    near: 2.5,        // 1-2.5m - CAUTION
    medium: 5.0,      // 2.5-5m - AWARE
    far: 10.0,        // > 5m - CLEAR
  },
};

// Image preprocessing options
export const PREPROCESSING_CONFIG = {
  // OpenCV enhancements
  autoEnhance: false,      // Histogram equalization + brightness
  sharpen: false,          // Unsharp masking
  denoise: false,          // Gaussian blur denoising
  
  // Advanced options
  adaptiveBrightness: true,  // Adjust based on lighting conditions
  edgeEnhancement: false,    // Sobel edge detection overlay
};

// Model selection preferences
export const getRecommendedModel = (deviceCapability) => {
  // deviceCapability: 'low', 'medium', 'high'
  switch (deviceCapability) {
    case 'low':
      return MODEL_TYPES.YOLOV5_NANO;
    case 'medium':
      return MODEL_TYPES.YOLOV5_SMALL;
    case 'high':
      return MODEL_TYPES.YOLOV8_NANO;
    default:
      return MODEL_TYPES.YOLOV5_NANO;
  }
};

// Check if custom model is configured
export const hasCustomModel = (modelKey) => {
  const model = CUSTOM_MODELS[modelKey];
  return model && model.url !== null;
};

// Get all available models
export const getAvailableModels = () => {
  const models = [];
  
  // Add pre-trained models
  Object.keys(PRETRAINED_MODELS).forEach(key => {
    models.push({
      type: key,
      category: 'pretrained',
      ...PRETRAINED_MODELS[key],
    });
  });
  
  // Add configured custom models
  Object.keys(CUSTOM_MODELS).forEach(key => {
    if (hasCustomModel(key)) {
      models.push({
        type: MODEL_TYPES.CUSTOM,
        category: 'custom',
        key: key,
        ...CUSTOM_MODELS[key],
      });
    }
  });
  
  return models;
};

export default {
  MODEL_TYPES,
  PRETRAINED_MODELS,
  CUSTOM_MODELS,
  DETECTION_CONFIG,
  OBJECT_CATEGORIES,
  DISTANCE_CONFIG,
  PREPROCESSING_CONFIG,
  getRecommendedModel,
  hasCustomModel,
  getAvailableModels,
};
