# Lantern - AI Navigation Assistant

## Overview
Real-time object detection and navigation assistance for visually impaired users using on-device AI.

## Technology Stack
- **Object Detection**: COCO-SSD with lite_mobilenet_v2 backbone
- **Detection Classes**: 90 COCO categories (person, car, chair, etc.)
- **Processing**: On-device with TensorFlow.js React Native
- **Model Size**: ~5MB (lite version)
- **Audio**: Text-to-speech navigation commands

## Features Implemented

### 1. Object Detection
- Real-time detection of 90 object types
- Confidence scoring (50%+ threshold)
- Bounding box localization

### 2. Distance Estimation
- Monocular depth estimation using object height ratios
- Known object heights database (person: 1.7m, car: 1.5m, etc.)
- Pinhole camera model calculations
- Range: 0.3m - 20m

### 3. Spatial Analysis
- **Left/Center/Right** positioning relative to camera
- **Region of Interest (ROI)** filtering - focuses on ground-level walkable path
- Trapezoid ROI to prioritize obstacles in walking area
- Distance-based danger zones (< 1m = very close, < 2m = close)

### 4. Navigation Commands
- **CLEAR**: Path clear ahead, proceed forward
- **STOP**: Object < 1m, immediate stop required
- **TURN_LEFT**: Obstacle ahead, clearer path on left
- **TURN_RIGHT**: Obstacle ahead, clearer path on right
- **KEEP_LEFT**: Obstacle on right side, stay left
- **KEEP_RIGHT**: Obstacle on left side, stay right
- **NARROW**: Obstacles both sides, stay centered
- **PROCEED**: Some objects detected but path mostly clear

### 5. User Interface
- **Scan Environment** button: Capture photo and analyze
- **Voice** button: Hold to record voice commands
- **Flip** button: Switch camera front/back
- **Status Display**: Shows navigation command and obstacle count
- **Color Coding**: 
  - Red = Danger (STOP command)
  - Green = Safe (CLEAR path)
  - Blue = Caution (other commands)

### 6. Voice Commands
Say any of these while holding Voice button:
- "scan" / "identify" / "navigate" → Analyze environment
- "flip" / "camera" → Switch camera
- "back" / "home" → Return to home screen
- "repeat" → Repeat last navigation command

## How It Works

### Detection Pipeline
1. User presses "Scan Environment"
2. Camera captures photo
3. Image decoded to tensor format
4. COCO-SSD detects objects with bounding boxes
5. Results filtered to Region of Interest (ground-level path)
6. Distance estimated for each object
7. Spatial position determined (left/center/right)
8. Navigation algorithm analyzes obstacle layout
9. Command generated and spoken via TTS

### Distance Calculation
```javascript
distance = (knownHeight * focalLength) / pixelHeight

Example:
- Person height: 1.7m
- Focal length: 700px (typical phone camera)
- Bounding box: 350px tall
- Distance = (1.7 * 700) / 350 = 3.4 meters
```

### Navigation Logic
1. Filter objects < 2m away (danger zone)
2. Check if center path blocked:
   - Yes → Determine clearer side, command turn
   - No → Check side obstacles
3. If both sides blocked → STOP/NARROW warning
4. If one side blocked → KEEP_LEFT/KEEP_RIGHT
5. If all clear → PROCEED/CLEAR

## Performance

### Model Loading Time
- **First run**: 5-10 seconds (downloads ~5MB model)
- **Subsequent runs**: 1-2 seconds (cached in device)
- **Optimization**: Using `lite_mobilenet_v2` reduces size by ~60%

### Detection Speed
- **Inference time**: 200-500ms per image on modern devices
- **Total analysis**: 1-2 seconds (capture + detect + analyze + speak)
- **Recommended**: Wait for speech to finish before next scan

## Known Limitations

### Distance Accuracy
- ±30% error typical for monocular estimation
- Accuracy depends on:
  - Object type (known height database)
  - Camera calibration (focal length varies per device)
  - Image quality
  - Object orientation

### Detection Limitations
- Requires good lighting (camera quality dependent)
- May miss very small or distant objects
- Confidence threshold at 50% (adjust in code if needed)
- No depth sensor integration (monocular only)

### Model Constraints
- 90 COCO classes only (common objects)
- No custom object training
- Cannot detect unmarked hazards (wet floor, stairs, curbs)
- No text recognition (signs, labels)

## Future Enhancements

### Short Term
1. **Continuous scanning mode**: Auto-scan every 2-3 seconds
2. **Haptic feedback**: Vibration patterns for directions
3. **Object tracking**: Follow specific objects across frames
4. **Custom alerts**: User-defined danger objects

### Medium Term
1. **ARKit/ARCore integration**: True depth maps
2. **Custom model training**: Your SSD-Inception model
3. **Offline speech**: On-device STT for voice commands
4. **Path memory**: Remember safe routes

### Long Term
1. **Semantic SLAM**: Build 3D map of environment
2. **Multi-sensor fusion**: LiDAR + camera + IMU
3. **Cloud enhancement**: Fallback to cloud API for complex scenes
4. **Crowdsourced data**: Share obstacle maps

## Troubleshooting

### "Model loading too slow"
- ✅ Fixed: Using `lite_mobilenet_v2` (5MB vs 13MB)
- First download requires internet
- Subsequent loads use cache

### "Cannot read property 'Base64' of undefined"
- ✅ Fixed: Changed to `encoding: 'base64'` string
- expo-file-system API uses string, not enum

### "CameraView does not support children"
- ✅ Fixed: Moved UI overlays outside CameraView as siblings
- Uses absolute positioning over camera

### "Detection not working"
- Check camera permissions granted
- Ensure good lighting
- Point at common objects (person, chair, car, etc.)
- Wait for "Navigation ready" speech on startup

### "Inaccurate distances"
- Expected with monocular estimation
- Calibrate focal length for your device (default 700px)
- Works best for objects in database (person, car, etc.)

## Code Structure

```
Lantern/
├── screens/
│   └── CameraScreen.js      # Main navigation screen
├── utils/
│   └── navigationUtils.js   # Distance estimation & pathfinding
├── metro.config.js          # Model asset loading config
└── package.json             # Dependencies
```

## Key Files

### `navigationUtils.js`
- `estimateDistance()`: Monocular depth from bbox
- `analyzeObstacles()`: Spatial analysis + filtering
- `generateNavigationCommand()`: Decision logic
- `isInROI()`: Region of interest filtering

### `CameraScreen.js`
- Model initialization (COCO-SSD)
- Camera capture + image processing
- TensorFlow inference
- Text-to-speech output
- Voice command handling

## Dependencies
```json
{
  "@tensorflow/tfjs": "^4.22.0",
  "@tensorflow/tfjs-react-native": "^0.8.0",
  "@tensorflow-models/coco-ssd": "^2.2.3",
  "@react-native-async-storage/async-storage": "^1.23.1",
  "expo-camera": "~17.0.8",
  "expo-audio": "~1.0.13",
  "expo-speech": "~14.0.7",
  "expo-file-system": "~19.0.17",
  "expo-gl": "~16.0.7"
}
```

## Testing Checklist
- [ ] Camera permission granted
- [ ] Model loads (check console: "COCO-SSD model loaded successfully")
- [ ] "Navigation ready" spoken on startup
- [ ] Scan button detects objects
- [ ] Navigation commands spoken
- [ ] Status display updates
- [ ] Voice commands work
- [ ] Distance estimates reasonable (±30%)

## Usage Tips
1. **Wait for model**: Don't scan until "Navigation ready" spoken
2. **Good lighting**: Camera quality affects detection
3. **Point at ground level**: ROI focuses on walking path
4. **Close objects**: Detection best for 1-5 meter range
5. **Common objects**: Works best with COCO dataset items
6. **Voice timing**: Hold button entire time speaking

## Next Steps
To integrate your custom SSD-Inception model:
1. Convert frozen graph to TF.js format (see parent conversation)
2. Bundle model files in `assets/models/`
3. Replace `cocoSsd.load()` with `tf.loadGraphModel()`
4. Map output tensors to boxes/scores/classes
5. Keep existing navigation logic (model-agnostic)

---

**Status**: Production-ready for testing
**Last Updated**: October 20, 2025
