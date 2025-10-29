import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

export default function HelpScreen({ navigation }) {
  return (
    <View style={styles.container}>
      {/* Gradient Background */}
      <LinearGradient
        colors={['#1A0B2E', '#0F1C3F', '#1A0B2E']}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButtonContainer}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={['rgba(255, 107, 53, 0.3)', 'rgba(255, 0, 110, 0.3)']}
              style={styles.backButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.backIcon}>←</Text>
              <Text style={styles.backText}>Back</Text>
            </LinearGradient>
          </TouchableOpacity>
          
          <LinearGradient
            colors={['#00D9FF', '#6B2FB5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.titleGradient}
          >
            <Text style={styles.title}>Help & Tutorial</Text>
          </LinearGradient>
          <Text style={styles.subtitle}>Master Lantern in 4 easy steps</Text>
        </View>

        <View style={styles.content}>
          {/* Progress Indicator */}
          <View style={styles.progressContainer}>
            <View style={styles.progressDot} />
            <View style={styles.progressLine} />
            <View style={styles.progressDot} />
            <View style={styles.progressLine} />
            <View style={styles.progressDot} />
            <View style={styles.progressLine} />
            <View style={styles.progressDot} />
          </View>

          {/* Step 1 */}
          <View style={styles.stepWrapper}>
            <LinearGradient
              colors={['rgba(255, 107, 53, 0.25)', 'rgba(255, 0, 110, 0.25)']}
              style={styles.stepGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={20} tint="dark" style={styles.helpSection}>
                <LinearGradient
                  colors={['#FF6B35', '#FF006E']}
                  style={styles.stepNumberCircle}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.stepNumber}>1</Text>
                </LinearGradient>
                <View style={styles.stepContent}>
                  <Text style={styles.helpTitle}>Start Navigation</Text>
                  <Text style={styles.helpText}>
                    Tap the "Start Navigation" button on the home screen to activate the camera and begin your journey.
                  </Text>
                  <Text style={styles.helpIcon}>📱 ➜ 📷</Text>
                </View>
              </BlurView>
            </LinearGradient>
          </View>

          {/* Step 2 */}
          <View style={styles.stepWrapper}>
            <LinearGradient
              colors={['rgba(107, 47, 181, 0.25)', 'rgba(59, 130, 246, 0.25)']}
              style={styles.stepGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={20} tint="dark" style={styles.helpSection}>
                <LinearGradient
                  colors={['#6B2FB5', '#3B82F6']}
                  style={styles.stepNumberCircle}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.stepNumber}>2</Text>
                </LinearGradient>
                <View style={styles.stepContent}>
                  <Text style={styles.helpTitle}>Point Your Camera</Text>
                  <Text style={styles.helpText}>
                    Aim your camera at objects, signs, or obstacles around you. Hold steady for the best AI detection results.
                  </Text>
                  <Text style={styles.helpIcon}>🎯 ➜ 🔍</Text>
                </View>
              </BlurView>
            </LinearGradient>
          </View>

          {/* Step 3 */}
          <View style={styles.stepWrapper}>
            <LinearGradient
              colors={['rgba(0, 217, 255, 0.25)', 'rgba(107, 47, 181, 0.25)']}
              style={styles.stepGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={20} tint="dark" style={styles.helpSection}>
                <LinearGradient
                  colors={['#00D9FF', '#6B2FB5']}
                  style={styles.stepNumberCircle}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.stepNumber}>3</Text>
                </LinearGradient>
                <View style={styles.stepContent}>
                  <Text style={styles.helpTitle}>Tap to Scan</Text>
                  <Text style={styles.helpText}>
                    Press the large circular scan button to analyze your surroundings. Enable Auto-Scan for continuous detection while moving.
                  </Text>
                  <Text style={styles.helpIcon}>👆 ➜ 📡</Text>
                </View>
              </BlurView>
            </LinearGradient>
          </View>

          {/* Step 4 */}
          <View style={styles.stepWrapper}>
            <LinearGradient
              colors={['rgba(0, 255, 136, 0.25)', 'rgba(0, 217, 255, 0.25)']}
              style={styles.stepGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={20} tint="dark" style={styles.helpSection}>
                <LinearGradient
                  colors={['#00FF88', '#00D9FF']}
                  style={styles.stepNumberCircle}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.stepNumber}>4</Text>
                </LinearGradient>
                <View style={styles.stepContent}>
                  <Text style={styles.helpTitle}>Listen & Navigate</Text>
                  <Text style={styles.helpText}>
                    Lantern will speak detailed descriptions of your surroundings, including obstacles, distances, and safe paths forward.
                  </Text>
                  <Text style={styles.helpIcon}>🔊 ➜ 🚶</Text>
                </View>
              </BlurView>
            </LinearGradient>
          </View>

          {/* Tips Section */}
          <View style={styles.tipsWrapper}>
            <LinearGradient
              colors={['rgba(255, 215, 0, 0.3)', 'rgba(255, 159, 28, 0.3)']}
              style={styles.tipsGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <BlurView intensity={25} tint="dark" style={styles.tipsSection}>
                <View style={styles.tipsHeader}>
                  <Text style={styles.tipsEmoji}>💡</Text>
                  <Text style={styles.tipsTitle}>Pro Tips</Text>
                </View>
                
                <View style={styles.tipRow}>
                  <LinearGradient
                    colors={['#FFD60A', '#FF9F1C']}
                    style={styles.tipIconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.tipIconText}>☀️</Text>
                  </LinearGradient>
                  <Text style={styles.tipText}>
                    Use in well-lit areas for better accuracy
                  </Text>
                </View>

                <View style={styles.tipRow}>
                  <LinearGradient
                    colors={['#00D9FF', '#6B2FB5']}
                    style={styles.tipIconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.tipIconText}>📱</Text>
                  </LinearGradient>
                  <Text style={styles.tipText}>
                    Hold your phone steady when scanning
                  </Text>
                </View>

                <View style={styles.tipRow}>
                  <LinearGradient
                    colors={['#FF6B35', '#FF006E']}
                    style={styles.tipIconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.tipIconText}>⚙️</Text>
                  </LinearGradient>
                  <Text style={styles.tipText}>
                    Adjust speech settings in Settings if needed
                  </Text>
                </View>

                <View style={styles.tipRow}>
                  <LinearGradient
                    colors={['#00FF88', '#00D9FF']}
                    style={styles.tipIconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.tipIconText}>♿</Text>
                  </LinearGradient>
                  <Text style={styles.tipText}>
                    Enable VoiceOver/TalkBack for full accessibility
                  </Text>
                </View>
              </BlurView>
            </LinearGradient>
          </View>

          {/* CTA Button */}
          <TouchableOpacity 
            style={styles.startButtonContainer}
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#FF6B35', '#FF006E', '#6B2FB5']}
              style={styles.startButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.startButtonIcon}>✨</Text>
              <Text style={styles.startButtonText}>Got it! Take me home</Text>
              <Text style={styles.startButtonIcon}>🏠</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  backgroundGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 25,
  },
  backButtonContainer: {
    marginBottom: 20,
    alignSelf: 'flex-start',
    borderRadius: 20,
    overflow: 'hidden',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  backIcon: {
    fontSize: 20,
    color: '#fff',
    marginRight: 6,
  },
  backText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
  },
  titleGradient: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00D9FF',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  progressLine: {
    width: 40,
    height: 2,
    backgroundColor: 'rgba(0, 217, 255, 0.3)',
  },
  stepWrapper: {
    marginBottom: 18,
    borderRadius: 22,
    overflow: 'hidden',
  },
  stepGradient: {
    padding: 2,
    borderRadius: 22,
  },
  helpSection: {
    backgroundColor: 'rgba(22, 33, 62, 0.4)',
    borderRadius: 20,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumberCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  stepNumber: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  stepContent: {
    flex: 1,
  },
  helpTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  helpText: {
    fontSize: 15,
    color: '#CBD5E1',
    lineHeight: 22,
    marginBottom: 10,
  },
  helpIcon: {
    fontSize: 20,
    marginTop: 4,
  },
  tipsWrapper: {
    marginTop: 10,
    marginBottom: 25,
    borderRadius: 22,
    overflow: 'hidden',
  },
  tipsGradient: {
    padding: 2,
    borderRadius: 22,
  },
  tipsSection: {
    backgroundColor: 'rgba(22, 33, 62, 0.5)',
    borderRadius: 20,
    padding: 24,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  tipsEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  tipsTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFD60A',
    letterSpacing: 0.5,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  tipIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  tipIconText: {
    fontSize: 16,
  },
  tipText: {
    fontSize: 15,
    color: '#E0E7FF',
    lineHeight: 22,
    flex: 1,
    fontWeight: '500',
  },
  startButtonContainer: {
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#FF006E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 32,
    borderRadius: 28,
  },
  startButtonIcon: {
    fontSize: 22,
    marginHorizontal: 10,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
