import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';

export default function HelpScreen({ navigation }) {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Help & Tutorial</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.helpSection}>
          <Text style={styles.stepNumber}>1</Text>
          <Text style={styles.helpTitle}>Start Navigation</Text>
          <Text style={styles.helpText}>
            Tap the "Start Navigation" button on the home screen to activate the camera.
          </Text>
        </View>

        <View style={styles.helpSection}>
          <Text style={styles.stepNumber}>2</Text>
          <Text style={styles.helpTitle}>Point Your Camera</Text>
          <Text style={styles.helpText}>
            Point your camera at objects, signs, or obstacles you want to identify. Hold your device steady for best results.
          </Text>
        </View>

        <View style={styles.helpSection}>
          <Text style={styles.stepNumber}>3</Text>
          <Text style={styles.helpTitle}>Tap to Identify</Text>
          <Text style={styles.helpText}>
            Tap the "Identify" button to analyze what's in front of you. The app will speak the results aloud.
          </Text>
        </View>

        <View style={styles.helpSection}>
          <Text style={styles.stepNumber}>4</Text>
          <Text style={styles.helpTitle}>Listen to Descriptions</Text>
          <Text style={styles.helpText}>
            Lantern will verbally describe your surroundings, including obstacles, signs, and directions.
          </Text>
        </View>

        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Tips</Text>
          <Text style={styles.tipText}>
            • Use in well-lit areas for better accuracy
          </Text>
          <Text style={styles.tipText}>
            • Hold your phone steady when identifying objects
          </Text>
          <Text style={styles.tipText}>
            • Adjust speech settings in Settings if needed
          </Text>
          <Text style={styles.tipText}>
            • Enable VoiceOver/TalkBack for full accessibility
          </Text>
        </View>

        <TouchableOpacity 
          style={styles.startButton}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.startButtonText}>Got it! Take me home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backButton: {
    marginBottom: 15,
  },
  backText: {
    fontSize: 18,
    color: '#3b82f6',
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  content: {
    padding: 20,
  },
  helpSection: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  stepNumber: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginBottom: 10,
  },
  helpTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  helpText: {
    fontSize: 16,
    color: '#94a3b8',
    lineHeight: 24,
  },
  tipsSection: {
    backgroundColor: '#0f3460',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
  },
  tipsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 15,
  },
  tipText: {
    fontSize: 16,
    color: '#cbd5e1',
    lineHeight: 28,
    marginBottom: 8,
  },
  startButton: {
    backgroundColor: '#3b82f6',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    marginVertical: 20,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
});
