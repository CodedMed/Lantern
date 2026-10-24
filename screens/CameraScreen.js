import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import detector from "../services/YOLODetector";
import { describeScene, SAFETY_NOTE } from "../utils/scene.mjs";
import { usePreferences } from "../utils/Preferences";

export default function CameraScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false),
    [modelReady, setModelReady] = useState(false);
  const [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false);
  const [scene, setScene] = useState(null),
    [error, setError] = useState("");
  const [facing, setFacing] = useState("back"),
    [retry, setRetry] = useState(0);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const camera = useRef(null),
    inFlight = useRef(false),
    mounted = useRef(true);
  const lastSpoken = useRef(""),
    lastSpokenAt = useRef(0),
    activeRef = useRef(false);
  const focused = useIsFocused();
  const { settings } = usePreferences();
  activeRef.current = focused && foreground;
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => {
      mounted.current = false;
      Speech.stop();
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!focused || !foreground) {
      setAuto(false);
      setReady(false);
      Speech.stop();
    }
  }, [focused, foreground]);
  useEffect(() => {
    if (!settings.speech) Speech.stop();
  }, [settings.speech]);
  useEffect(() => {
    if (!permission?.granted) return;
    let active = true;
    setError("");
    detector
      .loadModel()
      .then(() => {
        if (active) setModelReady(true);
      })
      .catch(() => {
        if (active)
          setError("Could not load COCO-SSD. Check your connection and retry.");
      });
    return () => {
      active = false;
    };
  }, [permission?.granted, retry]);
  useEffect(() => {
    if (!auto || busy || !modelReady || !ready || !focused || !foreground)
      return;
    const timer = setTimeout(scan, 1800);
    return () => clearTimeout(timer);
  }, [auto, busy, modelReady, ready, focused, foreground, scene]);
  function speak(text, automatic = false) {
    if (!settings.speech) return;
    if (
      automatic &&
      (text === lastSpoken.current || Date.now() - lastSpokenAt.current < 7000)
    )
      return;
    Speech.stop();
    Speech.speak(text, { language: "en-US", rate: settings.rate });
    lastSpoken.current = text;
    lastSpokenAt.current = Date.now();
  }
  async function scan() {
    if (inFlight.current || !ready || !modelReady || !camera.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let uri;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.7 });
      uri = photo.uri;
      const predictions = await detector.detect(uri, settings.threshold);
      if (!mounted.current || !activeRef.current) return;
      const next = describeScene(predictions);
      setScene(next);
      speak(next.speech, auto);
    } catch {
      if (mounted.current) {
        setError("Scan failed. Hold the camera steady and try again.");
        setAuto(false);
      }
    } finally {
      if (uri)
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const textStyle = { color: "#fff", fontSize: settings.largeText ? 21 : 16 };
  const button = (label, action, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={action}
      style={[styles.button, disabled && { opacity: 0.4 }]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
  if (!permission?.granted)
    return (
      <View style={styles.center}>
        <Text style={[textStyle, styles.title]}>A little more awareness.</Text>
        <Text style={textStyle}>
          Lantern needs camera access to recognize common objects. Microphone
          access is not needed.
        </Text>
        {button("Allow camera", requestPermission)}
        {permission?.canAskAgain === false && (
          <Text style={textStyle}>
            Enable camera access for Lantern in your device settings, then
            return here.
          </Text>
        )}
        {button("Back to home", () => navigation.goBack())}
        <Text style={textStyle}>{SAFETY_NOTE}</Text>
      </View>
    );
  return (
    <View
      style={[
        styles.container,
        settings.contrast && { backgroundColor: "#000" },
      ]}
    >
      {focused && foreground && (
        <CameraView
          ref={camera}
          style={styles.camera}
          facing={facing}
          onCameraReady={() => setReady(true)}
          onMountError={() =>
            setError(
              "Camera could not start. Close other camera apps and retry.",
            )
          }
        />
      )}
      <View style={styles.top}>
        {button("Back", () => navigation.goBack())}
        <Text style={textStyle}>COCO-SSD · on-device recognition</Text>
      </View>
      <View style={styles.panel}>
        <Text
          accessibilityLiveRegion="polite"
          style={[textStyle, styles.title]}
        >
          {scene?.message ||
            (modelReady
              ? "Point at a scene and tap Scan."
              : "Downloading recognition model…")}
        </Text>
        {(!modelReady || busy) && <ActivityIndicator color="#ffd48b" />}
        {!!error && (
          <Text
            accessibilityRole="alert"
            style={[textStyle, { color: "#ffd48b" }]}
          >
            {error}
          </Text>
        )}
        {!!error &&
          !modelReady &&
          button("Retry model download", () => setRetry((value) => value + 1))}
        {button(
          busy ? "Recognizing…" : "Scan scene",
          scan,
          !ready || !modelReady || busy || auto,
        )}
        {button(
          auto ? "Stop auto-scan" : "Start auto-scan",
          () => setAuto((value) => !value),
          !ready || !modelReady,
        )}
        <View style={styles.row}>
          {button(
            "Read again",
            () => speak(scene.speech),
            !scene || !settings.speech,
          )}
          {button(
            "Flip camera",
            () => {
              setReady(false);
              setScene(null);
              setAuto(false);
              setFacing((value) => (value === "back" ? "front" : "back"));
            },
            busy,
          )}
        </View>
        <Text style={[textStyle, { fontSize: settings.largeText ? 16 : 12 }]}>
          {SAFETY_NOTE}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#102421" },
  center: {
    flex: 1,
    justifyContent: "center",
    gap: 20,
    padding: 30,
    backgroundColor: "#102421",
  },
  camera: { flex: 1 },
  top: { position: "absolute", top: 55, left: 18, right: 18, gap: 10 },
  panel: {
    padding: 20,
    paddingBottom: 35,
    gap: 12,
    backgroundColor: "#102421",
  },
  title: { fontWeight: "600" },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  button: {
    padding: 15,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#284c3c",
    alignItems: "center",
  },
});
