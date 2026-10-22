import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Speech from "expo-speech";
import { usePreferences } from "../utils/Preferences";
export default function SettingsScreen({ navigation }) {
  const { settings, update } = usePreferences();
  const text = { color: "#fff", fontSize: settings.largeText ? 21 : 17 };
  const toggle = (label, key) => (
    <View style={styles.row}>
      <Text style={text}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={settings[key]}
        onValueChange={(value) => update(key, value)}
      />
    </View>
  );
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: settings.contrast ? "#000" : "#102421" }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.goBack()}
        style={styles.button}
      >
        <Text style={text}>← Back</Text>
      </Pressable>
      <Text style={[text, { fontSize: 32, fontWeight: "600" }]}>Settings</Text>
      {toggle("Spoken descriptions", "speech")}
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() =>
          update(
            "rate",
            settings.rate < 0.8 ? 0.95 : settings.rate < 1.1 ? 1.25 : 0.7,
          )
        }
      >
        <Text style={text}>
          Speech speed: {settings.rate.toFixed(2)}× · Tap to change
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          Speech.stop();
          Speech.speak("Hello from Lantern. These are your speech settings.", {
            rate: settings.rate,
            language: "en-US",
          });
        }}
      >
        <Text style={text}>Test voice</Text>
      </Pressable>
      {toggle("High contrast in scanner", "contrast")}
      {toggle("Larger scanner text", "largeText")}
      <Text style={text}>
        Preferences save on this device. Lantern recognizes objects; it cannot
        establish a safe route or measure distance.
      </Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 28, paddingTop: 65, gap: 24 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
  },
  button: {
    padding: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#284c3c",
  },
});
