/*
 * CameraScreen - Object Detection Navigation for Visually Impaired
 * 
 * FIXES APPLIED:
 * 1. Removed skipProcessing flag - was causing orientation/quality issues
 * 2. Increased image quality to 0.85 for better detection
 * 3. Added comprehensive logging for debugging
 * 4. Added detection validation and fallback handling
 * 5. Improved error messages
 * 
 * IMPLEMENTATION:
 * - TensorFlow.js React Native with COCO-SSD (MobileNet-SSD backbone)
 * - Real-time object detection (90 COCO classes)
 * - Distance estimation using bounding box analysis
 * - Spatial obstacle analysis (left/center/right positioning)
 * - Navigation commands via text-to-speech
 * - On-device processing (works offline after initial model download)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { Accelerometer } from 'expo-sensors';
import * as tf from '@tensorflow/tfjs';
// Side-effect import registers the React Native backend and utilities.
import '@tensorflow/tfjs-react-native';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as deeplab from '@tensorflow-models/deeplab';
import * as FileSystem from 'expo-file-system/legacy';
import { 
  analyzeObstacles, 
  generateNavigationCommand 
} from '../utils/navigationUtils';

export default function CameraScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, setMicrophonePermission] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef(null);
  const [facing, setFacing] = useState('back');
  const [busy, setBusy] = useState(false);
  const [tfReady, setTfReady] = useState(false);
  const [model, setModel] = useState(null);
  const [sceneModel, setSceneModel] = useState(null);
  const [lastNavCommand, setLastNavCommand] = useState(null);
  const [imageSize, setImageSize] = useState({ width: 640, height: 480 });
  const [debugInfo, setDebugInfo] = useState('');
  
  // Movement detection state
  const [isMoving, setIsMoving] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const accelerometerSubscription = useRef(null);
  const scanInterval = useRef(null);
  const movementBuffer = useRef([]);
  const lastScanTime = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        // Initialize TensorFlow.js for React Native and set the native backend.
        await tf.ready();
        try {
          await tf.setBackend('rn-webgl');
          await tf.ready();
          console.log('tfjs backend set to rn-webgl');
        } catch (be) {
          console.warn('Could not set rn-webgl backend, continuing with default:', be);
        }

        // Load COCO-SSD model (MobileNet-SSD backbone)
        // Detects 90 object classes from COCO dataset
        // Using lite_mobilenet_v2: smaller (~5MB) and faster to download
        console.log('Loading COCO-SSD model...');
        const loadedModel = await cocoSsd.load({
          base: 'lite_mobilenet_v2', // Faster/smaller than mobilenet_v2
        });
        setModel(loadedModel);
        console.log('COCO-SSD model loaded successfully');
        
        // Load DeepLab model for scene segmentation
        // Detects: floor, wall, building, sky, person, car, tree, road, grass, sidewalk, etc.
        console.log('Loading DeepLab model for scene segmentation...');
        const loadedSceneModel = await deeplab.load({
          base: 'pascal',           // Pascal VOC dataset (20 classes)
          quantizationBytes: 2,     // Quantized for smaller size/faster inference
        });
        setSceneModel(loadedSceneModel);
        console.log('DeepLab model loaded successfully');
        
        setTfReady(true);
        
        // Request camera permission
        if (!cameraPermission?.granted) {
          await requestCameraPermission();
        }
        
  // Request microphone permission first using expo-av
  const mic = await Audio.requestPermissionsAsync();
  setMicrophonePermission(mic.granted);
        
        // Configure audio mode for recording using expo-av Audio module
        // MUST be set before any recording attempts
        if (mic.granted) {
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: true,
              playsInSilentModeIOS: true,
              staysActiveInBackground: false,
              shouldDuckAndroid: true,
            });
            console.log('Audio mode configured for recording');
          } catch (audioError) {
            console.error('Could not set audio mode:', audioError);
          }
        }
        
        if (cameraPermission?.granted) Speech.speak('Navigation ready');
        else Speech.speak('Camera permission required');
      } catch (e) {
        console.error('Initialization error', e);
        setMicrophonePermission(false);
        setTfReady(true); // Allow app to continue even if model fails
      }
    })();
  }, []);

  // Movement detection using accelerometer
  useEffect(() => {
    const MOVEMENT_THRESHOLD = 0.15; // Sensitivity for detecting movement
    const BUFFER_SIZE = 10; // Number of readings to average
    
    const startMovementDetection = async () => {
      try {
        // Set accelerometer update interval (100ms = 10 readings/sec)
        Accelerometer.setUpdateInterval(100);
        
        accelerometerSubscription.current = Accelerometer.addListener(({ x, y, z }) => {
          // Calculate magnitude of acceleration (excluding gravity ~9.8)
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          const acceleration = Math.abs(magnitude - 9.8);
          
          // Add to rolling buffer
          movementBuffer.current.push(acceleration);
          if (movementBuffer.current.length > BUFFER_SIZE) {
            movementBuffer.current.shift();
          }
          
          // Calculate average acceleration
          const avgAcceleration = movementBuffer.current.reduce((a, b) => a + b, 0) / movementBuffer.current.length;
          
          // User is moving if average acceleration exceeds threshold
          const moving = avgAcceleration > MOVEMENT_THRESHOLD;
          
          if (moving !== isMoving) {
            setIsMoving(moving);
            console.log(moving ? 'Movement detected' : 'User stopped');
          }
        });
        
        console.log('Movement detection started');
      } catch (error) {
        console.warn('Could not start movement detection:', error);
      }
    };
    
    startMovementDetection();
    
    // Cleanup on unmount
    return () => {
      if (accelerometerSubscription.current) {
        accelerometerSubscription.current.remove();
      }
    };
  }, []);

  // Continuous scanning when in continuous mode and moving
  useEffect(() => {
    if (continuousMode && isMoving && model && !busy) {
      // Start continuous scanning
      scanInterval.current = setInterval(() => {
        const now = Date.now();
        // Only scan if 2.5 seconds passed since last scan
        if (now - lastScanTime.current > 2500) {
          continuousScan();
        }
      }, 2500);
      
      console.log('Continuous scanning enabled');
    } else {
      // Stop continuous scanning
      if (scanInterval.current) {
        clearInterval(scanInterval.current);
        scanInterval.current = null;
      }
    }
    
    // Cleanup
    return () => {
      if (scanInterval.current) {
        clearInterval(scanInterval.current);
      }
    };
  }, [continuousMode, isMoving, model, busy]);

  const speak = (text) => {
    try {
      // Stop any ongoing speech before speaking new text
      Speech.stop();
      Speech.speak(text, { language: 'en-US', rate: 0.95 });
    } catch (e) {
      console.warn('Speech error:', e);
    }
  };

  const toggleFacing = () => {
    const next = facing === 'back' ? 'front' : 'back';
    setFacing(next);
    speak(next === 'back' ? 'Back camera' : 'Front camera');
  };

  const toggleContinuousMode = () => {
    const newMode = !continuousMode;
    setContinuousMode(newMode);
    if (newMode) {
      speak('Continuous navigation enabled. Move to start scanning.');
    } else {
      speak('Continuous navigation disabled');
    }
  };

  const continuousScan = async () => {
    if (!cameraRef.current || !model || busy) return;
    
    try {
      lastScanTime.current = Date.now();
      
      // FIXED: Removed skipProcessing and increased quality
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.85,  // Increased from 0.7 for better detection
        base64: false,
        // skipProcessing removed - was causing orientation issues
      });
      
      const navCommand = await analyzeImageForNavigation(photo.uri, photo.width, photo.height);
      
      // Only speak if command changed significantly
      if (shouldAnnounceCommand(navCommand)) {
        setLastNavCommand(navCommand);
        if (navCommand && navCommand.speech) {
          speak(navCommand.speech);
        }
      } else {
        // Update display but don't speak
        setLastNavCommand(navCommand);
      }
    } catch (e) {
      console.error('Continuous scan error:', e);
    }
  };

  const shouldAnnounceCommand = (newCommand) => {
    if (!lastNavCommand) return true;
    
    // Announce if command type changed
    if (newCommand.command !== lastNavCommand.command) return true;
    
    // Announce if STOP command (always important)
    if (newCommand.command === 'STOP') return true;
    
    // Announce if obstacle type or position changed
    if (newCommand.closestObstacle?.class !== lastNavCommand.closestObstacle?.class) return true;
    
    // Announce if distance changed significantly (> 0.5m)
    if (newCommand.closestObstacle && lastNavCommand.closestObstacle) {
      const distChange = Math.abs(
        newCommand.closestObstacle.distance - lastNavCommand.closestObstacle.distance
      );
      if (distChange > 0.5) return true;
    }
    
    return false;
  };

  const identifySurroundings = async () => {
    if (!cameraRef.current || !model) {
      speak('Camera not ready');
      return;
    }
    setBusy(true);
    speak('Scanning environment');
    try {
      // FIXED: Removed skipProcessing and increased quality for better detection
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.85,  // Increased from 0.7
        base64: false,
        // skipProcessing: true REMOVED - was causing detection issues
      });
      
      console.log('Photo captured:', photo.width, 'x', photo.height);
      
      // Perform object detection and navigation analysis
      const navCommand = await analyzeImageForNavigation(photo.uri, photo.width, photo.height);
      
      // Update state and speak navigation command
      setLastNavCommand(navCommand);
      if (navCommand && navCommand.speech) {
        speak(navCommand.speech);
      } else {
        speak('Unable to analyze environment');
      }
    } catch (e) {
      console.error('Analysis error:', e);
      speak('Analysis failed');
      setDebugInfo(`Error: ${e.message}`);
    }
    setBusy(false);
  };

  const startRecording = async () => {
    if (!microphonePermission) {
      speak('Microphone permission required');
      return;
    }
    try {
      console.log('Starting recording...');
      
      // Stop any ongoing speech (prevents audio conflicts on iOS)
      Speech.stop();

      // Small delay to ensure audio mode is ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create and start a new Recording using expo-av
      const recording = new Audio.Recording();
      try {
        await recording.prepareToRecordAsync(Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
        await recording.startAsync();
        recordingRef.current = recording;
        setIsRecording(true);
        console.log('Recording started successfully');
      } catch (recErr) {
        console.error('Recording start failed', recErr);
        setIsRecording(false);
      }
      
      // Don't speak "Recording" - it interferes with mic
    } catch (e) {
      console.error('Recording start error:', e);
      Speech.speak('Could not start recording');
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setIsRecording(false);
      speak('Processing voice command');
      const text = await sendAudioForTranscription(uri);
      handleVoiceCommand(text);
    } catch (e) {
      console.error(e);
      speak('Recording failed');
      setIsRecording(false);
    }
  };

  const handleVoiceCommand = (text) => {
    if (!text) return speak('I did not hear anything');
    const cmd = text.toLowerCase();
    if (cmd.includes('identify') || cmd.includes('scan') || cmd.includes('what') || cmd.includes('navigate')) {
      identifySurroundings();
      return;
    }
    if (cmd.includes('flip') || cmd.includes('camera')) {
      toggleFacing();
      return;
    }
    if (cmd.includes('back') || cmd.includes('home')) {
      speak('Going back');
      navigation.goBack();
      return;
    }
    if (cmd.includes('repeat') && lastNavCommand) {
      speak(lastNavCommand.speech);
      return;
    }
    speak('Command not recognized. Say scan, flip, back, or repeat');
  };

  async function analyzeImageForNavigation(imageUri, imgWidth, imgHeight) {
    try {
      if (!model) {
        throw new Error('Model not loaded');
      }

      console.log('========================================');
      console.log('Starting image analysis:', imageUri);
      console.log('Photo dimensions:', imgWidth, 'x', imgHeight);
      
      // Read the image file as base64
      const imgB64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: 'base64',
      });
      
      console.log('Image loaded, size:', imgB64.length, 'bytes');
      
      // Convert base64 to Uint8Array
      const binaryString = atob(imgB64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      console.log('Image converted to bytes:', bytes.length);
      
      // Decode JPEG to tensor
      const imageTensor = decodeJpeg(bytes);
      const [height, width] = imageTensor.shape;
      
      console.log('Tensor created:', width, 'x', height);
      
      // Update image size for distance estimation
      setImageSize({ width, height });
      
      // Run COCO-SSD object detection
      console.log('Running object detection...');
      const predictions = await model.detect(imageTensor);
      console.log('========================================');
      console.log(`RAW DETECTION: ${predictions.length} objects detected`);
      
      if (predictions.length > 0) {
        console.log('Detected objects:');
        predictions.forEach((pred, idx) => {
          console.log(`  ${idx + 1}. ${pred.class} (${(pred.score * 100).toFixed(1)}%) at [${pred.bbox.map(v => v.toFixed(0)).join(', ')}]`);
        });
      } else {
        console.log('⚠️ WARNING: No objects detected in image!');
        setDebugInfo(`No objects detected. Try pointing at common objects (person, chair, car, etc.)`);
      }
      console.log('========================================');
      
      // Run DeepLab scene segmentation (if model loaded)
      let sceneInfo = null;
      if (sceneModel) {
        try {
          const segmentation = await sceneModel.segment(imageTensor);
          sceneInfo = analyzeSceneSegmentation(segmentation, width, height);
          console.log('Scene analysis:', sceneInfo);
        } catch (segError) {
          console.warn('Scene segmentation error:', segError);
        }
      }
      
      // Convert COCO-SSD bbox format [x, y, w, h] to normalized [ymin, xmin, ymax, xmax]
      const detections = predictions.map(pred => ({
        class: pred.class,
        score: pred.score,
        bbox: [
          pred.bbox[1] / height,           // ymin
          pred.bbox[0] / width,            // xmin
          (pred.bbox[1] + pred.bbox[3]) / height,  // ymax
          (pred.bbox[0] + pred.bbox[2]) / width,   // xmax
        ]
      }));
      
      console.log('Analyzing obstacles with ROI filter...');
      
      // Analyze obstacles and generate navigation command
      // Using 0.4 confidence threshold (lowered from 0.5 for better detection)
      const obstacles = analyzeObstacles(detections, { width, height }, 0.4);
      
      console.log(`After ROI filtering: ${obstacles.length} obstacles in walking path`);
      
      if (obstacles.length > 0) {
        console.log('Obstacles in path:');
        obstacles.forEach((obs, idx) => {
          console.log(`  ${idx + 1}. ${obs.class} - ${obs.position} - ${obs.distance.toFixed(1)}m`);
        });
      } else {
        console.log('⚠️ No obstacles in ROI (walking path)');
        if (predictions.length > 0) {
          console.log('Objects were detected but filtered out by ROI');
          setDebugInfo(`Detected ${predictions.length} objects, but none in walking path`);
        }
      }
      
      const navCommand = generateNavigationCommand(obstacles);
      
      // Enhance navigation command with scene context
      if (sceneInfo) {
        enhanceNavigationWithScene(navCommand, sceneInfo);
      }
      
      // Add debug info to command
      navCommand.debugInfo = {
        totalDetections: predictions.length,
        obstaclesInROI: obstacles.length,
        imageSize: { width, height }
      };
      
      // Update debug display
      setDebugInfo(`Detected: ${predictions.length} | In path: ${obstacles.length}`);
      
      // Clean up tensors
      imageTensor.dispose();
      
      console.log('Navigation command:', navCommand.command, '-', navCommand.message);
      console.log('========================================');
      
      return navCommand;
    } catch (error) {
      console.error('Detection error:', error);
      console.error('Stack:', error.stack);
      setDebugInfo(`Error: ${error.message}`);
      return {
        command: 'ERROR',
        speech: 'Unable to analyze environment. Check console for details.',
        obstacles: []
      };
    }
  }

  function analyzeSceneSegmentation(segmentation, width, height) {
    // DeepLab Pascal VOC classes
    const SCENE_CLASSES = {
      0: 'background',
      1: 'aeroplane', 2: 'bicycle', 3: 'bird', 4: 'boat',
      5: 'bottle', 6: 'bus', 7: 'car', 8: 'cat', 9: 'chair',
      10: 'cow', 11: 'diningtable', 12: 'dog', 13: 'horse',
      14: 'motorbike', 15: 'person', 16: 'pottedplant',
      17: 'sheep', 18: 'sofa', 19: 'train', 20: 'tvmonitor'
    };
    
    const segmentationMap = segmentation.segmentationMap;
    const totalPixels = segmentationMap.length;
    
    // Count pixels for each class
    const classCounts = {};
    const ROI_TOP = Math.floor(height * 0.3);    // Focus on lower 70% (ground level)
    const ROI_BOTTOM = height;
    const ROI_LEFT = Math.floor(width * 0.2);
    const ROI_RIGHT = Math.floor(width * 0.8);
    
    let roiPixels = 0;
    
    for (let y = ROI_TOP; y < ROI_BOTTOM; y++) {
      for (let x = ROI_LEFT; x < ROI_RIGHT; x++) {
        const idx = y * width + x;
        const classId = segmentationMap[idx];
        classCounts[classId] = (classCounts[classId] || 0) + 1;
        roiPixels++;
      }
    }
    
    // Find dominant scene elements in ROI
    const sceneElements = Object.entries(classCounts)
      .map(([classId, count]) => ({
        class: SCENE_CLASSES[classId] || 'unknown',
        classId: parseInt(classId),
        percentage: (count / roiPixels) * 100
      }))
      .filter(el => el.percentage > 5) // Only significant elements (>5% of ROI)
      .sort((a, b) => b.percentage - a.percentage);
    
    // Detect specific hazards
    const warnings = [];
    
    // Check for significant background (could be floor/ground)
    const background = sceneElements.find(el => el.classId === 0);
    if (background && background.percentage > 40) {
      warnings.push('clear_path');
    }
    
    // Detect vehicles/large objects
    const largeObjects = sceneElements.filter(el => 
      ['car', 'bus', 'train', 'motorbike', 'bicycle'].includes(el.class)
    );
    if (largeObjects.length > 0) {
      warnings.push('vehicle_detected');
    }
    
    // Detect people
    const people = sceneElements.find(el => el.class === 'person');
    if (people && people.percentage > 15) {
      warnings.push('crowd_ahead');
    }
    
    return {
      elements: sceneElements,
      warnings: warnings,
      dominantScene: sceneElements[0]?.class || 'unknown'
    };
  }

  function enhanceNavigationWithScene(navCommand, sceneInfo) {
    // Add scene context to navigation speech
    const { warnings, dominantScene } = sceneInfo;
    
    if (!navCommand.speech) return;
    
    // Add scene warnings to speech
    if (warnings.includes('vehicle_detected') && navCommand.command !== 'STOP') {
      navCommand.speech += '. Vehicle nearby.';
    }
    
    if (warnings.includes('crowd_ahead') && navCommand.command === 'PROCEED') {
      navCommand.speech = 'People ahead. Proceed with caution.';
    }
    
    if (warnings.includes('clear_path') && navCommand.command === 'CLEAR') {
      navCommand.speech = 'Clear path ahead. Safe to proceed.';
    }
    
    // Store scene info in command
    navCommand.sceneInfo = sceneInfo;
  }

  async function sendAudioForTranscription(uri) {
    // simulated STT — replace with real service
    await new Promise((r) => setTimeout(r, 500));
    return 'identify';
  }

  if (cameraPermission === null || !cameraPermission || !tfReady || !model || !sceneModel) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.hint}>
          {!tfReady 
            ? 'Loading AI models...' 
            : !model 
            ? 'Loading object detection...'
            : !sceneModel
            ? 'Loading scene analysis...'
            : 'Requesting permissions'}
        </Text>
      </View>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Camera permission denied.</Text>
        <TouchableOpacity style={styles.smallButton} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing={facing} />
      
      {/* Overlays positioned absolutely over camera */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            speak('Going back');
            navigation.goBack();
          }}
        >
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
        
        {/* Movement indicator */}
        {continuousMode && (
          <View style={[styles.movementIndicator, isMoving && styles.movementActive]}>
            <Text style={styles.movementText}>
              {isMoving ? '🚶 Moving' : '🧍 Still'}
            </Text>
          </View>
        )}
      </View>

      {/* Debug Info */}
      {debugInfo && (
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>{debugInfo}</Text>
        </View>
      )}

      {/* Navigation Status Display */}
      {lastNavCommand && (
        <View style={styles.navStatus}>
          <Text style={[
            styles.navCommand,
            lastNavCommand.command === 'STOP' && styles.navDanger,
            lastNavCommand.command === 'CLEAR' && styles.navSafe,
          ]}>
            {lastNavCommand.message}
          </Text>
          {lastNavCommand.obstacles && lastNavCommand.obstacles.length > 0 && (
            <Text style={styles.navDetails}>
              {lastNavCommand.obstacles.length} obstacle{lastNavCommand.obstacles.length > 1 ? 's' : ''} detected
            </Text>
          )}
          {lastNavCommand.debugInfo && (
            <Text style={styles.navDetails}>
              Total: {lastNavCommand.debugInfo.totalDetections} | Path: {lastNavCommand.debugInfo.obstaclesInROI}
            </Text>
          )}
        </View>
      )}

      <View style={styles.controls} pointerEvents="box-none">
        {/* Continuous mode toggle */}
        <TouchableOpacity
          style={[styles.continuousButton, continuousMode && styles.continuousActive]}
          onPress={toggleContinuousMode}
        >
          <Text style={styles.continuousText}>
            {continuousMode ? '⚡ Auto-Scan ON' : '🔘 Auto-Scan OFF'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[
            styles.identifyButton,
            lastNavCommand?.command === 'STOP' && styles.identifyButtonDanger
          ]} 
          onPress={identifySurroundings} 
          disabled={busy || continuousMode}
        >
          <Text style={styles.identifyText}>
            {busy ? 'Scanning...' : continuousMode ? 'Auto-Scan Active' : 'Scan Environment'}
          </Text>
        </TouchableOpacity>

        <View style={styles.rowButtons}>
          <TouchableOpacity
            style={[styles.smallButton, isRecording && styles.recording]}
            onPressIn={startRecording}
            onPressOut={stopRecording}
          >
            <Text style={styles.buttonText}>{isRecording ? 'Recording' : 'Voice'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.smallButton} onPress={toggleFacing}>
            <Text style={styles.buttonText}>Flip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  hint: { color: '#fff', marginTop: 12, fontSize: 16 },
  camera: { flex: 1 },
  topBar: { position: 'absolute', top: 40, left: 16, right: 16, zIndex: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backButton: { backgroundColor: 'rgba(0,0,0,0.7)', padding: 12, borderRadius: 8 },
  movementIndicator: {
    backgroundColor: 'rgba(100,100,100,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#666',
  },
  movementActive: {
    backgroundColor: 'rgba(76,175,80,0.8)',
    borderColor: '#4CAF50',
  },
  movementText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  debugInfo: {
    position: 'absolute',
    top: 90,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255,152,0,0.9)',
    padding: 8,
    borderRadius: 8,
  },
  debugText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  navStatus: { 
    position: 'absolute', 
    top: 130, 
    left: 16, 
    right: 16, 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    padding: 16, 
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3b82f6',
  },
  navCommand: { 
    color: '#fff', 
    fontSize: 20, 
    fontWeight: '700',
    textAlign: 'center',
  },
  navDanger: {
    color: '#ff4444',
  },
  navSafe: {
    color: '#44ff44',
  },
  navDetails: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  controls: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
  continuousButton: {
    backgroundColor: 'rgba(100,100,100,0.8)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#666',
  },
  continuousActive: {
    backgroundColor: 'rgba(76,175,80,0.9)',
    borderColor: '#4CAF50',
  },
  continuousText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  identifyButton: { 
    backgroundColor: '#3b82f6', 
    paddingVertical: 20, 
    paddingHorizontal: 48, 
    borderRadius: 40,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  identifyButtonDanger: {
    backgroundColor: '#ff4444',
  },
  identifyText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  rowButtons: { flexDirection: 'row', marginTop: 16, width: '60%', justifyContent: 'space-between' },
  smallButton: { 
    backgroundColor: 'rgba(0,0,0,0.7)', 
    padding: 14, 
    borderRadius: 12, 
    minWidth: 100, 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#555',
  },
  recording: { backgroundColor: '#ff4d4d', borderColor: '#ff0000' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});