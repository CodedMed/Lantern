# Volume Button Integration Guide

## 🔊 Current Implementation

### ✅ What's Working Now

1. **Maximum Volume Speech** 
   - All speech output now at volume 1.0 (maximum)
   - Rate: 0.9 (slightly slower for clarity)
   - Pitch: 1.0 (normal)

2. **Double-Tap Activation**
   - Double-tap anywhere on the camera screen
   - Says "Start scanning" then triggers scan
   - 400ms window for double-tap detection

### 📱 How to Use

**Option 1: Screen Double-Tap**
1. Open Camera/Navigation screen
2. Double-tap anywhere on the camera view
3. Hear: "Start scanning"
4. App performs object detection

**Option 2: Scan Button**
1. Use the large circular FAB button at bottom
2. Same functionality

---

## 🎯 Adding Hardware Volume Button Support

React Native doesn't natively support volume button events. You'll need to install a third-party library.

### Recommended: `react-native-volume-control`

#### Step 1: Install

```bash
npm install react-native-volume-control
cd ios && pod install && cd ..
```

#### Step 2: Update CameraScreen.js

Add import:
```javascript
import VolumeControl from 'react-native-volume-control';
```

Replace the current double-tap useEffect with:
```javascript
// Volume button double-click detection
useEffect(() => {
  let listener;
  
  const setupVolumeButtons = () => {
    listener = VolumeControl.addEventListener((event) => {
      const now = Date.now();
      const timeSinceLastPress = now - lastVolumePress.current;
      
      // Reset if too much time passed
      if (timeSinceLastPress > 500) {
        volumeClickCount.current = 1;
      } else {
        volumeClickCount.current++;
      }
      
      lastVolumePress.current = now;
      
      // Double-click detected
      if (volumeClickCount.current === 2) {
        console.log('🔊 Volume button double-click!');
        speak('Start scanning');
        setTimeout(() => identifySurroundings(), 300);
        volumeClickCount.current = 0;
        
        // Reset volume to original
        VolumeControl.setVolume(event.volume);
      }
    });
    
    console.log('🔊 Volume button listener active');
  };
  
  setupVolumeButtons();
  
  return () => {
    if (listener) {
      listener.remove();
    }
  };
}, []);
```

#### Step 3: Optional - Hide Volume UI

To prevent the volume slider from showing:
```javascript
useEffect(() => {
  VolumeControl.showVolumeUI(false);
  return () => VolumeControl.showVolumeUI(true);
}, []);
```

---

## 🎛️ Alternative: `react-native-system-setting`

Another option with more features:

```bash
npm install react-native-system-setting
```

```javascript
import SystemSetting from 'react-native-system-setting';

useEffect(() => {
  const volumeListener = SystemSetting.addVolumeListener((data) => {
    const now = Date.now();
    const timeSinceLastPress = now - lastVolumePress.current;
    
    if (timeSinceLastPress < 500) {
      if (volumeClickCount.current === 1) {
        speak('Start scanning');
        identifySurroundings();
        volumeClickCount.current = 0;
      }
    } else {
      volumeClickCount.current = 1;
    }
    
    lastVolumePress.current = now;
  });

  return () => {
    SystemSetting.removeVolumeListener(volumeListener);
  };
}, []);
```

---

## 🔧 iOS Configuration

For iOS, add to `Info.plist`:
```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

---

## 🤖 Android Configuration

For Android, add to `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

---

## 🎯 Current Workaround (No Install Required)

Since volume buttons require native modules, we've implemented:

**Double-Tap Screen Detection**
- Tap camera view twice quickly (within 400ms)
- Triggers "Start scanning" + scan
- No additional packages needed
- Works immediately

### Usage:
1. Point camera at environment
2. Tap screen twice quickly
3. Hear "Start scanning"
4. Detection runs automatically

---

## 📊 Comparison

| Method | Pros | Cons | Setup Time |
|--------|------|------|------------|
| **Screen Double-Tap** | ✅ No install<br>✅ Works now<br>✅ Simple | ❌ Need to tap screen | 0 min |
| **Volume Buttons** | ✅ Hands-free<br>✅ Physical feedback<br>✅ Accessible | ❌ Requires native module<br>❌ Platform-specific | 10-15 min |
| **Scan Button** | ✅ Visual feedback<br>✅ Clear action | ❌ Need to find button | 0 min |

---

## 🚀 Quick Start (Current Setup)

### Test Maximum Volume:
1. Run app: `npm start`
2. Go to camera screen
3. Tap scan button
4. Listen - should be MUCH louder now

### Test Double-Tap:
1. Camera screen active
2. Tap screen twice quickly
3. Should hear "Start scanning"
4. Detection starts

### Verify Volume Settings:
- All speech now uses `volume: 1.0`
- Check device media volume is up
- TTS uses system media volume, not ringer

---

## 🎓 Speech Volume Troubleshooting

### If Still Too Quiet:

1. **Check Device Volume**
   ```javascript
   // Add this to help users check volume
   useEffect(() => {
     Audio.setAudioModeAsync({
       playsInSilentModeIOS: true,
       staysActiveInBackground: false,
       shouldDuckAndroid: false,
     });
   }, []);
   ```

2. **Increase System Volume**
   - iOS: Use volume buttons on device
   - Android: Media volume (not ringer)

3. **Test with Different Voice**
   ```javascript
   Speech.speak(text, {
     volume: 1.0,
     rate: 0.9,
     pitch: 1.2,  // Higher pitch = louder perceived
     voice: 'com.apple.ttsbundle.Samantha-compact', // iOS
   });
   ```

4. **Force Audio Category**
   ```javascript
   await Audio.setAudioModeAsync({
     playsInSilentModeIOS: true,
     allowsRecordingIOS: false,
     staysActiveInBackground: true,
     interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
     shouldDuckAndroid: false,
     interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
     playThroughEarpieceAndroid: false,
   });
   ```

---

## 🎉 Summary

### ✅ Implemented:
- Maximum volume (1.0) for all speech
- Double-tap screen to scan
- "Start scanning" announcement
- Optimized speech settings

### 🔜 Optional Upgrade:
- Install `react-native-volume-control`
- Add volume button listeners
- Hide volume UI during use

### 🎯 Current Status:
**FULLY FUNCTIONAL** - Double-tap works now, volume buttons optional upgrade!
