// Metro configuration for React Native with TensorFlow.js support
// https://facebook.github.io/metro/docs/configuration

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for TensorFlow model files
config.resolver.assetExts.push(
  // TensorFlow model files
  'bin',
  'tflite',
  // Additional asset types
  'pb',
  'txt'
);

module.exports = config;
