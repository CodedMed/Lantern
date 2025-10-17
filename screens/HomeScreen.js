import React from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity,
  Image 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>🔦</Text>
        <Text style={styles.title}>Lantern</Text>
        <Text style={styles.subtitle}>Navigation Assistant</Text>
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        <Text style={styles.welcomeText}>
          Helping you navigate with confidence
        </Text>
        
        {/* Feature Cards */}
        <TouchableOpacity 
          style={styles.card}
          onPress={() => navigation.navigate('Camera')}
          accessibilityLabel="Start Camera Navigation"
          accessibilityHint="Opens camera to identify surroundings"
        >
          <Text style={styles.cardIcon}>📷</Text>
          <Text style={styles.cardTitle}>Start Navigation</Text>
          <Text style={styles.cardDescription}>
            Use camera to identify surroundings
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.card}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Settings"
          accessibilityHint="Adjust app preferences"
        >
          <Text style={styles.cardIcon}>⚙️</Text>
          <Text style={styles.cardTitle}>Settings</Text>
          <Text style={styles.cardDescription}>
            Adjust speech and accessibility options
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.card}
          onPress={() => navigation.navigate('Help')}
          accessibilityLabel="Help"
          accessibilityHint="Learn how to use Lantern"
        >
          <Text style={styles.cardIcon}>❓</Text>
          <Text style={styles.cardTitle}>Help & Tutorial</Text>
          <Text style={styles.cardDescription}>
            Learn how to use Lantern effectively
          </Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Tap any card to get started
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 30,
  },
  logo: {
    fontSize: 60,
    marginBottom: 10,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: '500',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  welcomeText: {
    fontSize: 20,
    color: '#cbd5e1',
    textAlign: 'center',
    marginBottom: 30,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 25,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#0f3460',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  cardIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 16,
    color: '#94a3b8',
    lineHeight: 22,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#64748b',
    fontStyle: 'italic',
  },
});
