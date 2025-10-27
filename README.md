# Lantern 🔦

Computer-Vision surrounding identifying app, helping disabled through navigation.

## 🚀 Quick Start

### Prerequisites
- Node.js and npm installed
- Expo Go app on your phone ([iOS](https://apps.apple.com/app/expo-go/id982107779) | [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))
- Python 3.x (optional, for future ML features)

### Installation & Running

1. **Install dependencies**
   ```bash
   npm install --legacy-peer-deps
   ```

2. **Start the Expo development server**
   ```bash
   npx expo start
   ```

3. **Open on your device**
   - Scan the QR code with Expo Go (Android) or Camera app (iOS)
   
   **If on public WiFi:**
   ```bash
   npx expo start --tunnel
   ```
   
   **Alternative connection methods:**
   - LAN mode: `npx expo start --lan`
   - USB debugging: Connect phone via USB and press `a` (Android) or `i` (iOS)
   - Mobile hotspot: Connect laptop to phone's hotspot and run `npx expo start`

4. **Stop the server**
   - Press `Ctrl + C` in terminal

## 📱 Features

- **🏠 Home Screen**: Clean, accessible interface with large buttons
- **📷 Camera Navigation**: Use your phone's camera to identify surroundings
- **🔊 Text-to-Speech**: Verbal descriptions of detected objects
- **⚙️ Settings**: Customize speech rate, volume, and accessibility options
- **❓ Help**: Tutorial and tips for using the app
- **♿ Accessibility First**: Built with screen readers and accessibility in mind

## 🛠️ Tech Stack

- React Native with Expo
- React Navigation
- Expo Camera
- Expo Speech
- (Future: TensorFlow.js for object detection)

## 📂 Project Structure

```
Lantern/
├── screens/
│   ├── HomeScreen.js       # Main landing page
│   ├── CameraScreen.js     # Camera view for navigation
│   ├── SettingsScreen.js   # App settings
│   └── HelpScreen.js       # Tutorial and help
├── App.js                  # Navigation setup
├── app.json                # Expo configuration
├── package.json            # Dependencies
└── .gitignore             # Git ignore rules
```

## 🔧 Troubleshooting

### PowerShell script execution error?
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Tunnel connection timeout?
- Try LAN mode instead: `npx expo start --lan`
- Use USB debugging with your device
- Create a mobile hotspot from your phone

### Missing dependencies?
```bash
npx expo install expo-status-bar expo-camera expo-speech
```

### Camera permission issues?
- Make sure to allow camera access when prompted
- Check phone settings if denied

## 📝 Development Notes

### Python Virtual Environment (Optional)
If you're working on Python-based ML features:
```bash
# Activate venv
lanternenv\Scripts\activate

# Deactivate
deactivate
```

### Git Workflow
```bash
# Create a new feature branch
git checkout -b feature/your-feature

# Stage changes
git add .

# Commit
git commit -m "Description of changes"

# Push to GitHub
git push -u origin feature/your-feature
```

## 🎯 Roadmap

- [x] Basic navigation setup
- [x] Home screen with accessible UI
- [x] Camera integration
- [x] Speech synthesis
- [ ] Object detection with TensorFlow
- [ ] Obstacle warning system
- [ ] Text recognition (OCR)
- [ ] Indoor navigation
- [ ] Offline mode

## 🤝 Contributing

This is a project to help visually impaired users navigate their surroundings. Contributions are welcome!

## 📄 License

MIT License
