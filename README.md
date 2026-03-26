# 🛡️ PhishArmor - AI-Powered Email Security

**PhishArmor** is an intelligent Chrome extension that provides real-time phishing detection and security analysis for your emails across Gmail, Outlook, and Yahoo Mail. Using advanced AI analysis and multiple security APIs, PhishArmor helps protect you from phishing attacks, malicious links, and suspicious senders.

![PhishArmor Logo](icons/logo-50x50.png)

## ✨ Features

### 🔍 **Real-Time Email Analysis**
- **AI-Powered Detection**: Advanced OpenAI integration for intelligent phishing pattern recognition
- **Multi-Layer Security**: Combines AI analysis with reputation databases and threat intelligence
- **Instant Results**: Security shields appear automatically when viewing emails

### 🛡️ **Security Indicators**
- **Visual Shield System**: Color-coded security levels (Green = Safe, Yellow = Caution, Red = Dangerous)
- **Detailed Reports**: Click shields for comprehensive security analysis
- **Risk Assessment**: Clear explanations of potential threats and recommendations

### 🌐 **Platform Support**
- **Gmail**: Full integration with Gmail interface
- **Outlook**: Support for Outlook.live.com and Outlook.office.com
- **Yahoo Mail**: Compatible with Yahoo Mail web interface

### 🔧 **Advanced Analysis**
- **Sender Reputation**: Domain reputation analysis using APIVoid
- **Link Scanning**: Google Web Risk API integration for malicious URL detection
- **Content Analysis**: AI-powered examination of email content and language patterns
- **Threat Intelligence**: Real-time threat data from multiple security sources

## 🚀 Installation

### For Users
1. Download the extension from the Chrome Web Store (coming soon)
2. Click "Add to Chrome" and grant necessary permissions
3. Configure your API keys in the extension options
4. Start browsing your emails safely!

### For Developers
1. Clone this repository:
   ```bash
   git clone https://github.com/ehernandez-odin/phisharmor-chrome-ext.git
   cd phish_armor
   ```

2. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the project directory

3. Configure API keys (see [Configuration](#configuration) section)

## ⚙️ Configuration

PhishArmor requires API keys for full functionality. Configure these in the extension options:

### Required APIs
1. **OpenAI API** - For AI-powered content analysis
   - Get your key at [OpenAI Platform](https://platform.openai.com/api-keys)
   - Required for phishing pattern detection

2. **Google Web Risk API** - For malicious URL detection
   - Set up at [Google Cloud Console](https://console.cloud.google.com/)
   - Enable the Web Risk API and generate credentials

3. **APIVoid** - For domain reputation analysis
   - Register at [APIVoid](https://www.apivoid.com/)
   - Get your API key from the dashboard

### Setup Steps
1. Right-click the PhishArmor extension icon
2. Select "Options"
3. Enter your API keys in the respective fields
4. Click "Save Settings"
5. Test the configuration using the built-in test buttons

## 📖 Usage

### Basic Usage
1. **Open any supported email client** (Gmail, Outlook, Yahoo Mail)
2. **View an email** - PhishArmor automatically analyzes it
3. **Check the security shield** that appears next to email actions
4. **Click the shield** for detailed security information

### Understanding Security Levels

| Shield Color | Risk Level | Description |
|-------------|------------|-------------|
| 🟢 **Green** | Safe | Email passed all security checks |
| 🟡 **Yellow** | Caution | Some suspicious elements detected |
| 🔴 **Red** | Dangerous | High risk of phishing or malware |
| ⚪ **Grey** | Error/Unknown | Analysis incomplete or failed |

### Security Report Details
Click any shield to view:
- **Risk assessment summary**
- **Sender reputation analysis**
- **Link safety verification**
- **Content analysis results**
- **AI-generated recommendations**

## 🏗️ Project Structure

```
phish_armor/
├── 📁 background/           # Service worker and API integrations
│   └── background.js        # Main background script (107KB)
├── 📁 content_scripts/      # Email page integration
│   ├── content.js          # Content script for email analysis (59KB)
│   └── content.css         # Styling for injected elements
├── 📁 popup/               # Extension popup interface
│   ├── popup.html          # Popup UI structure
│   ├── popup.css           # Popup styling
│   └── popup.js            # Popup functionality
├── 📁 options/             # Settings and configuration
│   ├── options.html        # Options page structure
│   ├── options.css         # Options page styling
│   └── options.js          # Options page functionality
├── 📁 icons/               # Extension icons and assets
│   ├── logo-50x50.png      # Main logo
│   ├── 16x16.png           # Browser icon (small)
│   ├── 32x32.png           # Browser icon (medium)
│   ├── 48x48.png           # Extension manager icon
│   ├── 128x128.png         # Store listing icon
│   ├── shield-green.png    # Safe indicator
│   ├── shield-yellow.png   # Caution indicator
│   ├── shield-red.png      # Danger indicator
│   └── shield-grey.png     # Error/unknown indicator
├── manifest.json           # Extension configuration
├── README.md              # This file
└── .cursorrules           # Development guidelines
```

## 🛠️ Development

### Prerequisites
- Chrome browser with Developer Mode enabled
- API keys for OpenAI, Google Web Risk, and APIVoid
- Basic knowledge of JavaScript and Chrome Extension APIs

### Architecture
PhishArmor follows Chrome Extension Manifest V3 architecture:

- **Background Script**: Handles API calls, data processing, and extension lifecycle
- **Content Scripts**: Inject security indicators into email pages
- **Popup**: Provides quick access to settings and status
- **Options Page**: Comprehensive configuration interface

### Key Components

#### Background Script (`background/background.js`)
- Service worker handling API integrations
- Email analysis orchestration
- Storage management
- Message passing coordination

#### Content Script (`content_scripts/content.js`)
- DOM manipulation for email pages
- Shield icon injection and positioning
- Dynamic tooltip generation
- Email content extraction

#### Security Analysis Pipeline
1. **Email Detection**: Content script identifies opened emails
2. **Data Extraction**: Sender, subject, and body content extraction
3. **Multi-API Analysis**: Parallel calls to OpenAI, Web Risk, and APIVoid
4. **Risk Assessment**: Weighted scoring algorithm
5. **UI Update**: Shield color and detailed report generation

### Testing

#### Console Testing Functions
PhishArmor includes built-in testing functions accessible from the browser console:

```javascript
// Test individual APIs
testPhishArmorWebRisk()         // Test Google Web Risk integration
testPhishArmorAPIVoid()         // Test APIVoid integration
testPhishArmorFocusedPrompt()   // Test OpenAI analysis
testPhishArmorRiskAssessment()  // Test risk scoring algorithm

// Diagnostic functions
diagnosePhishArmorWebRisk()     // Comprehensive Web Risk diagnostic
```

### Development Guidelines
- Follow the coding standards in `.cursorrules`
- Use TypeScript-style JSDoc comments
- Implement proper error handling
- Test across all supported email platforms
- Maintain security best practices

## 🔒 Security & Privacy

### Data Handling
- **Local Processing**: Email content is analyzed locally when possible
- **API Calls**: Only necessary data sent to external APIs
- **No Storage**: Email content is not permanently stored
- **Encryption**: API keys stored securely in Chrome's encrypted storage

### Permissions
PhishArmor requests minimal permissions:
- `storage`: For settings and temporary analysis cache
- `activeTab`: To analyze currently open email tabs
- `scripting`: To inject security indicators
- `alarms`: For scheduled cleanup tasks
- `contextMenus`: For right-click menu options

### Privacy Commitment
- No email content is logged or transmitted unnecessarily
- API keys are stored locally and encrypted
- No user data is sold or shared with third parties
- All analysis is performed for security purposes only

## 🤝 Contributing

We welcome contributions to PhishArmor! Here's how you can help:

### Getting Started
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes following our coding standards
4. Test thoroughly across all supported email platforms
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Contribution Areas
- 🐛 Bug fixes and stability improvements
- ✨ New security analysis features
- 🌐 Additional email platform support
- 🎨 UI/UX improvements
- 📚 Documentation enhancements
- 🧪 Test coverage expansion

### Code Standards
- Follow existing code style and structure
- Add JSDoc comments for all functions
- Include error handling for all API calls
- Test on Gmail, Outlook, and Yahoo Mail
- Ensure Manifest V3 compatibility

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Getting Help
- 📧 **Email**: support@phisharmor.com
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/ehernandez-odin/phisharmor-chrome-ext/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/ehernandez-odin/phisharmor-chrome-ext/discussions)
- 📖 **Documentation**: [Wiki](https://github.com/ehernandez-odin/phisharmor-chrome-ext/wiki)

### Troubleshooting
1. **Extension not working**: Check API key configuration in options
2. **Shields not appearing**: Ensure extension has necessary permissions
3. **Analysis errors**: Verify internet connection and API key validity
4. **Performance issues**: Check console for error messages

## 🚀 Roadmap

### Version 0.2.0 (Planned)
- [ ] Enhanced AI analysis with custom models
- [ ] Support for additional email platforms
- [ ] Bulk email analysis capabilities
- [ ] Advanced threat intelligence integration

### Version 0.3.0 (Future)
- [ ] Real-time threat feed updates
- [ ] Team/Enterprise features
- [ ] Advanced reporting and analytics
- [ ] Mobile app companion

## 🏆 Acknowledgments

- **OpenAI** for providing advanced AI capabilities
- **Google** for the Web Risk API
- **APIVoid** for domain reputation services
- **Chrome Extensions Team** for the excellent documentation
- **Security Research Community** for ongoing threat intelligence

---

**⚠️ Disclaimer**: PhishArmor is a security tool designed to assist users in identifying potential threats. While we strive for accuracy, no security tool is 100% foolproof. Always exercise caution with suspicious emails and verify important communications through alternative channels.

**🛡️ Stay Safe, Stay Protected with PhishArmor!** 