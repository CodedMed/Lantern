import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

export default function SettingsScreen({ navigation }) {
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
            colors={['#FF6B35', '#FF006E']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.titleGradient}
          >
            <Text style={styles.title}>Settings</Text>
          </LinearGradient>
          <Text style={styles.subtitle}>Customize your experience</Text>
        </View>

        <View style={styles.content}>
          {/* Speech Settings Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>🔊</Text>
              <Text style={styles.sectionTitle}>Speech Settings</Text>
            </View>
            
            <TouchableOpacity style={styles.settingWrapper} activeOpacity={0.8}>
              <LinearGradient
                colors={['rgba(107, 47, 181, 0.2)', 'rgba(59, 130, 246, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#6B2FB5', '#3B82F6']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>⚡</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>Speech Rate</Text>
                  </View>
                  <Text style={styles.settingValue}>Normal</Text>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingWrapper} activeOpacity={0.8}>
              <LinearGradient
                colors={['rgba(107, 47, 181, 0.2)', 'rgba(59, 130, 246, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#00D9FF', '#6B2FB5']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>🎙️</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>Voice</Text>
                  </View>
                  <Text style={styles.settingValue}>Default</Text>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingWrapper} activeOpacity={0.8}>
              <LinearGradient
                colors={['rgba(107, 47, 181, 0.2)', 'rgba(59, 130, 246, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#FF8E53', '#FF006E']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>🔉</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>Volume</Text>
                  </View>
                  <Text style={styles.settingValue}>100%</Text>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Accessibility Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>♿</Text>
              <Text style={styles.sectionTitle}>Accessibility</Text>
            </View>
            
            <TouchableOpacity style={styles.settingWrapper} activeOpacity={0.8}>
              <LinearGradient
                colors={['rgba(0, 217, 255, 0.2)', 'rgba(107, 47, 181, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#00D9FF', '#6B2FB5']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>◐</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>High Contrast Mode</Text>
                  </View>
                  <View style={styles.toggleSwitch}>
                    <View style={styles.toggleOff} />
                  </View>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingWrapper} activeOpacity={0.8}>
              <LinearGradient
                colors={['rgba(0, 217, 255, 0.2)', 'rgba(107, 47, 181, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#FF6B35', '#FF8E53']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>A</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>Large Text</Text>
                  </View>
                  <View style={styles.toggleSwitch}>
                    <View style={styles.toggleOff} />
                  </View>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingWrapper} activeOpacity={0.8}>
              <LinearGradient
                colors={['rgba(0, 255, 136, 0.2)', 'rgba(0, 217, 255, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#00FF88', '#00D9FF']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>📳</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>Haptic Feedback</Text>
                  </View>
                  <LinearGradient
                    colors={['#00FF88', '#00D9FF']}
                    style={styles.toggleOn}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <View style={styles.toggleKnob} />
                  </LinearGradient>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* About Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>ℹ️</Text>
              <Text style={styles.sectionTitle}>About</Text>
            </View>
            
            <View style={styles.settingWrapper}>
              <LinearGradient
                colors={['rgba(255, 107, 53, 0.2)', 'rgba(255, 0, 110, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#FF6B35', '#FF006E']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>🔢</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>Version</Text>
                  </View>
                  <Text style={styles.settingValue}>1.0.0</Text>
                </BlurView>
              </LinearGradient>
            </View>

            <View style={styles.settingWrapper}>
              <LinearGradient
                colors={['rgba(255, 107, 53, 0.2)', 'rgba(255, 0, 110, 0.2)']}
                style={styles.settingGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={15} tint="dark" style={styles.settingItem}>
                  <View style={styles.settingLeft}>
                    <LinearGradient
                      colors={['#FF8E53', '#FF006E']}
                      style={styles.settingIconCircle}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.settingIconText}>🔦</Text>
                    </LinearGradient>
                    <Text style={styles.settingText}>App Name</Text>
                  </View>
                  <Text style={styles.settingValue}>Lantern</Text>
                </BlurView>
              </LinearGradient>
            </View>
          </View>
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
    paddingBottom: 30,
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
    fontSize: 40,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 35,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#E0E7FF',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  settingWrapper: {
    marginBottom: 12,
    borderRadius: 18,
    overflow: 'hidden',
  },
  settingGradient: {
    padding: 2,
    borderRadius: 18,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(22, 33, 62, 0.4)',
    padding: 18,
    borderRadius: 16,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  settingIconText: {
    fontSize: 18,
  },
  settingText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  settingValue: {
    fontSize: 15,
    color: '#00D9FF',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  toggleSwitch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(100, 100, 100, 0.5)',
    justifyContent: 'center',
    padding: 2,
  },
  toggleOff: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#64748B',
    alignSelf: 'flex-start',
  },
  toggleOn: {
    width: 48,
    height: 28,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
});
