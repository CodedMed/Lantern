import React, { useRef, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity,
  Animated,
  Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';

const { width } = Dimensions.get('window');

export default function HomeScreen({ navigation }) {
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoGlow = useRef(new Animated.Value(0)).current;
  const cardSlide1 = useRef(new Animated.Value(50)).current;
  const cardSlide2 = useRef(new Animated.Value(50)).current;
  const cardSlide3 = useRef(new Animated.Value(50)).current;
  const cardOpacity1 = useRef(new Animated.Value(0)).current;
  const cardOpacity2 = useRef(new Animated.Value(0)).current;
  const cardOpacity3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animations
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.timing(cardSlide1, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacity1, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(350),
        Animated.parallel([
          Animated.timing(cardSlide2, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacity2, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(500),
        Animated.parallel([
          Animated.timing(cardSlide3, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacity3, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();

    // Pulsing glow animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlow, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(logoGlow, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const glowOpacity = logoGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Gradient Background */}
      <LinearGradient
        colors={['#1A0B2E', '#0F1C3F', '#1A0B2E']}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header with Animated Logo */}
        <View style={styles.header}>
          <Animated.View 
            style={[
              styles.logoContainer,
              { transform: [{ scale: logoScale }] }
            ]}
          >
            {/* Glow effect behind logo */}
            <Animated.View 
              style={[
                styles.logoGlow,
                { opacity: glowOpacity }
              ]}
            />
            <LinearGradient
              colors={['#FF6B35', '#FF8E53', '#FF006E']}
              style={styles.logoGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.logo}>🔦</Text>
            </LinearGradient>
          </Animated.View>
          
          <Text style={styles.title}>Lantern</Text>
          <LinearGradient
            colors={['#FF8E53', '#FF006E', '#6B2FB5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.subtitleGradient}
          >
            <Text style={styles.subtitle}>Your AI-Powered Guide</Text>
          </LinearGradient>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          <Text style={styles.welcomeText}>
            Navigate with confidence and clarity
          </Text>
          
          {/* Glassmorphic Feature Cards */}
          <Animated.View
            style={[
              styles.cardWrapper,
              { 
                opacity: cardOpacity1,
                transform: [{ translateY: cardSlide1 }]
              }
            ]}
          >
            <TouchableOpacity 
              style={styles.cardTouchable}
              onPress={() => navigation.navigate('Camera')}
              accessibilityLabel="Start Camera Navigation"
              accessibilityHint="Opens camera to identify surroundings"
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['rgba(255, 107, 53, 0.15)', 'rgba(255, 0, 110, 0.15)']}
                style={styles.cardGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={20} tint="dark" style={styles.card}>
                  <LinearGradient
                    colors={['#FF6B35', '#FF006E']}
                    style={styles.iconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.cardIcon}>📷</Text>
                  </LinearGradient>
                  <Text style={styles.cardTitle}>Start Navigation</Text>
                  <Text style={styles.cardDescription}>
                    Real-time AI object detection to guide your path
                  </Text>
                  <View style={styles.cardIndicator}>
                    <View style={styles.readyDot} />
                    <Text style={styles.readyText}>Ready</Text>
                  </View>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[
              styles.cardWrapper,
              { 
                opacity: cardOpacity2,
                transform: [{ translateY: cardSlide2 }]
              }
            ]}
          >
            <TouchableOpacity 
              style={styles.cardTouchable}
              onPress={() => navigation.navigate('Settings')}
              accessibilityLabel="Settings"
              accessibilityHint="Adjust app preferences"
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['rgba(107, 47, 181, 0.15)', 'rgba(59, 130, 246, 0.15)']}
                style={styles.cardGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={20} tint="dark" style={styles.card}>
                  <LinearGradient
                    colors={['#6B2FB5', '#3B82F6']}
                    style={styles.iconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.cardIcon}>⚙️</Text>
                  </LinearGradient>
                  <Text style={styles.cardTitle}>Settings</Text>
                  <Text style={styles.cardDescription}>
                    Customize speech, accessibility and preferences
                  </Text>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[
              styles.cardWrapper,
              { 
                opacity: cardOpacity3,
                transform: [{ translateY: cardSlide3 }]
              }
            ]}
          >
            <TouchableOpacity 
              style={styles.cardTouchable}
              onPress={() => navigation.navigate('Help')}
              accessibilityLabel="Help"
              accessibilityHint="Learn how to use Lantern"
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['rgba(0, 217, 255, 0.15)', 'rgba(107, 47, 181, 0.15)']}
                style={styles.cardGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <BlurView intensity={20} tint="dark" style={styles.card}>
                  <LinearGradient
                    colors={['#00D9FF', '#6B2FB5']}
                    style={styles.iconCircle}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.cardIcon}>❓</Text>
                  </LinearGradient>
                  <Text style={styles.cardTitle}>Help & Tutorial</Text>
                  <Text style={styles.cardDescription}>
                    Learn how to navigate effectively with Lantern
                  </Text>
                </BlurView>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerDivider} />
          <Text style={styles.footerText}>
            ✨ Tap any card to begin your journey
          </Text>
        </View>
      </SafeAreaView>
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
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 30,
  },
  logoContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  logoGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#FF6B35',
    top: -10,
    left: -10,
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 20,
  },
  logoGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF006E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 12,
  },
  logo: {
    fontSize: 60,
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 12,
    letterSpacing: 1,
    textShadowColor: 'rgba(255, 107, 53, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  subtitleGradient: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  subtitle: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  welcomeText: {
    fontSize: 18,
    color: '#E0E7FF',
    textAlign: 'center',
    marginBottom: 25,
    fontWeight: '500',
    lineHeight: 26,
  },
  cardWrapper: {
    marginBottom: 16,
  },
  cardTouchable: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  cardGradient: {
    borderRadius: 24,
    padding: 2,
  },
  card: {
    borderRadius: 22,
    padding: 24,
    backgroundColor: 'rgba(22, 33, 62, 0.6)',
    overflow: 'hidden',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  cardIcon: {
    fontSize: 32,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  cardDescription: {
    fontSize: 15,
    color: '#CBD5E1',
    lineHeight: 22,
    fontWeight: '400',
  },
  cardIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  readyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00FF88',
    marginRight: 8,
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  readyText: {
    fontSize: 13,
    color: '#00FF88',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footer: {
    padding: 20,
    paddingBottom: 30,
    alignItems: 'center',
  },
  footerDivider: {
    width: 60,
    height: 3,
    backgroundColor: 'rgba(255, 142, 83, 0.3)',
    borderRadius: 2,
    marginBottom: 12,
  },
  footerText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
});
