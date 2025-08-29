// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Sidebar Provider Class
 */
class SidebarProvider {
  constructor(context) {
    this._context = context;
    this._currentNotification = null; // Track current notification
    this._soundProcess = null; // Track current sound process
    this._prayerTimeouts = new Map(); // Track prayer notification timeouts
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            // Show the alert notification
            vscode.window.showInformationMessage(message.text);
            // Auto-dismiss after 10 seconds
            setTimeout(() => {
              vscode.window.showInformationMessage(
                "ℹ️ Alert notification ended"
              );
            }, 10000); // 10 seconds
            break;
          case "requestLocation":
            this._handleLocationRequest(webviewView);
            break;
          case "setLocation":
            this._setLocationManually(webviewView);
            break;
          case "openSettings":
            this._openSettings();
            break;
          case "azkarChanged":
            this._handleAzkarChanged(message.azkar);
            break;
          case "prayerTimesFetched":
            this._schedulePrayerNotifications(message.prayerTimes);
            break;
        }
      },
      undefined,
      this._context.subscriptions
    );

    // Clean up when webview is disposed
    webviewView.onDidDispose(() => {
      // Send message to webview to clear its intervals
      webviewView.webview.postMessage({
        command: "cleanup",
      });
    });

    // Track visibility changes
    webviewView.onDidChangeVisibility(() => {
      const isVisible = webviewView.visible;
      webviewView.webview.postMessage({
        command: "panelVisibilityChanged",
        visible: isVisible,
      });
    });

    // Send initial visibility state
    webviewView.webview.postMessage({
      command: "panelVisibilityChanged",
      visible: webviewView.visible,
    });
  }

  async _handleLocationRequest(webviewView) {
    const choice = await vscode.window.showInformationMessage(
      "Islamic Shoky would like to detect your location for accurate prayer times. How would you like to proceed?",
      "Auto-detect Location",
      "Enter Location Manually",
      "Cancel"
    );

    if (choice === "Auto-detect Location") {
      webviewView.webview.postMessage({
        command: "enableIPLocation",
      });
    } else if (choice === "Enter Location Manually") {
      this._setLocationManually(webviewView);
    }
  }

  async _setLocationManually(webviewView) {
    const city = await vscode.window.showInputBox({
      prompt: "Enter your city name (e.g., Cairo, New York, London, Dubai)",
      placeHolder: "City name (try with country if not found: Cairo, Egypt)",
      value: "",
    });

    if (city) {
      webviewView.webview.postMessage({
        command: "setManualLocation",
        city: city,
      });
    }
  }

  _openSettings() {
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "islamic-shoky"
    );
  }

  _playAzkarSound(azkarText) {
    // Play sound for Prophet Muhammad's azkar using Node.js
    console.log("_playAzkarSound called with:", azkarText);
    if (
      azkarText.includes("اللهم صل وسلم على نبينا محمد") &&
      this._config.enableAzkarSound
    ) {
      console.log("Playing sound for Prophet Muhammad azkar using Node.js");

      // Stop any existing sound
      this._stopCurrentSound();

      const delay = this._config.azkarSoundDelay * 1000; // Convert to milliseconds

      setTimeout(() => {
        try {
          this._playSoundWithNodeJS();
        } catch (error) {
          console.log("Could not play azkar sound:", error);
        }
      }, delay);
    } else {
      console.log(
        "Sound not triggered - either not Prophet azkar or sound disabled"
      );
    }
  }

  _playSoundWithNodeJS() {
    try {
      // Get the sound file path
      const soundFilePath = path.join(
        this._context.extensionPath,
        "sounds",
        "salah-notification.mp3"
      );
      console.log("Sound file path:", soundFilePath);

      // Try different approaches to play sound based on OS
      const platform = process.platform;

      if (platform === "win32") {
        // Windows
        this._soundProcess = spawn("powershell", [
          "-c",
          `(New-Object Media.SoundPlayer "${soundFilePath}").PlaySync();`,
        ]);
      } else if (platform === "darwin") {
        // macOS
        this._soundProcess = spawn("afplay", [soundFilePath]);
      } else {
        // Linux/Unix
        // Try different audio players in order of preference
        const audioPlayers = ["mpg123", "mpg321", "play", "aplay", "sox"];

        for (const player of audioPlayers) {
          try {
            if (player === "play") {
              // sox play command
              this._soundProcess = spawn("play", [soundFilePath]);
            } else if (player === "aplay") {
              // ALSA player
              this._soundProcess = spawn("aplay", [soundFilePath]);
            } else {
              // mpg123 or mpg321
              this._soundProcess = spawn(player, ["-q", soundFilePath]);
            }
            break;
          } catch (error) {
            // Continue to next player - error logged above
            continue;
          }
        }
      }

      if (this._soundProcess) {
        console.log("Sound process started");

        // Handle process completion
        this._soundProcess.on("close", (code) => {
          console.log("Sound process finished with code:", code);
          this._soundProcess = null;
          this._hideCurrentNotification();
        });

        this._soundProcess.on("error", (error) => {
          console.log("Sound process error:", error);
          this._soundProcess = null;
          this._hideCurrentNotification();
        });

        // Show notification that will be hidden when sound finishes
        this._showSoundNotification();
      } else {
        console.log("No suitable audio player found");
      }
    } catch (error) {
      console.log("Error playing sound with Node.js:", error);
    }
  }

  _showSoundNotification() {
    // Hide any existing notification first
    this._hideCurrentNotification();

    // Show new notification
    this._currentNotification = vscode.window
      .showInformationMessage(
        `🔊 Playing sound for: اللهم صل وسلم على نبينا محمد`,
        "Stop Sound"
      )
      .then((selection) => {
        if (selection === "Stop Sound") {
          this._stopCurrentSound();
        }
        this._currentNotification = null;
      });
  }

  _hideCurrentNotification() {
    if (this._currentNotification) {
      // We can't directly hide notifications, but we can show a new one to replace it
      vscode.window.showInformationMessage("🔊 Sound finished playing");
      this._currentNotification = null;
    }
  }

  _stopCurrentSound() {
    if (this._soundProcess) {
      console.log("Stopping current sound process");
      this._soundProcess.kill();
      this._soundProcess = null;
      this._hideCurrentNotification();
    }
  }

  _handleAzkarChanged(azkar) {
    const config = this._getConfiguration();
    if (config.enableAzkarNotifications) {
      // Show the azkar notification
      const notification = vscode.window.showInformationMessage(
        `📿 ${azkar.arabic}`,
        "View in Panel"
      );

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        // Since we can't directly dismiss VS Code notifications,
        // we'll show a subtle "notification ended" message to replace it
        vscode.window.showInformationMessage("📿 Azkar notification ended");
      }, 10000); // 10 seconds

      // Handle user interaction
      notification.then((selection) => {
        if (selection === "View in Panel") {
          vscode.commands.executeCommand(
            "workbench.view.extension.islamic-shoky-sidebar"
          );
        }
      });
    }
    // Play sound for Prophet Muhammad's azkar
    this._playAzkarSound(azkar.arabic);
  }

  refresh() {
    // Refresh the webview when configuration changes
    if (this._view) {
      // Send preserve state command before refreshing
      this._view.webview.postMessage({
        command: "preserveState",
      });

      this._view.webview.html = this._getHtmlForWebview();

      // Send updated configuration to the webview
      const config = this._getConfiguration();
      this._view.webview.postMessage({
        command: "configUpdated",
        config: config,
      });
    }
  }

  _getConfiguration() {
    const config = vscode.workspace.getConfiguration("islamic-shoky");
    return {
      enablePrayerTimes: config.get("enablePrayerTimes", true),
      enableAzkar: config.get("enableAzkar", true),
      enablePomodoro: config.get("enablePomodoro", true),
      enableTodoList: config.get("enableTodoList", true),
      focusDuration: config.get("focusDuration", 25),
      breakDuration: config.get("breakDuration", 5),
      prayerCalculationMethod: config.get("prayerCalculationMethod", "2"),
      enableNotifications: config.get("enableNotifications", true),
      customAzkar: config.get("customAzkar", []),
      azkarChangeDelay: config.get("azkarChangeDelay", 30),
      enableAzkarNotifications: config.get("enableAzkarNotifications", true),
      enableAzkarSound: config.get("enableAzkarSound", true),
      azkarSoundDelay: config.get("azkarSoundDelay", 2),
      enablePrayerNotifications: config.get("enablePrayerNotifications", true),
      prayerReminderDelay: config.get("prayerReminderDelay", 5),
    };
  }

  refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview();
    }
  }

  _getHtmlForWebview() {
    const config = this._getConfiguration();
    return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Islamic Shoky Panel</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					font-weight: var(--vscode-font-weight);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					margin: 0;
					padding: 15px;
					line-height: 1.6;
				}
				
				.header {
					text-align: center;
					margin-bottom: 25px;
					padding: 15px 0;
					border-bottom: 2px solid var(--vscode-panel-border);
					position: relative;
				}
				
				.settings-button {
					position: absolute;
					top: 10px;
					right: 10px;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 6px 10px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.8em;
					transition: background-color 0.3s ease;
				}
				
				.settings-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				.logo {
					width: 88px;
					height: 88px;
					margin-bottom: 8px;
					border-radius: 8px;
					object-fit: contain;
				}
				
				.title {
					font-size: 1.3em;
					font-weight: bold;
					color: var(--vscode-editor-foreground);
					margin: 5px 0;
				}
				
				.section {
					margin: 20px 0;
					padding: 15px;
					border: 1px solid var(--vscode-panel-border);
					border-radius: 8px;
					background-color: var(--vscode-sideBar-background);
				}
				
				.section-title {
					font-size: 1.1em;
					font-weight: bold;
					color: var(--vscode-textLink-foreground);
					margin-bottom: 15px;
					display: flex;
					align-items: center;
					gap: 8px;
				}
				
				/* Azan Section */
				.azan-info {
					text-align: center;
				}
				
				.next-azan {
					font-size: 1.4em;
					font-weight: bold;
					color: var(--vscode-textLink-activeForeground);
					margin: 10px 0;
				}
				
				.azan-time {
					font-size: 1.8em;
					font-weight: bold;
					color: var(--vscode-terminal-ansiGreen);
					margin: 10px 0;
					padding: 10px;
					background-color: var(--vscode-textBlockQuote-background);
					border-radius: 6px;
				}
				
				.time-remaining {
					font-size: 0.9em;
					color: var(--vscode-descriptionForeground);
					margin-top: 8px;
				}
				
				.prayer-times {
					margin-top: 15px;
					font-size: 0.85em;
				}
				
				.prayer-time {
					display: flex;
					justify-content: space-between;
					margin: 5px 0;
					padding: 3px 0;
				}
				
				.prayer-name {
					font-weight: bold;
				}
				
				.location-status {
					margin-bottom: 15px;
					padding: 10px;
					background-color: var(--vscode-textBlockQuote-background);
					border-radius: 6px;
					display: flex;
					justify-content: space-between;
					align-items: center;
					flex-wrap: wrap;
					gap: 8px;
				}
				
				.location-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 6px 12px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.85em;
					transition: background-color 0.3s ease;
				}
				
				.location-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				.loading {
					text-align: center;
					color: var(--vscode-textLink-foreground);
					font-style: italic;
					margin: 20px 0;
				}
				
				.error-message {
					text-align: center;
					color: var(--vscode-errorForeground);
					margin: 20px 0;
					padding: 10px;
					background-color: var(--vscode-inputValidation-errorBackground);
					border: 1px solid var(--vscode-inputValidation-errorBorder);
					border-radius: 4px;
				}
				
				/* Azkar Section */
				.azkar-content {
					text-align: center;
					min-height: 80px;
				}
				
				.azkar-text {
					font-size: 1.1em;
					color: var(--vscode-editor-foreground);
					margin: 15px 0;
					padding: 15px;
					background-color: var(--vscode-textBlockQuote-background);
					border-left: 4px solid var(--vscode-textLink-foreground);
					border-radius: 4px;
					font-style: italic;
					line-height: 1.5;
				}
				
				.refresh-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 8px 16px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.9em;
					margin-top: 10px;
					transition: background-color 0.3s ease;
				}
				
				.refresh-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				/* Pomodoro Section */
				.pomodoro-container {
					text-align: center;
				}
				
				.timer-display {
					font-size: 2.5em;
					font-weight: bold;
					color: var(--vscode-terminal-ansiRed);
					margin: 15px 0;
					font-family: 'Courier New', monospace;
				}
				
				.timer-display.break {
					color: var(--vscode-terminal-ansiGreen);
				}
				
				.timer-status {
					font-size: 1em;
					color: var(--vscode-textLink-foreground);
					margin: 10px 0;
					font-weight: bold;
				}
				
				.timer-controls {
					display: flex;
					gap: 10px;
					justify-content: center;
					margin: 15px 0;
				}
				
				.timer-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 8px 12px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.9em;
					min-width: 60px;
					transition: background-color 0.3s ease;
				}
				
				.timer-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				.timer-button.active {
					background-color: var(--vscode-textLink-activeForeground);
				}
				
				.progress-bar {
					width: 100%;
					height: 8px;
					background-color: var(--vscode-panel-border);
					border-radius: 4px;
					overflow: hidden;
					margin: 15px 0;
				}
				
				.progress-fill {
					height: 100%;
					background-color: var(--vscode-terminal-ansiGreen);
					width: 0%;
					transition: width 0.5s ease;
				}
				
				.progress-fill.break {
					background-color: var(--vscode-terminal-ansiBlue);
				}
				
				.footer {
					margin-top: 25px;
					padding-top: 15px;
					border-top: 1px solid var(--vscode-panel-border);
					text-align: center;
					font-size: 0.8em;
					color: var(--vscode-descriptionForeground);
				}
				
				/* Todo List Section */
				.todo-container {
					display: flex;
					flex-direction: column;
					gap: 15px;
				}
				
				.todo-input-group {
					display: flex;
					gap: 10px;
					align-items: center;
				}
				
				.todo-input {
					flex: 1;
					padding: 8px 12px;
					border: 1px solid var(--vscode-input-border);
					border-radius: 4px;
					background-color: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					font-size: 0.9em;
				}
				
				.todo-input:focus {
					outline: none;
					border-color: var(--vscode-focusBorder);
				}
				
				.todo-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 8px 16px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.9em;
					transition: background-color 0.3s ease;
				}
				
				.todo-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				.todo-filters {
					display: flex;
					gap: 8px;
					flex-wrap: wrap;
					align-items: center;
				}
				
				.filter-button {
					background-color: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
					border: 1px solid var(--vscode-button-border);
					padding: 6px 12px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.8em;
					transition: all 0.3s ease;
				}
				
				.filter-button:hover {
					background-color: var(--vscode-button-secondaryHoverBackground);
				}
				
				.filter-button.active {
					background-color: var(--vscode-textLink-foreground);
					color: var(--vscode-button-foreground);
					border-color: var(--vscode-textLink-foreground);
				}
				
				.clear-button {
					background-color: var(--vscode-errorForeground);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 6px 12px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 0.8em;
					margin-left: auto;
					transition: background-color 0.3s ease;
				}
				
				.clear-button:hover {
					background-color: var(--vscode-inputValidation-errorBackground);
				}
				
				.todo-list {
					display: flex;
					flex-direction: column;
					gap: 8px;
					max-height: 300px;
					overflow-y: auto;
				}
				
				.todo-item {
					display: flex;
					align-items: center;
					gap: 10px;
					padding: 10px;
					background-color: var(--vscode-textBlockQuote-background);
					border-radius: 4px;
					border: 1px solid var(--vscode-panel-border);
					transition: all 0.3s ease;
				}
				
				.todo-item:hover {
					background-color: var(--vscode-list-hoverBackground);
				}
				
				.todo-item.completed {
					opacity: 0.6;
					background-color: var(--vscode-textBlockQuote-border);
				}
				
				.todo-item.completed .todo-text {
					text-decoration: line-through;
					color: var(--vscode-descriptionForeground);
				}
				
				.todo-checkbox {
					width: 16px;
					height: 16px;
					cursor: pointer;
					border: 2px solid var(--vscode-panel-border);
					border-radius: 3px;
					background-color: var(--vscode-editor-background);
					transition: all 0.3s ease;
				}
				
				.todo-checkbox:checked {
					background-color: var(--vscode-textLink-foreground);
					border-color: var(--vscode-textLink-foreground);
				}
				
				.todo-text {
					flex: 1;
					font-size: 0.9em;
					color: var(--vscode-editor-foreground);
					word-wrap: break-word;
				}
				
				.todo-actions {
					display: flex;
					gap: 5px;
				}
				
				.todo-edit-btn, .todo-delete-btn {
					background: none;
					border: none;
					cursor: pointer;
					padding: 4px;
					border-radius: 3px;
					font-size: 0.8em;
					transition: background-color 0.3s ease;
				}
				
				.todo-edit-btn:hover {
					background-color: var(--vscode-toolbar-hoverBackground);
				}
				
				.todo-delete-btn:hover {
					background-color: var(--vscode-inputValidation-errorBackground);
				}
				
				.todo-edit-input {
					flex: 1;
					padding: 4px 8px;
					border: 1px solid var(--vscode-input-border);
					border-radius: 3px;
					background-color: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					font-size: 0.9em;
				}
				
				.todo-stats {
					text-align: center;
					font-size: 0.8em;
					color: var(--vscode-descriptionForeground);
					margin-top: 10px;
				}
				
				.todo-empty {
					text-align: center;
					color: var(--vscode-descriptionForeground);
					font-style: italic;
					padding: 20px;
				}
			</style>
			
			<style>
				@keyframes fadeIn {
					from { opacity: 0; transform: translateY(-10px); }
					to { opacity: 1; transform: translateY(0); }
				}
				
				@keyframes fadeOut {
					from { opacity: 1; transform: translateY(0); }
					to { opacity: 0; transform: translateY(-10px); }
				}
			</style>
			</style>
		</head>
		<body>
			<div class="header">
				<button class="settings-button" onclick="openSettings()" title="Settings">⚙️</button>
				<img class="logo" src="${
          this._view
            ? this._view.webview.asWebviewUri(
                vscode.Uri.joinPath(
                  this._context.extensionUri,
                  "media",
                  "logo.png"
                )
              )
            : ""
        }" alt="Islamic Shoky Logo">
				<div class="title">Islamic Shoky</div>
			</div>
			
			${
        config.enablePrayerTimes
          ? `
			<!-- Next Azan Section -->
			<div class="section">
				<div class="section-title">
					🕐 Next Prayer Time
				</div>
				<div class="azan-info">
					<div id="locationStatus" class="location-status">
						<span id="locationText">🌍 Location not set</span>
						<button class="location-button" onclick="requestLocation()">📍 Set Location</button>
					</div>
					<div id="loadingIndicator" class="loading" style="display: none;">
						⏳ Loading prayer times...
					</div>
					<div id="prayerContent" style="display: none;">
						<div class="next-azan" id="nextAzanName">Fajr</div>
						<div class="azan-time" id="nextAzanTime">05:30 AM</div>
						<div class="time-remaining" id="timeRemaining">in 2h 15m</div>
						<div class="prayer-times" id="prayerTimes">
							<!-- Prayer times will be populated by API -->
						</div>
					</div>
					<div id="errorMessage" class="error-message" style="display: none;">
						❌ Unable to fetch prayer times. Please check your location settings.
					</div>
				</div>
			</div>
			`
          : ""
      }
			
			${
        config.enableAzkar
          ? `
			<!-- Azkar Section -->
			<div class="section">
				<div class="section-title">
					📿 Daily Azkar
				</div>
				<div class="azkar-content">
					<div class="azkar-text" id="azkarText">
						سُبْحَانَ اللَّهِ وَبِحَمْدِهِ
					</div>
					<button class="refresh-button" onclick="getRandomAzkar()">New Azkar</button>
				</div>
			</div>
			`
          : ""
      }
			
			${
        config.enablePomodoro
          ? `
			<!-- Pomodoro Timer Section -->
			<div class="section">
				<div class="section-title">
					🍅 Focus Timer
				</div>
				<div class="pomodoro-container">
					<div class="timer-status" id="timerStatus">Ready to Focus</div>
					<div class="timer-display" id="timerDisplay">25:00</div>
					<div class="progress-bar">
						<div class="progress-fill" id="progressFill"></div>
					</div>
					<div class="timer-controls">
						<button class="timer-button" id="startBtn" onclick="startTimer()">Start</button>
						<button class="timer-button" id="pauseBtn" onclick="pauseTimer()">Pause</button>
						<button class="timer-button" id="resetBtn" onclick="resetTimer()">Reset</button>
					</div>
				</div>
			</div>
			`
          : ""
      }
			
			${
        config.enableTodoList
          ? `
			<!-- Todo List Section -->
			<div class="section">
				<div class="section-title">
					📝 Programming Tasks
				</div>
				<div class="todo-container">
					<div class="todo-input-group">
						<input type="text" id="todoInput" placeholder="Add a new task..." class="todo-input">
						<button class="todo-button" onclick="addTodo()">Add Task</button>
					</div>
					<div class="todo-filters">
						<button class="filter-button active" onclick="filterTodos('all')">All</button>
						<button class="filter-button" onclick="filterTodos('active')">Active</button>
						<button class="filter-button" onclick="filterTodos('completed')">Completed</button>
						<button class="clear-button" onclick="clearCompleted()">Clear Completed</button>
					</div>
					<div class="todo-list" id="todoList">
						<!-- Tasks will be populated here -->
					</div>
					<div class="todo-stats" id="todoStats">
						<span id="activeCount">0</span> active tasks
					</div>
				</div>
			</div>
			`
          : ""
      }
			
			<div class="footer">
				<p>Islamic Shoky Extension v0.0.1</p>
				<p>Stay focused, stay blessed 🤲</p>
			</div>
			
			<script>
				const vscode = acquireVsCodeApi();
				
				// Configuration from extension
				const extensionConfig = ${JSON.stringify(config)};
				
				// Location and Prayer Times Variables
				let userLocation = null;
				let prayerTimesData = null;
				
				// Azkar data - combine default and custom
				const defaultAzkarList = [
					{
						arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
						translation: 'Glory be to Allah and praise be to Him'
					},
					{
						arabic: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ',
						translation: 'There is no god but Allah, alone without partner'
					},
					{
						arabic: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا محَمَّدٍ',
						translation: 'O Allah, send blessings and peace upon our Prophet Muhammad'
					},
					{
						arabic: 'رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنتَ التَّوَّابُ الرَّحِيمُ',
						translation: 'My Lord, forgive me and accept my repentance. You are the Oft-Returning, the Most Merciful'
					},
					{
						arabic: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ',
						translation: 'Allah is sufficient for us, and He is the best Disposer of affairs'
					},
					{
						arabic: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
						translation: 'Our Lord, give us good in this world and good in the next world, and save us from the punishment of the Fire'
					}
				];
				
				let azkarList = [...defaultAzkarList];
				let azkarChangeInterval;
				let currentAzkarIndex = -1;
				let isPanelVisible = false;
				
				// State preservation variables
				let preservedAzkarIndex = -1;
				let preservedPanelVisibility = false;
				
				// Special azkar for sound notification
				const specialAzkar = 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا محَمَّدٍ';
				
				// Audio context for sound generation
				let audioContext = null;
				
				// Pomodoro Timer Variables
				let timerInterval;
				let isRunning = false;
				let currentTime = ${config.focusDuration} * 60; // Configurable focus duration
				let totalTime = ${config.focusDuration} * 60;
				let isBreak = false;
				
				// Todo List Variables
				let todos = [];
				let currentFilter = 'all';
				let editingId = null;
				
				// Initialize
				initializeAzkar();
				getRandomAzkar();
				updateTimerDisplay();
				loadTodos();
				
				// Load stored location if available
				const storedLocation = localStorage.getItem('islamicShokyLocation');
				if (storedLocation) {
					userLocation = JSON.parse(storedLocation);
					updateLocationDisplay();
					fetchPrayerTimes();
				}
				
				// Listen for messages from extension
				window.addEventListener('message', event => {
					const message = event.data;
					switch (message.command) {
						case 'enableIPLocation':
							requestIPLocation();
							break;
						case 'setManualLocation':
							setManualLocation(message.city);
							break;
						case 'panelVisibilityChanged':
							isPanelVisible = message.visible;
							if (message.visible) {
								// Panel became visible, update azkar without notification
								updateAzkarDisplay();
							}
							break;
						case 'preserveState':
							// Store current state before refresh
							preservedAzkarIndex = currentAzkarIndex;
							preservedPanelVisibility = isPanelVisible;
							break;
						case 'configUpdated':
							// Update configuration and restart azkar interval if needed
							Object.assign(extensionConfig, message.config);
							
							// Rebuild azkar list if custom azkar changed
							if (message.config.customAzkar) {
								const customAzkarObjects = message.config.customAzkar.map(arabic => ({
									arabic: arabic,
									translation: ""
								}));
								azkarList = [...defaultAzkarList, ...customAzkarObjects];
							}
							
							// Restore preserved state
							if (preservedAzkarIndex >= 0) {
								currentAzkarIndex = preservedAzkarIndex;
								updateAzkarDisplay();
							}
							if (preservedPanelVisibility !== undefined) {
								isPanelVisible = preservedPanelVisibility;
							}
							
							restartAzkarInterval();
							break;
						case 'cleanup':
							// Clear intervals when webview is disposed
							if (azkarChangeInterval) {
								clearInterval(azkarChangeInterval);
								azkarChangeInterval = null;
							}
							break;
					}
				});
				
				function requestLocation() {
					vscode.postMessage({
						command: 'requestLocation'
					});
				}
				
				function openSettings() {
					vscode.postMessage({
						command: 'openSettings'
					});
				}
				
				async function requestIPLocation() {
					showLoading();
					try {
						// Try to get location based on IP address using a free IP geolocation service
						const ipResponse = await fetch('https://ipapi.co/json/');
						if (!ipResponse.ok) {
							throw new Error('IP location service unavailable');
						}
						
						const ipData = await ipResponse.json();
						
						if (ipData.latitude && ipData.longitude && ipData.city) {
							userLocation = {
								latitude: parseFloat(ipData.latitude),
								longitude: parseFloat(ipData.longitude),
								city: ipData.city + (ipData.country_name ? ', ' + ipData.country_name : ''),
								type: 'ip-based'
							};
							
							saveLocation();
							updateLocationDisplay();
							await fetchPrayerTimes();
							
							vscode.postMessage({
								command: 'alert',
								text: \`Location detected: \${userLocation.city}\`
							});
						} else {
							throw new Error('Invalid IP location data');
						}
					} catch (error) {
						console.error('IP-based location error:', error);
						hideLoading();
						showError('Unable to detect location from IP address. Please use manual location entry.');
						vscode.postMessage({
							command: 'alert',
							text: 'IP-based location failed. Please try manual location entry.'
						});
					}
				}
				
				async function setManualLocation(city) {
					if (!city) return;
					
					showLoading();
					try {
						// Try multiple approaches to get location coordinates
						let locationData = null;
						
						// Method 1: Try Aladhan's address to coordinates API
						try {
							const geocodeResponse = await fetch(\`https://api.aladhan.com/v1/addressToLatLng?address=\${encodeURIComponent(city)}\`);
							const geocodeData = await geocodeResponse.json();
							
							if (geocodeData.code === 200 && geocodeData.data && geocodeData.data.latitude && geocodeData.data.longitude) {
								locationData = {
									latitude: parseFloat(geocodeData.data.latitude),
									longitude: parseFloat(geocodeData.data.longitude),
									city: city,
									type: 'manual'
								};
							}
						} catch (error) {
							console.log('Aladhan geocoding failed, trying alternative method');
						}
						
						// Method 2: Try using city-based prayer times directly (fallback for major cities)
						if (!locationData) {
							const knownCities = {
								'cairo': { latitude: 30.0444, longitude: 31.2357 },
								'alexandria': { latitude: 31.2001, longitude: 29.9187 },
								'london': { latitude: 51.5074, longitude: -0.1278 },
								'new york': { latitude: 40.7128, longitude: -74.0060 },
								'paris': { latitude: 48.8566, longitude: 2.3522 },
								'dubai': { latitude: 25.2048, longitude: 55.2708 },
								'riyadh': { latitude: 24.7136, longitude: 46.6753 },
								'mecca': { latitude: 21.3891, longitude: 39.8579 },
								'medina': { latitude: 24.5247, longitude: 39.5692 },
								'istanbul': { latitude: 41.0082, longitude: 28.9784 },
								'jakarta': { latitude: -6.2088, longitude: 106.8456 },
								'karachi': { latitude: 24.8607, longitude: 67.0011 },
								'lahore': { latitude: 31.5204, longitude: 74.3587 },
								'dhaka': { latitude: 23.8103, longitude: 90.4125 },
								'kuala lumpur': { latitude: 3.1390, longitude: 101.6869 },
								'singapore': { latitude: 1.3521, longitude: 103.8198 }
							};
							
							const cityKey = city.toLowerCase().trim();
							if (knownCities[cityKey]) {
								locationData = {
									latitude: knownCities[cityKey].latitude,
									longitude: knownCities[cityKey].longitude,
									city: city,
									type: 'manual'
								};
							}
						}
						
						// Method 3: Try direct prayer times API with city name
						if (!locationData) {
							try {
								const testResponse = await fetch(\`https://api.aladhan.com/v1/timingsByCity?city=\${encodeURIComponent(city)}&country=&method=${
                  config.prayerCalculationMethod
                }\`);
								const testData = await testResponse.json();
								
								if (testData.code === 200 && testData.data && testData.data.timings) {
									// If we can get prayer times directly, use city-name method
									locationData = {
										latitude: 0, // Will use city-based API instead
										longitude: 0,
										city: city,
										type: 'city-name',
										useDirectCityAPI: true
									};
								}
							} catch (error) {
								console.log('Direct city API test failed');
							}
						}
						
						if (locationData) {
							userLocation = locationData;
							saveLocation();
							updateLocationDisplay();
							await fetchPrayerTimes();
						} else {
							throw new Error(\`Unable to find location: \${city}. Please try:\\n- Full city name (e.g., "Cairo, Egypt")\\n- Different spelling\\n- Major city nearby\`);
						}
					} catch (error) {
						console.error('Geocoding error:', error);
						hideLoading();
						showError(error.message || \`Unable to find location: \${city}. Please try a different city name or spelling.\`);
						
						// Show VS Code message with suggestions
						vscode.postMessage({
							command: 'alert',
							text: \`Location "\${city}" not found. Try: "Cairo, Egypt" or "New York, USA" with country name.\`
						});
					}
				}
				
				function saveLocation() {
					localStorage.setItem('islamicShokyLocation', JSON.stringify(userLocation));
				}
				
				function updateLocationDisplay() {
					const locationText = document.getElementById('locationText');
					if (userLocation) {
						if (userLocation.city) {
							locationText.textContent = \`📍 \${userLocation.city}\`;
						} else if (userLocation.type === 'coordinates') {
							locationText.textContent = '📍 Location detected (GPS)';
						} else if (userLocation.type === 'ip-based') {
							locationText.textContent = '📍 Location detected (IP)';
						} else {
							locationText.textContent = '📍 Location detected';
						}
					} else {
						locationText.textContent = '🌍 Location not set';
					}
				}
				
				async function fetchPrayerTimes() {
					if (!userLocation) return;
					
					showLoading();
					try {
						const today = new Date();
						const dateString = \`\${today.getDate()}-\${today.getMonth() + 1}-\${today.getFullYear()}\`;
						
						let response;
						
						// Use city-based API if available, otherwise use coordinates
						if (userLocation.useDirectCityAPI && userLocation.city) {
							response = await fetch(
								\`https://api.aladhan.com/v1/timingsByCity/\${dateString}?city=\${encodeURIComponent(userLocation.city)}&method=${
                  config.prayerCalculationMethod
                }\`
							);
						} else {
							response = await fetch(
								\`https://api.aladhan.com/v1/timings/\${dateString}?latitude=\${userLocation.latitude}&longitude=\${userLocation.longitude}&method=${
                  config.prayerCalculationMethod
                }\`
							);
						}
						
						if (!response.ok) {
							throw new Error('API request failed');
						}
						
						const data = await response.json();
						
						if (data.code === 200 && data.data && data.data.timings) {
							prayerTimesData = data.data.timings;
							
							// Send prayer times to extension for notification scheduling
							vscode.postMessage({
								command: 'prayerTimesFetched',
								prayerTimes: prayerTimesData
							});
							
							displayPrayerTimes();
							hideLoading();
							showPrayerContent();
						} else {
							throw new Error('Invalid API response');
						}
					} catch (error) {
						console.error('Prayer times fetch error:', error);
						hideLoading();
						showError('Unable to fetch prayer times. Please check your internet connection or try a different location.');
					}
				}
				
				function displayPrayerTimes() {
					if (!prayerTimesData) return;
					
					const prayers = [
						{ name: 'Fajr', key: 'Fajr' },
						{ name: 'Dhuhr', key: 'Dhuhr' },
						{ name: 'Asr', key: 'Asr' },
						{ name: 'Maghrib', key: 'Maghrib' },
						{ name: 'Isha', key: 'Isha' }
					];
					
					// Display all prayer times
					const prayerTimesContainer = document.getElementById('prayerTimes');
					prayerTimesContainer.innerHTML = prayers.map(prayer => {
						const time = prayerTimesData[prayer.key];
						const formattedTime = formatTime(time);
						return \`
							<div class="prayer-time">
								<span class="prayer-name">\${prayer.name}:</span>
								<span>\${formattedTime}</span>
							</div>
						\`;
					}).join('');
					
					// Find and display next prayer
					updateNextPrayer(prayers);
				}
				
				function updateNextPrayer(prayers) {
					const now = new Date();
					const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
					
					for (let prayer of prayers) {
						const prayerTime = prayerTimesData[prayer.key];
						const [hours, minutes] = prayerTime.split(':').map(Number);
						const prayerTimeMinutes = hours * 60 + minutes;
						
						if (prayerTimeMinutes > currentTimeMinutes) {
							const diff = prayerTimeMinutes - currentTimeMinutes;
							const hoursRemaining = Math.floor(diff / 60);
							const minutesRemaining = diff % 60;
							
							document.getElementById('nextAzanName').textContent = prayer.name;
							document.getElementById('nextAzanTime').textContent = formatTime(prayerTime);
							document.getElementById('timeRemaining').textContent = 
								\`in \${hoursRemaining}h \${minutesRemaining}m\`;
							return;
						}
					}
					
					// If no prayer today, show tomorrow's Fajr
					const tomorrowFajr = prayerTimesData['Fajr'];
					const [fajrHours, fajrMinutes] = tomorrowFajr.split(':').map(Number);
					const tomorrow = new Date();
					tomorrow.setDate(tomorrow.getDate() + 1);
					tomorrow.setHours(fajrHours, fajrMinutes, 0, 0);
					
					const diff = tomorrow - now;
					const hoursRemaining = Math.floor(diff / (1000 * 60 * 60));
					const minutesRemaining = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
					
					document.getElementById('nextAzanName').textContent = 'Fajr (Tomorrow)';
					document.getElementById('nextAzanTime').textContent = formatTime(tomorrowFajr);
					document.getElementById('timeRemaining').textContent = 
						\`in \${hoursRemaining}h \${minutesRemaining}m\`;
				}
				
				function formatTime(time24) {
					const [hours, minutes] = time24.split(':').map(Number);
					const period = hours >= 12 ? 'PM' : 'AM';
					const displayHours = hours % 12 || 12;
					return \`\${displayHours}:\${minutes.toString().padStart(2, '0')} \${period}\`;
				}
				
				function showLoading() {
					document.getElementById('loadingIndicator').style.display = 'block';
					document.getElementById('prayerContent').style.display = 'none';
					document.getElementById('errorMessage').style.display = 'none';
				}
				
				function hideLoading() {
					document.getElementById('loadingIndicator').style.display = 'none';
				}
				
				function showPrayerContent() {
					document.getElementById('prayerContent').style.display = 'block';
					document.getElementById('errorMessage').style.display = 'none';
				}
				
				function showError(message) {
					document.getElementById('errorMessage').textContent = message;
					document.getElementById('errorMessage').style.display = 'block';
					document.getElementById('prayerContent').style.display = 'none';
				}
				
				function initializeAzkar() {
					console.log('Initializing azkar with config:', extensionConfig);
					
					// Add custom azkar to the list
					if (extensionConfig.customAzkar && extensionConfig.customAzkar.length > 0) {
						// Convert custom azkar strings to objects for consistency
						const customAzkarObjects = extensionConfig.customAzkar.map(arabic => ({
							arabic: arabic,
							translation: "" // Empty translation since we only show Arabic
						}));
						azkarList = [...defaultAzkarList, ...customAzkarObjects];
						console.log('Custom azkar added, total azkar:', azkarList.length);
					}
					
					// Set up automatic azkar change if delay is greater than 0
					if (extensionConfig.azkarChangeDelay > 0) {
						console.log('Setting up azkar change interval:', extensionConfig.azkarChangeDelay, 'minutes');
						// For testing, use a shorter interval (10 seconds) if delay is less than 1 minute
						const intervalMs = extensionConfig.azkarChangeDelay < 1 ? 10000 : extensionConfig.azkarChangeDelay * 60 * 1000;
						console.log('Actual interval:', intervalMs, 'milliseconds');
						azkarChangeInterval = setInterval(() => {
							console.log('Azkar change interval triggered');
							changeAzkarRandomly();
						}, intervalMs);
					} else {
						console.log('Azkar change delay is 0 or not set, no automatic changes');
					}
				}
				
				function changeAzkarRandomly() {
					console.log('Changing azkar randomly, current index:', currentAzkarIndex);
					
					let newIndex;
					do {
						newIndex = Math.floor(Math.random() * azkarList.length);
					} while (azkarList.length > 1 && newIndex === currentAzkarIndex);
					
					currentAzkarIndex = newIndex;
					const azkar = azkarList[currentAzkarIndex];
					console.log('New azkar selected:', azkar.arabic.substring(0, 30) + '...');
					
					// Update display
					document.getElementById('azkarText').innerHTML = \`
						\${azkar.arabic}
					\`;
					
					// Send notification only if panel is not visible and notifications are enabled
					// For testing, always send notification
					if (extensionConfig.enableAzkarNotifications) {
						console.log('Sending azkar notification (test mode)');
						vscode.postMessage({
							command: 'azkarChanged',
							azkar: azkar
						});
					}
				}
				
				function restartAzkarInterval() {
					// Clear existing interval
					if (azkarChangeInterval) {
						clearInterval(azkarChangeInterval);
						azkarChangeInterval = null;
					}
					
					// Start new interval if delay is greater than 0
					if (extensionConfig.azkarChangeDelay > 0) {
						azkarChangeInterval = setInterval(() => {
							changeAzkarRandomly();
						}, extensionConfig.azkarChangeDelay * 60 * 1000);
					}
				}
				
				function getRandomAzkar() {
					let randomIndex;
					do {
						randomIndex = Math.floor(Math.random() * azkarList.length);
					} while (azkarList.length > 1 && randomIndex === currentAzkarIndex);
					
					currentAzkarIndex = randomIndex;
					const azkar = azkarList[currentAzkarIndex];
					
					document.getElementById('azkarText').innerHTML = \`
						\${azkar.arabic}
					\`;
					
					// Don't send notification for manual azkar changes
				}
				
				// Pomodoro Timer Functions
				function startTimer() {
					if (!isRunning) {
						isRunning = true;
						document.getElementById('startBtn').textContent = 'Running...';
						document.getElementById('timerStatus').textContent = isBreak ? 'Break Time' : 'Focus Time';
						
						timerInterval = setInterval(() => {
							if (currentTime > 0) {
								currentTime--;
								updateTimerDisplay();
								updateProgress();
							} else {
								completeTimer();
							}
						}, 1000);
					}
				}
				
				function pauseTimer() {
					if (isRunning) {
						clearInterval(timerInterval);
						isRunning = false;
						document.getElementById('startBtn').textContent = 'Start';
						document.getElementById('timerStatus').textContent = 'Paused';
					}
				}
				
				function resetTimer() {
					clearInterval(timerInterval);
					isRunning = false;
					isBreak = false;
					currentTime = ${config.focusDuration} * 60;
					totalTime = ${config.focusDuration} * 60;
					document.getElementById('startBtn').textContent = 'Start';
					document.getElementById('timerStatus').textContent = 'Ready to Focus';
					updateTimerDisplay();
					updateProgress();
				}
				
				function completeTimer() {
					clearInterval(timerInterval);
					isRunning = false;
					
					if (!isBreak) {
						// Work session completed, start break
						isBreak = true;
						currentTime = ${config.breakDuration} * 60; // Configurable break duration
						totalTime = ${config.breakDuration} * 60;
						document.getElementById('timerStatus').textContent = 'Break Time!';
						vscode.postMessage({
							command: 'alert',
							text: '🍅 Great work! Time for a ${config.breakDuration}-minute break.'
						});
					} else {
						// Break completed, ready for next work session
						isBreak = false;
						currentTime = ${config.focusDuration} * 60;
						totalTime = ${config.focusDuration} * 60;
						document.getElementById('timerStatus').textContent = 'Ready to Focus';
						vscode.postMessage({
							command: 'alert',
							text: '✨ Break over! Ready for another focus session?'
						});
					}
					
					document.getElementById('startBtn').textContent = 'Start';
					updateTimerDisplay();
					updateProgress();
				}
				
				function updateTimerDisplay() {
					const minutes = Math.floor(currentTime / 60);
					const seconds = currentTime % 60;
					const display = \`\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
					
					const timerElement = document.getElementById('timerDisplay');
					timerElement.textContent = display;
					
					if (isBreak) {
						timerElement.classList.add('break');
					} else {
						timerElement.classList.remove('break');
					}
				}
				
				function updateProgress() {
					const progress = ((totalTime - currentTime) / totalTime) * 100;
					const progressFill = document.getElementById('progressFill');
					progressFill.style.width = progress + '%';
					
					if (isBreak) {
						progressFill.classList.add('break');
					} else {
						progressFill.classList.remove('break');
					}
				}
				
				// Update prayer times every minute if we have location and prayer data
				setInterval(() => {
					if (prayerTimesData && userLocation) {
						const prayers = [
							{ name: 'Fajr', key: 'Fajr' },
							{ name: 'Dhuhr', key: 'Dhuhr' },
							{ name: 'Asr', key: 'Asr' },
							{ name: 'Maghrib', key: 'Maghrib' },
							{ name: 'Isha', key: 'Isha' }
						];
						updateNextPrayer(prayers);
					}
				}, 60000);
				
				// Refresh prayer times daily at midnight
				setInterval(() => {
					if (userLocation) {
						fetchPrayerTimes();
					}
				}, 24 * 60 * 60 * 1000);
				
				// Todo List Functions
				function loadTodos() {
					const stored = localStorage.getItem('islamicShokyTodos');
					if (stored) {
						todos = JSON.parse(stored);
					}
					renderTodos();
					updateStats();
				}
				
				function saveTodos() {
					localStorage.setItem('islamicShokyTodos', JSON.stringify(todos));
				}
				
				function addTodo() {
					const input = document.getElementById('todoInput');
					const text = input.value.trim();
					
					if (text) {
						const todo = {
							id: Date.now(),
							text: text,
							completed: false,
							createdAt: new Date().toISOString()
						};
						
						todos.push(todo);
						saveTodos();
						renderTodos();
						updateStats();
						input.value = '';
						
						// Show success message
						showTodoMessage('Task added successfully!');
					}
				}
				
				function toggleTodo(id) {
					const todo = todos.find(t => t.id === id);
					if (todo) {
						todo.completed = !todo.completed;
						saveTodos();
						renderTodos();
						updateStats();
					}
				}
				
				function deleteTodo(id) {
					todos = todos.filter(t => t.id !== id);
					saveTodos();
					renderTodos();
					updateStats();
					showTodoMessage('Task deleted');
				}
				
				function editTodo(id) {
					const todo = todos.find(t => t.id === id);
					if (todo && !editingId) {
						editingId = id;
						renderTodos();
					}
				}
				
				function saveEdit(id) {
					const input = document.querySelector(\`[data-edit-id="\${id}"]\`);
					const newText = input.value.trim();
					
					if (newText) {
						const todo = todos.find(t => t.id === id);
						if (todo) {
							todo.text = newText;
							saveTodos();
						}
					}
					
					editingId = null;
					renderTodos();
					showTodoMessage('Task updated');
				}
				
				function cancelEdit() {
					editingId = null;
					renderTodos();
				}
				
				function filterTodos(filter) {
					currentFilter = filter;
					
					// Update filter button states
					document.querySelectorAll('.filter-button').forEach(btn => {
						btn.classList.remove('active');
					});
					document.querySelector(\`[onclick="filterTodos('\${filter}')"]\`).classList.add('active');
					
					renderTodos();
				}
				
				function clearCompleted() {
					const completedCount = todos.filter(t => t.completed).length;
					if (completedCount > 0) {
						todos = todos.filter(t => !t.completed);
						saveTodos();
						renderTodos();
						updateStats();
						showTodoMessage(\`\${completedCount} completed tasks cleared\`);
					}
				}
				
				function renderTodos() {
					const todoList = document.getElementById('todoList');
					const filteredTodos = todos.filter(todo => {
						switch (currentFilter) {
							case 'active': return !todo.completed;
							case 'completed': return todo.completed;
							default: return true;
						}
					});
					
					if (filteredTodos.length === 0) {
						todoList.innerHTML = '<div class="todo-empty">No tasks found</div>';
						return;
					}
					
					todoList.innerHTML = filteredTodos.map(todo => {
						if (editingId === todo.id) {
							return \`
								<div class="todo-item">
									<input type="checkbox" class="todo-checkbox" 
										   \${todo.completed ? 'checked' : ''} 
										   onclick="toggleTodo(\${todo.id})">
									<input type="text" class="todo-edit-input" 
										   data-edit-id="\${todo.id}" 
										   value="\${todo.text}" 
										   onkeypress="if(event.key === 'Enter') saveEdit(\${todo.id}); if(event.key === 'Escape') cancelEdit();">
									<div class="todo-actions">
										<button class="todo-edit-btn" onclick="saveEdit(\${todo.id})" title="Save">💾</button>
										<button class="todo-edit-btn" onclick="cancelEdit()" title="Cancel">❌</button>
									</div>
								</div>
							\`;
						} else {
							return \`
								<div class="todo-item \${todo.completed ? 'completed' : ''}">
									<input type="checkbox" class="todo-checkbox" 
										   \${todo.completed ? 'checked' : ''} 
										   onclick="toggleTodo(\${todo.id})">
									<span class="todo-text">\${todo.text}</span>
									<div class="todo-actions">
										<button class="todo-edit-btn" onclick="editTodo(\${todo.id})" title="Edit">✏️</button>
										<button class="todo-delete-btn" onclick="deleteTodo(\${todo.id})" title="Delete">🗑️</button>
									</div>
								</div>
							\`;
						}
					}).join('');
				}
				
				function updateStats() {
					const activeCount = todos.filter(t => !t.completed).length;
					document.getElementById('activeCount').textContent = activeCount;
				}
				
				function showTodoMessage(message) {
					// Create a temporary message
					const messageDiv = document.createElement('div');
					messageDiv.textContent = message;
					messageDiv.style.cssText = \`
						position: fixed;
						top: 20px;
						right: 20px;
						background: var(--vscode-notificationsInfoIcon-foreground);
						color: var(--vscode-button-foreground);
						padding: 8px 16px;
						border-radius: 4px;
						font-size: 0.8em;
						z-index: 1000;
						animation: fadeIn 0.3s ease;
					\`;
					
					document.body.appendChild(messageDiv);
					
					setTimeout(() => {
						messageDiv.style.animation = 'fadeOut 0.3s ease';
						setTimeout(() => {
							document.body.removeChild(messageDiv);
						}, 300);
					}, 2000);
				}
				
				// Add keyboard support for todo input
				document.addEventListener('DOMContentLoaded', function() {
					const todoInput = document.getElementById('todoInput');
					if (todoInput) {
						todoInput.addEventListener('keypress', function(event) {
							if (event.key === 'Enter') {
								addTodo();
							}
						});
					}
				});
			</script>
		</body>
		</html>`;
  }

  // Prayer notification methods
  _schedulePrayerNotifications(prayerTimes) {
    const config = this._getConfiguration();
    if (!config.enablePrayerNotifications) return;

    // Clear existing timeouts
    this._clearPrayerTimeouts();

    const now = new Date();
    const prayers = [
      { name: "Fajr", key: "Fajr" },
      { name: "Dhuhr", key: "Dhuhr" },
      { name: "Asr", key: "Asr" },
      { name: "Maghrib", key: "Maghrib" },
      { name: "Isha", key: "Isha" },
    ];

    prayers.forEach((prayer) => {
      const prayerTime = prayerTimes[prayer.key];
      if (!prayerTime) return;

      const [hours, minutes] = prayerTime.split(":").map(Number);
      const prayerDateTime = new Date();
      prayerDateTime.setHours(hours, minutes, 0, 0);

      // If prayer time has passed today, schedule for tomorrow
      if (prayerDateTime <= now) {
        prayerDateTime.setDate(prayerDateTime.getDate() + 1);
      }

      // Schedule notification at prayer time
      const timeUntilPrayer = prayerDateTime - now;
      if (timeUntilPrayer > 0) {
        const prayerTimeout = setTimeout(() => {
          this._showPrayerNotification(prayer.name, "prayer");
        }, timeUntilPrayer);

        this._prayerTimeouts.set(`${prayer.key}_prayer`, prayerTimeout);
      }

      // Schedule reminder notification after prayer time + delay
      const reminderTime = new Date(
        prayerDateTime.getTime() + config.prayerReminderDelay * 60 * 1000
      );
      const timeUntilReminder = reminderTime - now;
      if (timeUntilReminder > 0) {
        const reminderTimeout = setTimeout(() => {
          this._showPrayerNotification(prayer.name, "reminder");
        }, timeUntilReminder);

        this._prayerTimeouts.set(`${prayer.key}_reminder`, reminderTimeout);
      }
    });
  }

  _showPrayerNotification(prayerName, type) {
    const config = this._getConfiguration();
    if (!config.enablePrayerNotifications) return;

    let message = "";

    if (type === "prayer") {
      message = `🕌 حان وقت الصلاة - ${prayerName}\n\nقم فصلِّ؛ الصلاة نور لقلبك وراحة لروحك.`;
    } else if (type === "reminder") {
      const reminders = [
        `🕌 الصلاة نور لقلبك وراحة لروحك - ${prayerName}`,
        `📿 اللهم صل وسلم على نبينا محمد - ${prayerName}`,
        `🌙 الصلاة عماد الدين - ${prayerName}`,
        `⭐ الصلاة راحة للنفس وطمأنينة للقلب - ${prayerName}`,
        `🕊️ الصلاة أفضل الأعمال - ${prayerName}`,
      ];
      message = reminders[Math.floor(Math.random() * reminders.length)];
    }

    // Show the prayer notification
    const notification = vscode.window.showInformationMessage(
      message,
      "View Prayer Times"
    );

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      // Show a subtle "notification ended" message to replace the current notification
      vscode.window.showInformationMessage("🕌 Prayer notification ended");
    }, 10000); // 10 seconds

    // Handle user interaction
    notification.then((selection) => {
      if (selection === "View Prayer Times") {
        vscode.commands.executeCommand(
          "workbench.view.extension.islamic-shoky-sidebar"
        );
      }
    });
  }

  _clearPrayerTimeouts() {
    this._prayerTimeouts.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this._prayerTimeouts.clear();
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

let currentProvider = null; // Global reference to provider for cleanup

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "islamic-shoky" is now active!');

  // Register the sidebar provider
  currentProvider = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "islamic-shoky.panel",
      currentProvider
    )
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("islamic-shoky")) {
        // Refresh the webview when settings change
        currentProvider.refresh();
      }
    })
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "islamic-shoky.helloWorld",
    function () {
      // The code you place here will be executed every time your command is executed

      // Display a message box to the user
      vscode.window.showInformationMessage("Hello World from islamic shoky!");
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {
  // Stop any playing sound when extension is deactivated
  if (currentProvider && currentProvider._stopCurrentSound) {
    currentProvider._stopCurrentSound();
  }

  // Clear all prayer notification timeouts
  if (currentProvider && currentProvider._clearPrayerTimeouts) {
    currentProvider._clearPrayerTimeouts();
  }
}

module.exports = {
  activate,
  deactivate,
};
