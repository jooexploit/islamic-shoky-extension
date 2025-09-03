# Changelog

All notable changes to **Islamic Shoky** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-09-03

### ✨ New Features

#### 🎵 Quran Audio Player

- **Audio Playback**: Added comprehensive Quran audio player functionality
- **Recitation Support**: Support for various renowned Quran reciters
- **Chapter Navigation**: Easy navigation through Quran chapters (Surahs)
- **Verse Control**: Play, pause, stop, and skip between verses
- **Audio Quality**: High-quality audio streaming for spiritual listening
- **Background Play**: Continue listening while coding

#### 🎨 UI Enhancements

- **Modern Interface**: Completely redesigned user interface for better user experience
- **Improved Navigation**: Enhanced sidebar navigation and panel organization
- **Visual Polish**: Better spacing, typography, and visual hierarchy
- **Responsive Design**: Optimized layouts for different screen sizes
- **Accessibility**: Improved accessibility features and keyboard navigation
- **Theme Integration**: Better integration with VS Code themes and colors

#### 📿 Extended Azkar & Duaa Collection

- **More Azkar**: Added extensive collection of authentic Islamic azkar
- **Daily Duaa**: Comprehensive daily duaa (supplications) collection
- **Morning/Evening Azkar**: Dedicated morning and evening remembrances
- **Prayer-specific Azkar**: Azkar for different prayer times
- **Special Occasions**: Azkar for special Islamic occasions and events
- **Audio Support**: Audio playback for proper pronunciation guidance

### 🔧 Bug Fixes & Improvements

- **Performance Optimization**: Improved extension loading and response times
- **Memory Management**: Better memory usage and cleanup
- **Error Handling**: Enhanced error handling and user feedback
- **API Reliability**: Improved reliability of prayer times and location services
- **Notification System**: Fixed notification timing and display issues
- **Data Persistence**: Improved local storage reliability and data integrity

### 🚀 Technical Improvements

- **Code Refactoring**: Cleaner, more maintainable codebase
- **State Management**: Improved application state handling
- **Event System**: Better event handling and component communication
- **Resource Loading**: Optimized resource loading and caching
- **Cross-platform**: Enhanced cross-platform compatibility

## [1.0.2] - 2025-09-01

### 🔧 Improvements

#### 📋 Tasks Panel Simplification

- **Simplified Tasks Panel**: Converted tasks panel in Explorer to read-only display for better reliability
- **Removed Task Manipulation**: Removed add, toggle, and delete functionality from Explorer tasks panel
- **Enhanced User Experience**: Tasks panel now shows a clean view of tasks with refresh capability
- **Improved Stability**: Eliminated synchronization issues by making Explorer tasks panel display-only
- **Cleaner Interface**: Removed context menus and inline buttons for a streamlined experience

#### 🚀 Explorer Integration

- **Pomodoro Timer Panel**: Added dedicated pomodoro timer panel in Explorer sidebar for easy access
- **Prayer Times Panel**: Added next prayer (azan) display panel in Explorer sidebar for quick reference
- **Quick Access Controls**: Timer controls (start, pause, stop, reset) directly available in Explorer
- **Location Management**: Prayer location settings accessible from Explorer panel
- **Seamless Workflow**: Access core features without switching between different views

### ✨ What's New

- **Explorer Panels**: Three new panels in Explorer - Timer, Next Prayer, and Tasks
- **Integrated Pomodoro**: Full pomodoro timer functionality in Explorer sidebar
- **Prayer at a Glance**: Next azan time always visible in Explorer
- **Read-Only Tasks Display**: View all your tasks directly in the Explorer panel
- **One-Click Refresh**: Simple refresh button to sync with main sidebar tasks
- **Better Visual Feedback**: Improved task status indicators (✅ Completed, ⏳ Pending)
- **Cleaner Empty State**: Better messaging when no tasks are available

## [1.0.0] - 2025-01-29

### 🎉 Initial Release

**Islamic Shoky** - A comprehensive Islamic productivity extension for VS Code!

### ✨ Added Features

#### 🕌 Prayer Times System

- **Accurate Prayer Calculations**: Integration with Aladhan API for precise prayer times
- **Multiple Calculation Methods**: Support for ISNA, Muslim World League, Umm Al-Qura, and Egyptian methods
- **Location Detection**: Automatic location detection with manual override option
- **Smart Notifications**: Prayer time notifications with Islamic reminders 5 minutes after each prayer
- **Real-time Updates**: Automatic prayer time updates based on user location

#### 📿 Daily Azkar (Islamic Remembrances)

- **Authentic Content**: Collection of authentic Islamic azkar in Arabic
- **Automatic Rotation**: Azkar change every 30 minutes (configurable)
- **Custom Azkar**: Add personal favorite azkar to the collection
- **Sound Notifications**: Special audio notifications for Prophet Muhammad's azkar (ﷺ)
- **Beautiful Display**: Proper Arabic text rendering with Islamic aesthetics

#### ⏱️ Pomodoro Timer

- **Focus Sessions**: 25-minute focused work sessions (configurable)
- **Break Management**: 5-minute breaks to maintain productivity
- **Visual Notifications**: Session completion notifications
- **Session Tracking**: Progress tracking for work sessions

#### ✅ Todo List Management

- **Task Creation**: Add, edit, and delete programming tasks
- **Priority System**: Organize tasks by importance
- **Progress Tracking**: Mark tasks as complete
- **Local Storage**: Persistent task storage using localStorage
- **Simple UI**: Clean, intuitive task management interface

#### 🎨 User Interface

- **Islamic Design**: Beautiful Islamic-inspired UI design
- **Theme Adaptation**: Automatic adaptation to VS Code light/dark themes
- **Responsive Layout**: Optimized for sidebar panel usage
- **Custom Branding**: Personalized logo and Islamic aesthetic
- **Accessibility**: Proper contrast and readable fonts

#### ⚙️ Configuration System

- **Extensive Settings**: 15+ configurable options
- **User Preferences**: Customize all aspects of the extension
- **VS Code Integration**: Native settings integration
- **Real-time Updates**: Settings changes apply immediately

### 🔧 Technical Features

#### Architecture

- **VS Code Extension API**: Built using official VS Code extension APIs
- **Webview Integration**: Modern webview-based UI
- **Event-driven**: Proper event handling and state management
- **Error Handling**: Comprehensive error handling and user feedback

#### Performance

- **Lightweight**: Minimal impact on VS Code performance
- **Efficient Updates**: Smart update mechanisms for prayer times and azkar
- **Memory Management**: Proper cleanup of timers and resources
- **Offline Support**: Graceful degradation when offline

#### Compatibility

- **Cross-platform**: Works on Windows, macOS, and Linux
- **VS Code Versions**: Compatible with VS Code 1.74.0+
- **Theme Support**: Works with all VS Code themes
- **Localization Ready**: Prepared for future localization

### 📚 Documentation

- **Comprehensive README**: Detailed installation and usage instructions
- **Configuration Guide**: Complete settings documentation
- **Contributing Guide**: Developer contribution guidelines
- **License**: MIT License for open source distribution

### 🧪 Quality Assurance

- **Unit Tests**: Basic test coverage with VS Code test framework
- **Linting**: ESLint configuration for code quality
- **Manual Testing**: Thorough manual testing of all features
- **User Feedback**: Beta testing and feedback incorporation

### 🔒 Security & Privacy

- **User Privacy**: Respectful handling of location data
- **Data Security**: Local storage only, no external data transmission
- **API Security**: Secure communication with Aladhan API
- **Content Verification**: All Islamic content verified for authenticity

---

## Types of Changes

- `🎉` Added - New features
- `✨` Changed - Changes in existing functionality
- `🔧` Fixed - Bug fixes
- `🗑️` Removed - Removed features
- `📚` Docs - Documentation updates
- `🔒` Security - Security-related changes

---

## Development

- **Repository**: [GitHub](https://github.com/jooexploit/islamic-shoky-extension)
- **Issues**: [Bug Reports](https://github.com/jooexploit/islamic-shoky-extension/issues)
- **Discussions**: [Feature Requests](https://github.com/jooexploit/islamic-shoky-extension/discussions)

---

_Islamic Shoky v1.0.0 - Bridging faith and productivity in your coding journey_ 🕌✨
