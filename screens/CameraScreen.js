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
  BackHandler,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import * as tf from '@tensorflow/tfjs';
// Side-effect import registers the React Native backend and utilities.
import '@tensorflow/tfjs-react-native';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import YOLODetector from '../services/YOLODetector';
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
  
  // Performance optimization - frame skipping
  const frameSkipCount = useRef(0);
  const FRAME_SKIP = 4; // Process every 4th frame (4x faster - optimized for real-time)
  
  // Depth perception state
  const [depthMap, setDepthMap] = useState(null);
  const lastDepthUpdate = useRef(0);
  
  // Performance: tensor caching
  const tensorCache = useRef(null);
  const lastProcessedImage = useRef(null);
  
  // Volume button detection for scanning
  const lastVolumePress = useRef(0);
  const volumeClickCount = useRef(0);

  useEffect(() => {
    // OPTIMIZED STARTUP: Parallel initialization instead of sequential
    const initializeApp = async () => {
      try {
        const startTime = Date.now();
        console.log('🚀 Starting initialization...');
        
        // PARALLEL: Request permissions immediately (don't wait)
        const permissionPromises = [
          !cameraPermission?.granted ? requestCameraPermission() : Promise.resolve(),
          Audio.requestPermissionsAsync()
        ];
        
        // LAZY LOAD: Start TensorFlow in background, don't block UI
        const tfPromise = (async () => {
          try {
            await tf.ready();
            await tf.setBackend('rn-webgl');
            await tf.ready();
            console.log('✅ TensorFlow ready');
            return true;
          } catch (e) {
            console.warn('⚠️ TensorFlow backend warning:', e.message);
            return true;
          }
        })();
        
        // LAZY LOAD: Model loads in background after TensorFlow
        const modelPromise = tfPromise.then(async () => {
          try {
            console.log('📦 Loading model...');
            await YOLODetector.loadModel('YOLOV5_NANO');
            setModel(YOLODetector);
            console.log('✅ Model ready');
            return true;
          } catch (e) {
            console.error('❌ Model load failed:', e.message);
            setModel(YOLODetector); // Still set for COCO-SSD fallback
            return false;
          }
        });
        
        // Wait for permissions first (fast)
        const [, micResult] = await Promise.all(permissionPromises);
        setMicrophonePermission(micResult.granted);
        
        // Configure audio mode - SINGLE CONFIG for both recording AND playback
        if (micResult.granted) {
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: true,           // Enable microphone recording
              playsInSilentModeIOS: true,         // Play TTS even in silent mode
              staysActiveInBackground: false,     // Don't stay active in background
              shouldDuckAndroid: false,           // Don't lower our volume for other apps
              interruptionModeIOS: 2,             // Duck other audio (makes our TTS louder)
              interruptionModeAndroid: 1,         // Don't duck on Android
              playThroughEarpieceAndroid: false,  // Use main speaker, not earpiece
            });
            console.log('🔊 Audio mode configured: recording + max volume playback');
          } catch (e) {
            console.warn('⚠️ Audio mode config error:', e.message);
          }
        }
        
        // Mark UI as ready IMMEDIATELY (don't wait for model)
        setTfReady(true);
        const readyTime = Date.now();
        console.log(`⚡ UI ready in ${readyTime - startTime}ms`);
        
        // Announce ready immediately
        if (cameraPermission?.granted) {
          Speech.speak('Navigation ready. Model loading in background.', { volume: 1.0, rate: 1.0 });
        }
        
        // Model loads in background, announce when done
        modelPromise.then((success) => {
          const totalTime = Date.now() - startTime;
          console.log(`✅ Full initialization: ${totalTime}ms`);
          if (success) {
            Speech.speak('Detection ready', { volume: 1.0, rate: 1.0 });
          }
        });
        
      } catch (e) {
        console.error('Initialization error', e);
        setMicrophonePermission(false);
        setTfReady(true); // Allow app to continue
      }
    };
    
    initializeApp();
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
      // Ultra-fast continuous scanning (with aggressive frame skipping)
      scanInterval.current = setInterval(() => {
        const now = Date.now();
        // Reduced to 800ms for maximum real-time responsiveness
        if (now - lastScanTime.current > 800) {
          continuousScan();
        }
      }, 800); // Very fast interval - frame skip prevents overload
      
      console.log('Real-time scanning enabled (4x frame skip, 800ms interval)');
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

  // IMPROVED: Screen double-tap detection with haptic feedback
  // Requires TWO quick taps within 400ms to activate
  const handleScreenDoubleTap = () => {
    const now = Date.now();
    const timeSinceLastTap = now - lastVolumePress.current;
    
    if (timeSinceLastTap < 400 && timeSinceLastTap > 0) {
      // Double tap detected!
      console.log('🔊 Double-tap detected - triggering scan');
      
      // Strong haptic feedback for confirmation
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      
      // Announce with maximum volume
      speak('Start scanning');
      
      // Trigger scan after brief delay
      setTimeout(() => identifySurroundings(), 300);
      
      // Reset timer
      lastVolumePress.current = 0;
    } else {
      // First tap - set timer and give light haptic feedback
      console.log('👆 First tap detected, tap again quickly for double-tap');
      lastVolumePress.current = now;
      
      // Light haptic to indicate first tap registered
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const speak = (text, options = {}) => {
    try {
      // Stop any ongoing speech before speaking new text
      Speech.stop();
      
      // MAXIMUM VOLUME SETTINGS:
      // - volume: 1.0 (max on scale 0.0-1.0)
      // - rate: 0.9 (slightly slower for clarity)
      // - pitch: 1.0 (normal pitch)
      // iOS will respect device volume + this setting
      Speech.speak(text, { 
        language: 'en-US', 
        rate: 0.9,
        pitch: 1.0,
        volume: 1.0,  // MAXIMUM VOLUME (0.0 to 1.0)
        ...options
      });
      
      console.log(`🔊 Speaking: "${text}" at max volume`);
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
    
    // Frame skipping for performance - skip 3 out of 4 frames
    frameSkipCount.current++;
    if (frameSkipCount.current < FRAME_SKIP) {
      return; // Skip this frame
    }
    frameSkipCount.current = 0; // Reset counter
    
    try {
      lastScanTime.current = Date.now();
      
      // MAXIMUM PERFORMANCE: very low quality, small resolution for real-time
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.4,  // Reduced from 0.6 for maximum speed
        base64: false,
        // exif: false, // Skip EXIF data processing
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
      // Higher quality for manual scan (not continuous, so speed less critical)
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.8,  // Good balance between quality and speed
        base64: false,
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
      console.log('Real-time YOLO analysis:', imageUri.substring(imageUri.length - 20));
      
      // Update image size for distance estimation
      setImageSize({ width: imgWidth, height: imgHeight });
      
      // PERFORMANCE OPTIMIZATION: Run detection with timeout
      const detectionPromise = model.detect(imageUri);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Detection timeout')), 3000)
      );
      
      const predictions = await Promise.race([detectionPromise, timeoutPromise]);
      
      console.log(`🎯 ${predictions.length} objects | Real-time mode`);
      
      // DEPTH PERCEPTION: Calculate depth map from bounding boxes
      const depthInfo = calculateDepthPerception(predictions, imgWidth, imgHeight);
      setDepthMap(depthInfo);
      
      // Analyze obstacles with optimized confidence threshold
      const obstacles = analyzeObstacles(predictions, { width: imgWidth, height: imgHeight }, 0.35);
      
      // Enhance obstacles with depth information
      const enhancedObstacles = obstacles.map(obs => ({
        ...obs,
        depthZone: getDepthZone(obs.distance),
        relativeDepth: depthInfo.relativeDepths[obs.class] || 'medium'
      }));
      
      const navCommand = generateNavigationCommand(enhancedObstacles);
      
      // Add depth and performance info
      navCommand.debugInfo = {
        totalDetections: predictions.length,
        obstaclesInROI: obstacles.length,
        depthLayers: depthInfo.layers,
        model: 'YOLO-Optimized'
      };
      
      setDebugInfo(`${predictions.length} obj | ${obstacles.length} path | ${depthInfo.layers} depths`);
      
      console.log('Nav:', navCommand.command);
      console.log('========================================');
      
      return navCommand;
    } catch (error) {
      console.error('Detection error:', error.message);
      setDebugInfo(`Error: ${error.message}`);
      return {
        command: 'ERROR',
        speech: 'Analysis failed.',
        obstacles: []
      };
    }
  }
  
  // DEPTH PERCEPTION: Calculate depth layers and relative positions
  function calculateDepthPerception(detections, width, height) {
    if (!detections || detections.length === 0) {
      return { layers: 0, relativeDepths: {}, nearestDistance: null };
    }
    
    const depthLayers = {
      veryClose: [], // < 1.5m
      close: [],      // 1.5-3m
      medium: [],     // 3-5m
      far: []         // > 5m
    };
    
    const relativeDepths = {};
    let nearestDistance = Infinity;
    
    detections.forEach(det => {
      const [ymin, xmin, ymax, xmax] = det.bbox;
      const bboxHeight = (ymax - ymin) * height;
      
      // Estimate depth from bbox size (larger = closer)
      const estimatedDistance = estimateDepthFromSize(bboxHeight, det.class);
      
      if (estimatedDistance < nearestDistance) {
        nearestDistance = estimatedDistance;
      }
      
      // Classify into depth layers
      if (estimatedDistance < 1.5) {
        depthLayers.veryClose.push(det);
        relativeDepths[det.class] = 'veryClose';
      } else if (estimatedDistance < 3.0) {
        depthLayers.close.push(det);
        relativeDepths[det.class] = 'close';
      } else if (estimatedDistance < 5.0) {
        depthLayers.medium.push(det);
        relativeDepths[det.class] = 'medium';
      } else {
        depthLayers.far.push(det);
        relativeDepths[det.class] = 'far';
      }
    });
    
    const layerCount = Object.values(depthLayers).filter(arr => arr.length > 0).length;
    
    return {
      layers: layerCount,
      depthLayers,
      relativeDepths,
      nearestDistance: nearestDistance === Infinity ? null : nearestDistance
    };
  }
  
  // Estimate depth from object size in pixels
  function estimateDepthFromSize(heightInPixels, objectClass) {
    // Average heights in meters for common objects
    const typicalHeights = {
      person: 1.7,
      car: 1.5,
      chair: 0.9,
      bicycle: 1.2,
      default: 1.0
    };
    
    const realHeight = typicalHeights[objectClass] || typicalHeights.default;
    
    // Simple inverse relationship: distance ≈ (realHeight * focalLength) / pixelHeight
    const focalLength = 700; // Approximate for mobile cameras
    const estimatedDistance = (realHeight * focalLength) / Math.max(heightInPixels, 10);
    
    return Math.min(Math.max(estimatedDistance, 0.5), 20); // Clamp to 0.5-20m
  }
  
  // Get depth zone label
  function getDepthZone(distance) {
    if (distance < 1.5) return 'immediate';
    if (distance < 3.0) return 'near';
    if (distance < 5.0) return 'medium';
    return 'far';
  }

  async function sendAudioForTranscription(uri) {
    // simulated STT — replace with real service
    await new Promise((r) => setTimeout(r, 500));
    return 'identify';
  }

  if (cameraPermission === null || !cameraPermission || !tfReady || !model) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.hint}>
          {!tfReady 
            ? 'Initializing TensorFlow...' 
            : !model 
            ? 'Loading YOLO detector...'
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
      {/* Double-tap anywhere on screen to trigger scan (alternative to volume buttons) */}
      <TouchableOpacity 
        style={styles.camera} 
        activeOpacity={1}
        onPress={handleScreenDoubleTap}
      >
        <CameraView ref={cameraRef} style={styles.camera} facing={facing} />
      </TouchableOpacity>
      
      {/* AR-Style Scanning Grid Overlay */}
      {busy && (
        <View style={styles.scanningOverlay}>
          <View style={styles.scanLine} />
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
        </View>
      )}

      {/* Top Bar with Glassmorphic Back Button */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButtonGlass}
          onPress={() => {
            speak('Going back');
            navigation.goBack();
          }}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={['rgba(255, 107, 53, 0.3)', 'rgba(255, 0, 110, 0.3)']}
            style={styles.backButtonGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>Back</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        {/* Movement indicator with glow */}
        {continuousMode && (
          <View style={[styles.movementIndicator, isMoving && styles.movementActive]}>
            <LinearGradient
              colors={isMoving ? ['rgba(0, 255, 136, 0.4)', 'rgba(0, 217, 255, 0.4)'] : ['rgba(100, 100, 100, 0.4)', 'rgba(60, 60, 60, 0.4)']}
              style={styles.movementGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.movementText}>
                {isMoving ? '🚶 Moving' : '🧍 Still'}
              </Text>
            </LinearGradient>
          </View>
        )}
      </View>

      {/* Debug Info with Gradient */}
      {debugInfo && (
        <LinearGradient
          colors={['rgba(255, 152, 0, 0.95)', 'rgba(255, 193, 7, 0.95)']}
          style={styles.debugInfo}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={styles.debugText}>ℹ️ {debugInfo}</Text>
        </LinearGradient>
      )}

      {/* Glassmorphic Navigation Status Panel */}
      {lastNavCommand && (
        <View style={styles.navStatusWrapper}>
          <LinearGradient
            colors={
              lastNavCommand.command === 'STOP' 
                ? ['rgba(255, 45, 85, 0.3)', 'rgba(255, 0, 110, 0.3)']
                : lastNavCommand.command === 'CLEAR'
                ? ['rgba(0, 255, 136, 0.3)', 'rgba(0, 217, 255, 0.3)']
                : ['rgba(59, 130, 246, 0.3)', 'rgba(107, 47, 181, 0.3)']
            }
            style={styles.navStatusGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <BlurView intensity={40} tint="dark" style={styles.navStatus}>
              <View style={styles.navIconContainer}>
                <Text style={styles.navIcon}>
                  {lastNavCommand.command === 'STOP' ? '⚠️' : lastNavCommand.command === 'CLEAR' ? '✅' : '➡️'}
                </Text>
              </View>
              <Text style={[
                styles.navCommand,
                lastNavCommand.command === 'STOP' && styles.navDanger,
                lastNavCommand.command === 'CLEAR' && styles.navSafe,
              ]}>
                {lastNavCommand.message}
              </Text>
              {lastNavCommand.obstacles && lastNavCommand.obstacles.length > 0 && (
                <View style={styles.obstacleCount}>
                  <View style={styles.obstacleDot} />
                  <Text style={styles.navDetails}>
                    {lastNavCommand.obstacles.length} obstacle{lastNavCommand.obstacles.length > 1 ? 's' : ''} detected
                  </Text>
                </View>
              )}
              {lastNavCommand.debugInfo && (
                <Text style={styles.navDetailsSmall}>
                  Detected: {lastNavCommand.debugInfo.totalDetections} | In Path: {lastNavCommand.debugInfo.obstaclesInROI}
                </Text>
              )}
            </BlurView>
          </LinearGradient>
        </View>
      )}

      {/* Bottom Controls */}
      <View style={styles.controls} pointerEvents="box-none">
        {/* Auto-Scan Toggle with Modern Switch */}
        <TouchableOpacity
          style={styles.toggleContainer}
          onPress={toggleContinuousMode}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={continuousMode ? ['rgba(0, 255, 136, 0.3)', 'rgba(0, 217, 255, 0.3)'] : ['rgba(100, 100, 100, 0.3)', 'rgba(60, 60, 60, 0.3)']}
            style={styles.toggleGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <BlurView intensity={20} tint="dark" style={styles.toggleButton}>
              <Text style={styles.toggleIcon}>{continuousMode ? '⚡' : '○'}</Text>
              <Text style={styles.toggleText}>
                Auto-Scan {continuousMode ? 'ON' : 'OFF'}
              </Text>
              {continuousMode && <View style={styles.activePulse} />}
            </BlurView>
          </LinearGradient>
        </TouchableOpacity>
        
        {/* Circular FAB for Scan */}
        <TouchableOpacity 
          style={styles.fabContainer}
          onPress={identifySurroundings} 
          disabled={busy || continuousMode}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={
              lastNavCommand?.command === 'STOP' 
                ? ['#FF2D55', '#FF006E'] 
                : busy
                ? ['#FFD60A', '#FF9F1C']
                : ['#00D9FF', '#6B2FB5']
            }
            style={styles.fabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.fabInner}>
              <Text style={styles.fabIcon}>
                {busy ? '⟳' : continuousMode ? '◉' : '📡'}
              </Text>
              <Text style={styles.fabText}>
                {busy ? 'Scanning' : continuousMode ? 'Auto' : 'Scan'}
              </Text>
            </View>
          </LinearGradient>
          {!busy && !continuousMode && <View style={styles.fabPulse} />}
        </TouchableOpacity>

        {/* Bottom Control Pills */}
        <View style={styles.rowButtons}>
          <TouchableOpacity
            style={styles.pillButton}
            onPressIn={startRecording}
            onPressOut={stopRecording}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isRecording ? ['#FF2D55', '#FF006E'] : ['rgba(107, 47, 181, 0.4)', 'rgba(59, 130, 246, 0.4)']}
              style={styles.pillGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={15} tint="dark" style={styles.pillInner}>
                <Text style={styles.pillIcon}>{isRecording ? '⏺' : '🎤'}</Text>
                <Text style={styles.pillText}>{isRecording ? 'Recording' : 'Voice'}</Text>
              </BlurView>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.pillButton} 
            onPress={toggleFacing}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['rgba(0, 217, 255, 0.4)', 'rgba(107, 47, 181, 0.4)']}
              style={styles.pillGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={15} tint="dark" style={styles.pillInner}>
                <Text style={styles.pillIcon}>🔄</Text>
                <Text style={styles.pillText}>Flip</Text>
              </BlurView>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A0B2E' },
  hint: { color: '#fff', marginTop: 12, fontSize: 16, fontWeight: '500' },
  camera: { flex: 1 },
  
  // AR-Style Scanning Overlay
  scanningOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanLine: {
    position: 'absolute',
    width: '80%',
    height: 2,
    backgroundColor: '#00D9FF',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  cornerTL: {
    position: 'absolute',
    top: 100,
    left: 40,
    width: 40,
    height: 40,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#00D9FF',
  },
  cornerTR: {
    position: 'absolute',
    top: 100,
    right: 40,
    width: 40,
    height: 40,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: '#00D9FF',
  },
  cornerBL: {
    position: 'absolute',
    bottom: 200,
    left: 40,
    width: 40,
    height: 40,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#00D9FF',
  },
  cornerBR: {
    position: 'absolute',
    bottom: 200,
    right: 40,
    width: 40,
    height: 40,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: '#00D9FF',
  },
  
  // Top Bar
  topBar: { 
    position: 'absolute', 
    top: 50, 
    left: 16, 
    right: 16, 
    zIndex: 20, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  backButtonGlass: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  backButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backIcon: {
    fontSize: 20,
    color: '#fff',
    marginRight: 6,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  
  // Movement Indicator
  movementIndicator: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  movementGradient: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  movementActive: {
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  movementText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  
  // Debug Info
  debugInfo: {
    position: 'absolute',
    top: 110,
    left: 16,
    right: 16,
    padding: 10,
    borderRadius: 12,
  },
  debugText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  
  // Navigation Status Panel (Glassmorphic)
  navStatusWrapper: {
    position: 'absolute', 
    top: 150, 
    left: 16, 
    right: 16,
    borderRadius: 20,
    overflow: 'hidden',
  },
  navStatusGradient: {
    padding: 2,
    borderRadius: 20,
  },
  navStatus: { 
    padding: 20, 
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  navIconContainer: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  navIcon: {
    fontSize: 32,
  },
  navCommand: { 
    color: '#fff', 
    fontSize: 22, 
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  navDanger: {
    color: '#FF2D55',
    textShadowColor: '#FF2D55',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  navSafe: {
    color: '#00FF88',
    textShadowColor: '#00FF88',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  obstacleCount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  obstacleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFD60A',
    marginRight: 6,
  },
  navDetails: {
    color: '#E0E7FF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  navDetailsSmall: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
  
  // Bottom Controls
  controls: { 
    position: 'absolute', 
    bottom: 40, 
    width: '100%', 
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  
  // Auto-Scan Toggle
  toggleContainer: {
    marginBottom: 20,
    borderRadius: 30,
    overflow: 'hidden',
  },
  toggleGradient: {
    padding: 2,
    borderRadius: 30,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    position: 'relative',
  },
  toggleIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  toggleText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  activePulse: {
    position: 'absolute',
    right: 15,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00FF88',
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  
  // Circular FAB (Floating Action Button)
  fabContainer: {
    width: 100,
    height: 100,
    marginBottom: 20,
    position: 'relative',
  },
  fabGradient: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 15,
  },
  fabInner: {
    alignItems: 'center',
  },
  fabIcon: {
    fontSize: 36,
    marginBottom: 4,
  },
  fabText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  fabPulse: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: '#00D9FF',
    opacity: 0.4,
  },
  
  // Bottom Pill Buttons
  rowButtons: { 
    flexDirection: 'row', 
    width: '100%', 
    justifyContent: 'space-between',
    gap: 12,
  },
  pillButton: {
    flex: 1,
    borderRadius: 25,
    overflow: 'hidden',
  },
  pillGradient: {
    padding: 2,
    borderRadius: 25,
  },
  pillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  pillIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  pillText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});