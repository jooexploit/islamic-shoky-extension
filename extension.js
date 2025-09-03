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
    this._currentAudioState = null; // Track Quran audio state
    this._audioProcess = null; // Track background audio process
    this._audioStatusCheck = null; // Audio status check interval
    this._reminderInterval = null; // 5-minute reminder interval
    this._reminderAudioProcess = null; // Background reminder audio process
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      retainContextWhenHidden: true,
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
              vscode.window.showInformationMessage("Alert notification ended");
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
          case "getLocationData":
            this._handleLocationDataRequest(webviewView);
            break;
          case "locationDataResponse":
            this._forwardLocationToPrayerProvider(message.location);
            break;
          case "locationUpdated":
            this._forwardLocationToPrayerProvider(message.location);
            break;
          case "getTasksData":
            this._handleTasksDataRequest(webviewView);
            break;
          case "tasksDataResponse":
            this._forwardTasksToTasksProvider(message.tasks);
            break;
          case "tasksUpdated":
            this._forwardTasksToTasksProvider(message.tasks);
            break;
          case "quranAudioStarted":
            // Store audio state to prevent interruption
            this._currentAudioState = {
              isPlaying: true,
              surah: message.surah,
              reciter: message.reciter,
              startTime: Date.now(),
            };
            break;
          case "quranAudioStopped":
            // Clear audio state
            this._currentAudioState = null;
            this._stopBackgroundAudio();
            break;
          case "playQuranBackground":
            // Play audio in background using Node.js
            this._playQuranBackground(
              message.audioUrl,
              message.surah,
              message.reciter
            );
            break;
          case "stopQuranBackground":
            // Stop background audio
            this._stopBackgroundAudio();
            break;
        }
      },
      undefined,
      this._context.subscriptions
    );

    // Clean up when webview is disposed
    webviewView.onDidDispose(() => {
      // Only clear intervals, but preserve audio state if audio is playing
      webviewView.webview.postMessage({
        command: "cleanup",
        preserveAudio: this._currentAudioState !== null,
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

    // Restore audio state if there was one
    if (this._currentAudioState) {
      setTimeout(() => {
        webviewView.webview.postMessage({
          command: "restoreAudioState",
          audioState: this._currentAudioState,
        });
      }, 1000); // Give webview time to initialize
    }

    // Start 5-minute reminder system
    this._startReminderSystem();
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

  _handleLocationDataRequest(webviewView) {
    // Request location data from the webview and forward it to prayer provider
    webviewView.webview.postMessage({
      command: "requestCurrentLocation",
    });
  }

  _forwardLocationToPrayerProvider(location) {
    // Forward location data to the prayer provider
    if (prayerProvider && location) {
      prayerProvider.currentLocation = location;
      prayerProvider.refresh();
    }
  }

  _handleTasksDataRequest(webviewView) {
    // Request tasks data from the webview and forward it to tasks provider
    webviewView.webview.postMessage({
      command: "requestCurrentTasks",
    });
  }

  _forwardTasksToTasksProvider(tasks) {
    // Forward tasks data to the tasks provider
    console.log(
      "SidebarProvider: Forwarding tasks to TasksDataProvider:",
      tasks
    );
    if (tasksProvider && tasks) {
      tasksProvider.updateTasks(tasks);
    } else {
      console.log(
        "SidebarProvider: tasksProvider not available or no tasks data"
      );
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
        "salah.mp3"
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

  _playQuranBackground(audioUrl, surah, reciter) {
    try {
      // Stop any existing audio
      this._stopBackgroundAudio();

      // Stop reminder audio if it's playing
      this._stopReminderAudio();

      const platform = process.platform;
      console.log("Starting background Quran audio:", audioUrl);

      if (platform === "win32") {
        // Windows - use PowerShell with MediaPlayer
        this._audioProcess = spawn("powershell", [
          "-c",
          `Add-Type -AssemblyName presentationCore; 
           $mediaPlayer = New-Object system.windows.media.mediaplayer; 
           $mediaPlayer.open('${audioUrl}'); 
           $mediaPlayer.Play(); 
           Start-Sleep 1; 
           while($mediaPlayer.NaturalDuration.HasTimeSpan -eq $false) { Start-Sleep 1 }; 
           $duration = $mediaPlayer.NaturalDuration.TimeSpan.TotalSeconds; 
           Start-Sleep $duration`,
        ]);
      } else if (platform === "darwin") {
        // macOS - use curl to download and afplay to play
        this._audioProcess = spawn("sh", [
          "-c",
          `curl -s "${audioUrl}" | afplay -`,
        ]);
      } else {
        // Linux - try different audio players with better error handling
        this._tryLinuxAudioPlayers(audioUrl, surah, reciter);
        return; // Early return since _tryLinuxAudioPlayers handles the rest
      }

      if (this._audioProcess) {
        this._setupAudioProcessHandlers(surah, reciter, audioUrl);
      } else {
        this._fallbackToWebviewAudio(audioUrl, surah, reciter);
      }
    } catch (error) {
      console.log("Error starting background audio:", error);
      this._fallbackToWebviewAudio(audioUrl, surah, reciter);
    }
  }

  _tryLinuxAudioPlayers(audioUrl, surah, reciter) {
    const audioPlayers = [
      { name: "mpv", args: ["--no-video", "--quiet", audioUrl] },
      { name: "mpg123", args: ["-q", audioUrl] },
      { name: "cvlc", args: ["--intf", "dummy", "--play-and-exit", audioUrl] },
      {
        name: "ffplay",
        args: ["-nodisp", "-autoexit", "-loglevel", "quiet", audioUrl],
      },
      { name: "mplayer", args: ["-really-quiet", audioUrl] },
      { name: "paplay", args: [] }, // Will use curl | paplay for streaming
      { name: "wget", args: [] }, // Fallback with wget + aplay
    ];

    let playerFound = false;

    for (const player of audioPlayers) {
      try {
        console.log(`Trying audio player: ${player.name}`);

        if (player.name === "paplay") {
          // Use curl to stream and pipe to paplay
          this._audioProcess = spawn("sh", [
            "-c",
            `curl -s "${audioUrl}" | paplay`,
          ]);
        } else if (player.name === "wget") {
          // Download and play with available system player
          this._audioProcess = spawn("sh", [
            "-c",
            `temp_file="/tmp/quran_audio_$(date +%s).mp3"; wget -q -O "$temp_file" "${audioUrl}" && (aplay "$temp_file" 2>/dev/null || paplay "$temp_file" 2>/dev/null || play "$temp_file" 2>/dev/null); rm -f "$temp_file"`,
          ]);
        } else {
          this._audioProcess = spawn(player.name, player.args);
        }

        // Test if the process started successfully
        if (this._audioProcess.pid) {
          console.log(
            `Successfully started ${player.name} with PID: ${this._audioProcess.pid}`
          );
          playerFound = true;
          this._setupAudioProcessHandlers(surah, reciter, audioUrl);
          break;
        }
      } catch (error) {
        console.log(`Failed to start ${player.name}:`, error.message);
        this._audioProcess = null;
        continue;
      }
    }

    if (!playerFound) {
      console.log(
        "No suitable audio player found, falling back to webview audio"
      );
      this._fallbackToWebviewAudio(audioUrl, surah, reciter);
    }
  }

  _setupAudioProcessHandlers(surah, reciter, audioUrl) {
    console.log("Background audio process started");

    // Update current audio state
    this._currentAudioState = {
      isPlaying: true,
      surah: surah,
      reciter: reciter,
      startTime: Date.now(),
      audioUrl: audioUrl,
    };

    // Show notification
    vscode.window.showInformationMessage(
      `Playing Quran: Surah ${surah} by ${reciter}`
    );

    // Handle process completion
    this._audioProcess.on("close", (code) => {
      console.log("Background audio process finished with code:", code);
      this._audioProcess = null;
      this._currentAudioState = null;

      // Notify webview if it's still available
      if (this._view && this._view.webview) {
        this._view.webview.postMessage({
          command: "audioEnded",
        });
      }

      if (code === 0) {
        vscode.window.showInformationMessage("Quran playbook completed");
      }
    });

    this._audioProcess.on("error", (error) => {
      console.log("Background audio process error:", error);
      this._audioProcess = null;
      this._currentAudioState = null;

      // Fallback to webview audio on error
      this._fallbackToWebviewAudio(audioUrl, surah, reciter);
    });

    // Start status check interval
    this._startAudioStatusCheck();
  }

  _fallbackToWebviewAudio(audioUrl, surah, reciter) {
    console.log("Falling back to webview audio playback");

    // Update state
    this._currentAudioState = {
      isPlaying: true,
      surah: surah,
      reciter: reciter,
      startTime: Date.now(),
      audioUrl: audioUrl,
      isWebviewFallback: true,
    };

    // Notify webview to use internal audio player
    if (this._view && this._view.webview) {
      this._view.webview.postMessage({
        command: "playWebviewAudio",
        audioUrl: audioUrl,
        surah: surah,
        reciter: reciter,
      });
    }

    vscode.window.showInformationMessage(
      `Playing Quran (browser mode): Surah ${surah} by ${reciter}`
    );
  }

  _stopBackgroundAudio() {
    if (this._audioProcess) {
      console.log("Stopping background audio process");
      this._audioProcess.kill();
      this._audioProcess = null;
      this._currentAudioState = null;

      // Stop status check
      if (this._audioStatusCheck) {
        clearInterval(this._audioStatusCheck);
        this._audioStatusCheck = null;
      }

      // Notify webview if it's still available
      if (this._view && this._view.webview) {
        this._view.webview.postMessage({
          command: "audioStopped",
        });
      }

      vscode.window.showInformationMessage("Quran playback stopped");
    }
  }

  _startAudioStatusCheck() {
    // Check audio status every 5 seconds
    this._audioStatusCheck = setInterval(() => {
      if (this._view && this._view.webview && this._currentAudioState) {
        this._view.webview.postMessage({
          command: "audioStatus",
          isPlaying: this._audioProcess !== null,
          audioState: this._currentAudioState,
        });
      }
    }, 5000);
  }

  _startReminderSystem() {
    console.log("Starting 5-minute reminder system");
    // Start 5-minute interval (300,000 milliseconds)
    this._reminderInterval = setInterval(() => {
      this._playReminderIfQuranNotActive();
    }, 300000); // 5 minutes

    // Also play immediately after 5 minutes from start
    setTimeout(() => {
      this._playReminderIfQuranNotActive();
    }, 300000);
  }

  _playReminderIfQuranNotActive() {
    // Only play reminder if Quran is NOT currently playing
    if (!this._currentAudioState || !this._audioProcess) {
      console.log("Playing 5-minute reminder - Quran is not active");
      this._playReminderAudio();
    } else {
      console.log("Skipping 5-minute reminder - Quran is currently playing");
    }
  }

  _playReminderAudio() {
    try {
      // Stop any existing reminder audio
      this._stopReminderAudio();

      // Get the sound file path
      const soundFilePath = path.join(
        this._context.extensionPath,
        "sounds",
        "salah-notification.mp3"
      );

      console.log("Playing reminder sound:", soundFilePath);
      const platform = process.platform;

      if (platform === "win32") {
        // Windows
        this._reminderAudioProcess = spawn("powershell", [
          "-c",
          `(New-Object Media.SoundPlayer "${soundFilePath}").PlaySync();`,
        ]);
      } else if (platform === "darwin") {
        // macOS
        this._reminderAudioProcess = spawn("afplay", [soundFilePath]);
      } else {
        // Linux/Unix - try different audio players
        const audioPlayers = ["mpg123", "mpg321", "play", "aplay", "cvlc"];

        for (const player of audioPlayers) {
          try {
            if (player === "play") {
              this._reminderAudioProcess = spawn("play", [soundFilePath]);
            } else if (player === "aplay") {
              this._reminderAudioProcess = spawn("aplay", [soundFilePath]);
            } else if (player === "cvlc") {
              this._reminderAudioProcess = spawn("cvlc", [
                "--intf",
                "dummy",
                "--play-and-exit",
                soundFilePath,
              ]);
            } else {
              this._reminderAudioProcess = spawn(player, ["-q", soundFilePath]);
            }
            break;
          } catch (error) {
            console.log(`Failed to start ${player} for reminder:`, error);
            continue;
          }
        }
      }

      if (this._reminderAudioProcess) {
        console.log("Reminder audio process started");

        // Handle process completion
        this._reminderAudioProcess.on("close", (code) => {
          console.log("Reminder audio process finished with code:", code);
          this._reminderAudioProcess = null;
        });

        this._reminderAudioProcess.on("error", (error) => {
          console.log("Reminder audio process error:", error);
          this._reminderAudioProcess = null;
        });

        // Show a subtle notification
        vscode.window.showInformationMessage("هل صليت على النبي ﷺ اليوم 🤍؟", {
          modal: false,
        });
      } else {
        console.log("No suitable audio player found for reminder");
      }
    } catch (error) {
      console.log("Error playing reminder audio:", error);
    }
  }

  _stopReminderAudio() {
    if (this._reminderAudioProcess) {
      console.log("Stopping reminder audio process");
      this._reminderAudioProcess.kill();
      this._reminderAudioProcess = null;
    }
  }

  _stopReminderSystem() {
    if (this._reminderInterval) {
      console.log("Stopping reminder system");
      clearInterval(this._reminderInterval);
      this._reminderInterval = null;
    }
    this._stopReminderAudio();
  }

  _handleAzkarChanged(azkar) {
    const config = this._getConfiguration();
    if (config.enableAzkarNotifications) {
      // Show the azkar notification
      const notification = vscode.window.showInformationMessage(
        `${azkar.arabic}`,
        "View in Panel"
      );

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        // Since we can't directly dismiss VS Code notifications,
        // we'll show a subtle "notification ended" message to replace it
        vscode.window.showInformationMessage("Azkar notification ended");
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
      enableQuranAudio: config.get("enableQuranAudio", true),
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
					padding: 20px 0;
					border-bottom: 2px solid var(--vscode-panel-border);
					position: relative;
					background: linear-gradient(135deg, var(--vscode-sideBar-background) 0%, var(--vscode-editor-background) 100%);
					border-radius: 8px;
				}
				
				.settings-button {
					position: absolute;
					top: 15px;
					right: 15px;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 8px 12px;
					border-radius: 6px;
					cursor: pointer;
					font-size: 0.8em;
					transition: all 0.3s ease;
					display: flex;
					align-items: center;
					gap: 6px;
					box-shadow: 0 2px 4px rgba(0,0,0,0.1);
				}
				
				.settings-button:hover {
					background-color: var(--vscode-button-hoverBackground);
					transform: translateY(-1px);
					box-shadow: 0 4px 8px rgba(0,0,0,0.15);
				}
				
				.logo {
					width: 88px;
					height: 88px;
					border-radius: 8px;
					object-fit: contain;
				}
				
				.title {
					font-size: 1.3em;
					font-weight: bold;
					color: var(--vscode-editor-foreground);
					margin: 0px 5px 0;
				}
				
				.section {
					margin: 20px 0;
					padding: 20px;
					border: 1px solid var(--vscode-panel-border);
					border-radius: 12px;
					background-color: var(--vscode-sideBar-background);
					box-shadow: 0 2px 8px rgba(0,0,0,0.05);
					transition: all 0.3s ease;
				}
				
				.section:hover {
					border-color: var(--vscode-textLink-foreground);
					transform: translateY(-2px);
					box-shadow: 0 4px 12px rgba(0,0,0,0.1);
				}
				
				.section-title {
					font-size: 1.1em;
					font-weight: bold;
					color: var(--vscode-textLink-foreground);
					margin-bottom: 15px;
					display: flex;
					align-items: center;
					gap: 8px;
					padding-bottom: 8px;
					border-bottom: 1px solid var(--vscode-panel-border);
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
					padding: 8px 14px;
					border-radius: 6px;
					cursor: pointer;
					font-size: 0.85em;
					transition: all 0.3s ease;
					display: flex;
					align-items: center;
					gap: 6px;
				}
				
				.location-button:hover {
					background-color: var(--vscode-button-hoverBackground);
					transform: translateY(-1px);
				}
				
				.loading {
					text-align: center;
					color: var(--vscode-textLink-foreground);
					font-style: italic;
					margin: 20px 0;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 8px;
				}
				
				.loading::before {
					content: '';
					width: 16px;
					height: 16px;
					border: 2px solid var(--vscode-panel-border);
					border-top: 2px solid var(--vscode-textLink-foreground);
					border-radius: 50%;
					animation: spin 1s linear infinite;
				}
				
				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
				
				.error-message {
					text-align: center;
					color: var(--vscode-errorForeground);
					margin: 20px 0;
					padding: 12px;
					background-color: var(--vscode-inputValidation-errorBackground);
					border: 1px solid var(--vscode-inputValidation-errorBorder);
					border-radius: 6px;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 8px;
				}
				
				.error-message::before {
					content: '';
					width: 16px;
					height: 16px;
					background-color: var(--vscode-errorForeground);
					border-radius: 50%;
					flex-shrink: 0;
					position: relative;
				}
				
				.error-message::before::after {
					content: '!';
					position: absolute;
					color: var(--vscode-editor-background);
					font-weight: bold;
					font-size: 12px;
					top: 50%;
					left: 50%;
					transform: translate(-50%, -50%);
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
					padding: 10px 18px;
					border-radius: 6px;
					cursor: pointer;
					font-size: 0.9em;
					margin-top: 15px;
					transition: all 0.3s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 8px;
				}
				
				.refresh-button:hover {
					background-color: var(--vscode-button-hoverBackground);
					transform: translateY(-1px);
				}
				
				/* Pomodoro Section */
				.pomodoro-container {
					text-align: center;
				}
				
				.timer-display {
					font-size: 2.5em;
					font-weight: bold;
					color: var(--vscode-terminal-ansiGreen);
					margin: 15px 0;
					font-family: 'Courier New', monospace;
				}
				
				.timer-display.break {
					color: var(--vscode-terminal-ansiRed);
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
					margin-top: 30px;
					padding: 20px 0;
					border-top: 1px solid var(--vscode-panel-border);
					text-align: center;
					font-size: 0.8em;
					color: var(--vscode-descriptionForeground);
					background: linear-gradient(135deg, var(--vscode-sideBar-background) 0%, var(--vscode-editor-background) 100%);
					border-radius: 8px;
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
					padding: 6px;
					border-radius: 4px;
					font-size: 0.8em;
					transition: background-color 0.3s ease;
					display: flex;
					align-items: center;
					justify-content: center;
				}
				
				.todo-edit-btn:hover {
					background-color: var(--vscode-toolbar-hoverBackground);
				}
				
				.todo-delete-btn:hover {
					background-color: var(--vscode-inputValidation-errorBackground);
				}
				
				.todo-edit-btn svg,
				.todo-delete-btn svg {
					stroke: var(--vscode-foreground);
					transition: stroke 0.3s ease;
				}
				
				.todo-edit-btn:hover svg {
					stroke: var(--vscode-textLink-activeForeground);
				}
				
				.todo-delete-btn:hover svg {
					stroke: var(--vscode-errorForeground);
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
				
				/* Quran Audio Section */
				.quran-container {
					display: flex;
					flex-direction: column;
					gap: 15px;
				}
				
				.quran-selection {
					display: flex;
					flex-direction: column;
					gap: 12px;
				}
				
				.selection-group {
					display: flex;
					flex-direction: column;
					gap: 5px;
				}
				
				.selection-group label {
					font-weight: bold;
					color: var(--vscode-textLink-foreground);
					font-size: 0.9em;
				}
				
				.selection-group select {
					padding: 8px 12px;
					border: 1px solid var(--vscode-input-border);
					border-radius: 4px;
					background-color: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					font-size: 0.9em;
					cursor: pointer;
					transition: border-color 0.3s ease;
				}
				
				.selection-group select:focus {
					outline: none;
					border-color: var(--vscode-focusBorder);
				}
				
				.audio-controls {
					display: flex;
					gap: 10px;
					justify-content: center;
					flex-wrap: wrap;
					margin-top: 15px;
				}
				
				.audio-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 10px 16px;
					border-radius: 6px;
					cursor: pointer;
					font-size: 0.9em;
					font-weight: bold;
					transition: all 0.3s ease;
					min-width: 80px;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 5px;
				}
				
				.audio-button:hover:not(:disabled) {
					background-color: var(--vscode-button-hoverBackground);
					transform: translateY(-1px);
				}
				
				.audio-button:disabled {
					background-color: var(--vscode-button-secondaryBackground);
					color: var(--vscode-descriptionForeground);
					cursor: not-allowed;
					opacity: 0.6;
				}
				
				.audio-info {
					margin-top: 15px;
					padding: 12px;
					background-color: var(--vscode-textBlockQuote-background);
					border-radius: 6px;
					border-left: 4px solid var(--vscode-textLink-foreground);
				}
				
				.current-playing {
					text-align: center;
					font-size: 0.9em;
					color: var(--vscode-editor-foreground);
				}
				
				.current-playing strong {
					color: var(--vscode-textLink-activeForeground);
				}
				
				#quranAudio {
					border-radius: 6px;
					background-color: var(--vscode-panel-background);
				}
				
				/* Loading animation for audio controls */
				.loading {
					animation: pulse 1.5s ease-in-out infinite;
				}
				
				@keyframes pulse {
					0% { opacity: 1; }
					50% { opacity: 0.5; }
					100% { opacity: 1; }
				}
				
				/* Icon Styles */
				.section-icon {
					width: 20px;
					height: 20px;
					margin-right: 8px;
					filter: invert(0.5) sepia(1) saturate(5) hue-rotate(175deg);
					transition: filter 0.3s ease;
				}
				
				.button-icon {
					width: 16px;
					height: 16px;
					margin-right: 6px;
					filter: brightness(0) saturate(100%) invert(100%);
					transition: filter 0.3s ease;
				}
				
				.inline-icon {
					width: 16px;
					height: 16px;
					display: inline-block;
					vertical-align: middle;
					margin: 0 4px;
					filter: invert(0.7);
				}
				
				.settings-button:hover .button-icon {
					filter: brightness(0) saturate(100%) invert(100%) drop-shadow(0 0 2px currentColor);
				}
				
				.location-button:hover .button-icon,
				.audio-button:hover:not(:disabled) .button-icon,
				.refresh-button:hover .button-icon {
					filter: brightness(0) saturate(100%) invert(100%) drop-shadow(0 0 2px currentColor);
				}
				
				/* Dark theme icon adjustments */
				@media (prefers-color-scheme: dark) {
					.section-icon {
						filter: invert(0.8) sepia(1) saturate(3) hue-rotate(175deg);
					}
					
					.inline-icon {
						filter: invert(0.9);
					}
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
				<button class="settings-button" onclick="openSettings()" title="Settings">
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "settings.svg"
                  )
                )
              : ""
          }" alt="Settings" class="button-icon">
				</button>
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
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "prayer-time.svg"
                  )
                )
              : ""
          }" alt="Prayer Time" class="section-icon">
					Next Prayer Time
				</div>
				<div class="azan-info">
					<div id="locationStatus" class="location-status">
						<span id="locationText">
							<img src="${
                this._view
                  ? this._view.webview.asWebviewUri(
                      vscode.Uri.joinPath(
                        this._context.extensionUri,
                        "icons",
                        "globe.svg"
                      )
                    )
                  : ""
              }" alt="Globe" class="inline-icon"> Location not set
						</span>
						<button class="location-button" onclick="requestLocation()">
							<img src="${
                this._view
                  ? this._view.webview.asWebviewUri(
                      vscode.Uri.joinPath(
                        this._context.extensionUri,
                        "icons",
                        "location.svg"
                      )
                    )
                  : ""
              }" alt="Location" class="button-icon"> Set Location
						</button>
					</div>
					<div id="loadingIndicator" class="loading" style="display: none;">
						Loading prayer times...
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
						Unable to fetch prayer times. Please check your location settings.
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
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "azkar.svg"
                  )
                )
              : ""
          }" alt="Azkar" class="section-icon">
					Daily Azkar
				</div>
				<div class="azkar-content">
					<div class="azkar-text" id="azkarText">
						سُبْحَانَ اللَّهِ وَبِحَمْدِهِ
					</div>
					<button class="refresh-button" onclick="getRandomAzkar()">
						<img src="${
              this._view
                ? this._view.webview.asWebviewUri(
                    vscode.Uri.joinPath(
                      this._context.extensionUri,
                      "icons",
                      "refresh.svg"
                    )
                  )
                : ""
            }" alt="Refresh" class="button-icon"> New Azkar
					</button>
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
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "pomodoro.svg"
                  )
                )
              : ""
          }" alt="Pomodoro" class="section-icon">
					Focus Timer
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
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "tasks.svg"
                  )
                )
              : ""
          }" alt="Tasks" class="section-icon">
					Programming Tasks
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
			
			${
        config.enableQuranAudio
          ? `
			<!-- Quran Audio Section -->
			<div class="section">
				<div class="section-title">
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "quran.svg"
                  )
                )
              : ""
          }" alt="Quran" class="section-icon">
					Quran Audio Player
				</div>
				<div class="quran-container">
					<div class="quran-selection">
						<div class="selection-group">
							<label for="surahSelect">Select Surah:</label>
							<select id="surahSelect" onchange="handleSurahChange()">
								<option value="">Choose a Surah...</option>
							</select>
						</div>
						
						<div class="selection-group">
							<label for="reciterSelect">Select Reciter:</label>
							<select id="reciterSelect">
								<option value="mishari">Mishary Rashid Al-Afasy</option>
								<option value="maher">Maher Al-Muaiqly</option>
								<option value="sudais">Abdul Rahman Al-Sudais</option>
								<option value="shuraim">Saud Al-Shuraim</option>
								<option value="ghamdi">Saad Al-Ghamdi</option>
								<option value="husary">Mahmoud Khalil Al-Husary</option>
							</select>
						</div>
					</div>
					
					<div class="audio-controls">
						<button class="audio-button" id="playBtn" onclick="playQuranAudio()" disabled>
							<img src="${
                this._view
                  ? this._view.webview.asWebviewUri(
                      vscode.Uri.joinPath(
                        this._context.extensionUri,
                        "icons",
                        "play.svg"
                      )
                    )
                  : ""
              }" alt="Play" class="button-icon">
							<span id="playBtnText">Play</span>
						</button>
						<button class="audio-button" id="stopBtn" onclick="stopQuranAudio()" disabled>
							<img src="${
                this._view
                  ? this._view.webview.asWebviewUri(
                      vscode.Uri.joinPath(
                        this._context.extensionUri,
                        "icons",
                        "stop.svg"
                      )
                    )
                  : ""
              }" alt="Stop" class="button-icon">
							Stop
						</button>
						<button class="audio-button" id="downloadBtn" onclick="downloadQuranAudio()" disabled>
							<img src="${
                this._view
                  ? this._view.webview.asWebviewUri(
                      vscode.Uri.joinPath(
                        this._context.extensionUri,
                        "icons",
                        "download.svg"
                      )
                    )
                  : ""
              }" alt="Download" class="button-icon">
							Download
						</button>
					</div>
					
					<div class="audio-info" id="audioInfo">
						<div class="current-playing" id="currentPlaying" style="display: none;">
							<strong>Now Playing:</strong> <span id="playingText"></span>
							<br><small id="audioModeText">🔊 Audio playing in background - will continue even when switching panels</small>
						</div>
					</div>
					
					<audio id="quranAudio" controls style="width: 100%; margin-top: 15px; display: none;">
						Your browser does not support the audio element.
					</audio>
				</div>
			</div>
			`
          : ""
      }
			
			<div class="footer">
				<p>Islamic Shoky Extension v1.2.0</p>
				<p>Stay focused, stay blessed 
					<img src="${
            this._view
              ? this._view.webview.asWebviewUri(
                  vscode.Uri.joinPath(
                    this._context.extensionUri,
                    "icons",
                    "islamic.svg"
                  )
                )
              : ""
          }" alt="Islamic" class="inline-icon">
				</p>
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
		translation: 'Glory be to Allah and praise be to Him.'
	},
	{
		arabic: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
		translation: 'There is no god but Allah, alone, without partner. To Him belongs all sovereignty and praise, and He is over all things competent.'
	},
	{
		arabic: 'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ',
		translation: 'I seek the forgiveness of Allah and repent to Him.'
	},
	{
		arabic: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ',
		translation: 'O Allah, send blessings and peace upon our Prophet Muhammad.'
	},
	{
		arabic: 'سُبْحَانَ اللَّهِ الْعَظِيمِ وَبِحَمْدِهِ',
		translation: 'Glory be to Allah, the Magnificent, and praise be to Him.'
	},
	{
		arabic: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
		translation: 'There is no might nor power except with Allah.'
	},
	{
		arabic: 'سُبْحَانَ اللَّهِ',
		translation: 'Glory be to Allah.'
	},
	{
		arabic: 'الْحَمْدُ لِلَّهِ',
		translation: 'Praise be to Allah.'
	},
	{
		arabic: 'اللَّهُ أَكْبَرُ',
		translation: 'Allah is the Greatest.'
	},
	{
		arabic: 'لَا إِلَهَ إِلَّا اللَّهُ',
		translation: 'There is no god but Allah.'
	},
	{
		arabic: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ',
		translation: 'O Allah, You are my Lord. There is none worthy of worship but You. You created me and I am your slave. I am upon Your covenant and promise as much as I can. I seek refuge in You from the evil I have done. I acknowledge Your blessings upon me and I acknowledge my sin. So forgive me, for none forgives sins but You.'
	},
	{
		arabic: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
		translation: 'In the Name of Allah, with Whose Name nothing on earth or in the heavens can cause harm, and He is the All-Hearing, the All-Knowing.'
	},
	{
		arabic: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
		translation: 'I seek refuge in the perfect words of Allah from the evil of what He has created.'
	},
	{
		arabic: 'رَضِيتُ بِاللَّهِ رَبًّا وَبِالْإِسْلَامِ دِينًا وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا',
		translation: 'I am pleased with Allah as my Lord, with Islam as my religion, and with Muhammad (peace be upon him) as my Prophet.'
	},
	{
		arabic: 'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ أَصْلِحْ لِي شَأْنِي كُلَّهُ وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ',
		translation: 'O Ever-Living, O Sustainer of all that exists, by Your mercy I seek help; rectify all my affairs and do not leave me to myself even for the blink of an eye.'
	},
	{
		arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا وَرِزْقًا طَيِّبًا وَعَمَلًا مُتَقَبَّلًا',
		translation: 'O Allah, I ask You for beneficial knowledge, goodly provision, and acceptable deeds.'
	},
	{
		arabic: 'اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَهَ إِلَّا أَنْتَ',
		translation: 'O Allah, make me healthy in my body. O Allah, preserve for me my hearing. O Allah, preserve for me my sight. There is no god but You.'
	},
	{
		arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ وَغَلَبَةِ الرِّجَالِ',
		translation: 'O Allah, I seek refuge in You from anxiety and sorrow, weakness and laziness, miserliness and cowardice, the burden of debts and being overpowered by men.'
	},
	{
		arabic: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ',
		translation: 'Our Lord, give us in this world [that which is] good and in the Hereafter [that which is] good and protect us from the punishment of the Fire.'
	},
	{
		arabic: 'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي وَاحْلُلْ عُقْدَةً مِنْ لِسَانِي يَفْقَهُوا قَوْلِي',
		translation: 'My Lord, expand for me my breast, ease for me my task, and untie the knot from my tongue that they may understand my speech.'
	},
	{
		arabic: 'لَا إِلَهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ',
		translation: 'There is no deity except You; exalted are You. Indeed, I have been of the wrongdoers.'
	},
	{
		arabic: 'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',
		translation: 'Allah is sufficient for me. There is no god but Him. In Him I have placed my trust, and He is the Lord of the Magnificent Throne.'
	},
	{
		arabic: 'اللَّهُمَّ اكْفِنِي بِحَلَالِكَ عَنْ حَرَامِكَ وَأَغْنِنِي بِفَضْلِكَ عَمَّنْ سِوَاكَ',
		translation: 'O Allah, suffice me with Your lawful against Your unlawful, and make me independent of all others besides You.'
	},
	{
		arabic: 'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي',
		translation: 'O Allah, You are Pardoning, You love to pardon, so pardon me.'
	},
	{
		arabic: 'رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِنْ لَدُنْكَ رَحْمَةً إِنَّكَ أَنْتَ الْوَهَّابُ',
		translation: 'Our Lord, let not our hearts deviate after You have guided us and grant us from Yourself mercy. Indeed, You are the Bestower.'
	},
	{
		arabic: 'رَبَّنَا اغْفِرْ لِي وَلِوَالِدَيَّ وَلِلْمُؤْمِنِينَ يَوْمَ يَقُومُ الْحِسَابُ',
		translation: 'Our Lord, forgive me and my parents and the believers the Day the account is established.'
	},
	{
		arabic: 'رَبِّ زِدْنِي عِلْمًا',
		translation: 'My Lord, increase me in knowledge.'
	},
	{
		arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْجَنَّةَ وَأَعُوذُ بِكَ مِنَ النَّارِ',
		translation: 'O Allah, I ask You for Paradise and seek Your protection from the Fire.'
	},
	{
		arabic: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ',
		translation: 'O Allah, help me to remember You, to give You thanks, and to worship You in the best of manners.'
	},
	{
		arabic: 'اللَّهُمَّ يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَى دِينِكَ',
		translation: 'O Allah, O Changer of the hearts, make my heart firm upon Your religion.'
	},
	{
		arabic: 'سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ أَشْهَدُ أَنْ لَا إِلَهَ إِلَّا أَنْتَ أَسْتَغْفِرُكَ وَأَتُوبُ إِلَيْكَ',
		translation: 'Glory is to You, O Allah, and praise. I bear witness that there is no god but You. I seek Your forgiveness and turn to You in repentance.'
	},
	{
		arabic: 'رَبِّ اغْفِرْ لِي وَارْحَمْنِي وَاهْدِنِي وَعَافِنِي وَارْزُقْنِي',
		translation: 'My Lord, forgive me, have mercy on me, guide me, grant me well-being, and provide for me.'
	},
	{
		arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',
		translation: 'Praise is to Allah Who gives us life after He has caused us to die and to Him is the resurrection.'
	},
	{
		arabic: 'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا',
		translation: 'In Your name O Allah, I die and I live.'
	},
	{
		arabic: 'بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
		translation: 'In the Name of Allah, I have placed my trust in Allah, there is no might and no power except with Allah.'
	},
	{
		arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ زَوَالِ نِعْمَتِكَ، وَتَحَوُّلِ عَافِيَتِكَ، وَفُجَاءَةِ نِقْمَتِكَ، وَجَمِيعِ سَخَطِكَ',
		translation: 'O Allah, I seek refuge in You from the withdrawal of Your blessing, from the loss of the well-being that You granted me, from the sudden revenge of You, and from all Your wrath.'
	},
	{
		arabic: 'رَبَّنَا هَبْ لَنَا مِنْ أَزْوَاجِنَا وَذُرِّيَّاتِنَا قُرَّةَ أَعْيُنٍ وَاجْعَلْنَا لِلْمُتَّقِينَ إِمَامًا',
		translation: 'Our Lord, grant us from among our wives and offspring comfort to our eyes and make us a leader for the righteous.'
	},
	{
		arabic: 'اللَّهُمَّ اجْعَلْ فِي قَلْبِي نُورًا، وَفِي لِسَانِي نُورًا، وَفِي سَمْعِي نُورًا، وَفِي بَصَرِي نُورًا',
		translation: 'O Allah, place light in my heart, and on my tongue light, and in my hearing light, and in my sight light.'
	},
	{
		arabic: 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ',
		translation: 'I seek refuge in Allah from the accursed Satan.'
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
				
				// Quran Audio Variables
				let currentAudioUrl = null;
				let isPlaying = false;
				let quranData = null;
				
				// Initialize
				initializeAzkar();
				getRandomAzkar();
				updateTimerDisplay();
				loadTodos();
				initializeQuranPlayer();
				
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
							
							// Only stop audio if preserveAudio is false
							if (!message.preserveAudio && isPlaying) {
								const audio = document.getElementById('quranAudio');
								if (audio) {
									audio.pause();
									isPlaying = false;
								}
							}
							break;
						case 'requestCurrentLocation':
							// Send current location data to extension
							vscode.postMessage({
								command: 'locationDataResponse',
								location: userLocation
							});
							break;
						case 'requestCurrentTasks':
							// Send current tasks data to extension
							vscode.postMessage({
								command: 'tasksDataResponse',
								tasks: todos
							});
							break;
						case 'addTaskToList':
							// Add task to the list
							console.log('Webview received addTaskToList:', message);
							if (message.task) {
								const newTask = {
									id: Date.now(),
									text: message.task.text,
									completed: message.task.completed || false
								};
								console.log('Adding new task:', newTask);
								todos.push(newTask);
								saveTodos();
								renderTodos();
								updateStats();
								// Notify tasks provider
								vscode.postMessage({
									command: 'tasksUpdated',
									tasks: todos
								});
							}
							break;
						case 'restoreAudioState':
							// Restore previous audio state if it exists
							if (message.audioState && extensionConfig.enableQuranAudio) {
								const surahSelect = document.getElementById('surahSelect');
								const reciterSelect = document.getElementById('reciterSelect');
								
								if (surahSelect && reciterSelect) {
									// Set the previous selection
									surahSelect.value = message.audioState.surah;
									reciterSelect.value = message.audioState.reciter;
									
									// Show a notification that audio state was preserved
									showQuranMessage('Audio session restored. You can continue playback.');
									
									// Enable play button
									handleSurahChange();
								}
							}
							break;
						case 'toggleTaskInList':
							// Toggle task completion
							console.log('Webview received toggleTaskInList:', message.taskId);
							const toggleIndex = todos.findIndex(t => t.id === message.taskId);
							console.log('Toggle index found:', toggleIndex, 'for taskId:', message.taskId);
							if (toggleIndex !== -1) {
								todos[toggleIndex].completed = !todos[toggleIndex].completed;
								saveTodos();
								renderTodos();
								updateStats();
								// Notify tasks provider
								vscode.postMessage({
									command: 'tasksUpdated',
									tasks: todos
								});
							}
							break;
						case 'deleteTaskFromList':
							// Delete task
							console.log('Webview received deleteTaskFromList:', message.taskId);
							const deleteIndex = todos.findIndex(t => t.id === message.taskId);
							console.log('Delete index found:', deleteIndex, 'for taskId:', message.taskId);
							if (deleteIndex !== -1) {
								todos.splice(deleteIndex, 1);
								saveTodos();
								renderTodos();
								updateStats();
								// Notify tasks provider
								vscode.postMessage({
									command: 'tasksUpdated',
									tasks: todos
								});
							}
							break;
						case 'audioEnded':
							// Audio playback ended
							isPlaying = false;
							const playBtnText = document.getElementById('playBtnText');
							const stopBtn = document.getElementById('stopBtn');
							const currentPlaying = document.getElementById('currentPlaying');
							
							if (playBtnText) playBtnText.textContent = 'Play';
							if (stopBtn) stopBtn.disabled = true;
							if (currentPlaying) currentPlaying.style.display = 'none';
							
							showQuranMessage('Audio playback completed.');
							break;
						case 'audioStopped':
							// Audio was stopped
							isPlaying = false;
							const playBtn2 = document.getElementById('playBtnText');
							const stopBtn2 = document.getElementById('stopBtn');
							const currentPlaying2 = document.getElementById('currentPlaying');
							
							if (playBtn2) playBtn2.textContent = 'Play';
							if (stopBtn2) stopBtn2.disabled = true;
							if (currentPlaying2) currentPlaying2.style.display = 'none';
							break;
						case 'playWebviewAudio':
							// Fallback to webview audio when system audio fails
							playWebviewAudioFallback(message.audioUrl, message.surah, message.reciter);
							break;
						case 'audioStatus':
							// Update audio status from background
							if (message.isPlaying !== isPlaying) {
								isPlaying = message.isPlaying;
								const playBtnText3 = document.getElementById('playBtnText');
								const stopBtn3 = document.getElementById('stopBtn');
								
								if (playBtnText3) {
									playBtnText3.textContent = isPlaying ? 'Stop' : 'Play';
								}
								if (stopBtn3) {
									stopBtn3.disabled = !isPlaying;
								}
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
					// Notify extension that location has been updated
					vscode.postMessage({
						command: 'locationUpdated',
						location: userLocation
					});
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
					
					// Notify extension about loaded tasks
					vscode.postMessage({
						command: 'tasksUpdated',
						tasks: todos
					});
				}
				
				function saveTodos() {
					localStorage.setItem('islamicShokyTodos', JSON.stringify(todos));
					// Notify extension about task updates
					vscode.postMessage({
						command: 'tasksUpdated',
						tasks: todos
					});
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
										<button class="todo-edit-btn" onclick="saveEdit(\${todo.id})" title="Save">
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<polyline points="20,6 9,17 4,12"/>
											</svg>
										</button>
										<button class="todo-edit-btn" onclick="cancelEdit()" title="Cancel">
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<line x1="18" y1="6" x2="6" y2="18"/>
												<line x1="6" y1="6" x2="18" y2="18"/>
											</svg>
										</button>
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
										<button class="todo-edit-btn" onclick="editTodo(\${todo.id})" title="Edit">
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
											</svg>
										</button>
										<button class="todo-delete-btn" onclick="deleteTodo(\${todo.id})" title="Delete">
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<polyline points="3,6 5,6 21,6"/>
												<path d="M19,6V20a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
												<line x1="10" y1="11" x2="10" y2="17"/>
												<line x1="14" y1="11" x2="14" y2="17"/>
											</svg>
										</button>
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
				
				// Quran Audio Player Functions
				async function initializeQuranPlayer() {
					try {
						await loadQuranData();
						populateSelectionOptions();
					} catch (error) {
						console.error('Failed to initialize Quran player:', error);
					}
				}
				
				async function loadQuranData() {
					// Quran data with surah, juz, and hizb information
					quranData = {
						surahs: [
							{ id: 1, name: "Al-Fatiha (الفاتحة)", arabicName: "الفاتحة", englishName: "The Opening", juz: 1, hizb: 1 },
							{ id: 2, name: "Al-Baqarah (البقرة)", arabicName: "البقرة", englishName: "The Cow", juz: 1, hizb: 1 },
							{ id: 3, name: "Al Imran (آل عمران)", arabicName: "آل عمران", englishName: "The Family of Imran", juz: 3, hizb: 5 },
							{ id: 4, name: "An-Nisa (النساء)", arabicName: "النساء", englishName: "The Women", juz: 4, hizb: 7 },
							{ id: 5, name: "Al-Ma'idah (المائدة)", arabicName: "المائدة", englishName: "The Table", juz: 6, hizb: 11 },
							{ id: 6, name: "Al-An'am (الأنعام)", arabicName: "الأنعام", englishName: "The Cattle", juz: 7, hizb: 13 },
							{ id: 7, name: "Al-A'raf (الأعراف)", arabicName: "الأعراف", englishName: "The Heights", juz: 8, hizb: 15 },
							{ id: 8, name: "Al-Anfal (الأنفال)", arabicName: "الأنفال", englishName: "The Spoils of War", juz: 9, hizb: 17 },
							{ id: 9, name: "At-Tawbah (التوبة)", arabicName: "التوبة", englishName: "The Repentance", juz: 10, hizb: 19 },
							{ id: 10, name: "Yunus (يونس)", arabicName: "يونس", englishName: "Jonah", juz: 11, hizb: 21 },
							{ id: 11, name: "Hud (هود)", arabicName: "هود", englishName: "Hud", juz: 11, hizb: 21 },
							{ id: 12, name: "Yusuf (يوسف)", arabicName: "يوسف", englishName: "Joseph", juz: 12, hizb: 23 },
							{ id: 13, name: "Ar-Ra'd (الرعد)", arabicName: "الرعد", englishName: "The Thunder", juz: 13, hizb: 25 },
							{ id: 14, name: "Ibrahim (ابراهيم)", arabicName: "ابراهيم", englishName: "Abraham", juz: 13, hizb: 25 },
							{ id: 15, name: "Al-Hijr (الحجر)", arabicName: "الحجر", englishName: "The Rock", juz: 14, hizb: 27 },
							{ id: 16, name: "An-Nahl (النحل)", arabicName: "النحل", englishName: "The Bee", juz: 14, hizb: 27 },
							{ id: 17, name: "Al-Isra (الإسراء)", arabicName: "الإسراء", englishName: "The Night Journey", juz: 15, hizb: 29 },
							{ id: 18, name: "Al-Kahf (الكهف)", arabicName: "الكهف", englishName: "The Cave", juz: 15, hizb: 29 },
							{ id: 19, name: "Maryam (مريم)", arabicName: "مريم", englishName: "Mary", juz: 16, hizb: 31 },
							{ id: 20, name: "Ta-Ha (طه)", arabicName: "طه", englishName: "Ta-Ha", juz: 16, hizb: 31 },
							{ id: 21, name: "Al-Anbiya (الأنبياء)", arabicName: "الأنبياء", englishName: "The Prophets", juz: 17, hizb: 33 },
							{ id: 22, name: "Al-Hajj (الحج)", arabicName: "الحج", englishName: "The Pilgrimage", juz: 17, hizb: 33 },
							{ id: 23, name: "Al-Mu'minun (المؤمنون)", arabicName: "المؤمنون", englishName: "The Believers", juz: 18, hizb: 35 },
							{ id: 24, name: "An-Nur (النور)", arabicName: "النور", englishName: "The Light", juz: 18, hizb: 35 },
							{ id: 25, name: "Al-Furqan (الفرقان)", arabicName: "الفرقان", englishName: "The Criterion", juz: 18, hizb: 35 },
							{ id: 26, name: "Ash-Shu'ara (الشعراء)", arabicName: "الشعراء", englishName: "The Poets", juz: 19, hizb: 37 },
							{ id: 27, name: "An-Naml (النمل)", arabicName: "النمل", englishName: "The Ant", juz: 19, hizb: 37 },
							{ id: 28, name: "Al-Qasas (القصص)", arabicName: "القصص", englishName: "The Stories", juz: 20, hizb: 39 },
							{ id: 29, name: "Al-Ankabut (العنكبوت)", arabicName: "العنكبوت", englishName: "The Spider", juz: 20, hizb: 39 },
							{ id: 30, name: "Ar-Rum (الروم)", arabicName: "الروم", englishName: "The Byzantines", juz: 21, hizb: 41 }
							// Adding more surahs would make this too long, but in a real implementation you'd include all 114
						],
						reciters: {
							mishari: { name: "Mishary Rashid Al-Afasy", arabicName: "مشاري راشد العفاسي", baseUrl: "https://server8.mp3quran.net/afs/" },
							maher: { name: "Maher Al-Muaiqly", arabicName: "ماهر المعيقلي", baseUrl: "https://server12.mp3quran.net/maher/" },
							sudais: { name: "Abdul Rahman Al-Sudais", arabicName: "عبد الرحمن السديس", baseUrl: "https://server11.mp3quran.net/sds/" },
							shuraim: { name: "Saud Al-Shuraim", arabicName: "سعود الشريم", baseUrl: "https://server11.mp3quran.net/shr/" },
							ghamdi: { name: "Saad Al-Ghamdi", arabicName: "سعد الغامدي", baseUrl: "https://server7.mp3quran.net/s_gmd/" },
							husary: { name: "Mahmoud Khalil Al-Husary", arabicName: "محمود خليل الحصري", baseUrl: "https://server13.mp3quran.net/husr/" }
						},
						juzList: Array.from({ length: 30 }, (_, i) => ({
							id: i + 1,
							name: \`Juz \${i + 1} (الجزء \${i + 1})\`,
							arabicName: \`الجزء \${i + 1}\`
						})),
						hizbList: Array.from({ length: 60 }, (_, i) => ({
							id: i + 1,
							name: \`Hizb \${i + 1} (الحزب \${i + 1})\`,
							arabicName: \`الحزب \${i + 1}\`
						}))
					};
				}
				
				function populateSelectionOptions() {
					// Populate surah options
					const surahSelect = document.getElementById('surahSelect');
					if (surahSelect && quranData.surahs) {
						quranData.surahs.forEach(surah => {
							const option = document.createElement('option');
							option.value = surah.id;
							option.textContent = \`\${surah.id}. \${surah.name}\`;
							surahSelect.appendChild(option);
						});
					}
					
					// Populate juz options
					const juzSelect = document.getElementById('juzSelect');
					if (juzSelect && quranData.juzList) {
						quranData.juzList.forEach(juz => {
							const option = document.createElement('option');
							option.value = juz.id;
							option.textContent = juz.name;
							juzSelect.appendChild(option);
						});
					}
					
					// Populate hizb options
					const hizbSelect = document.getElementById('hizbSelect');
					if (hizbSelect && quranData.hizbList) {
						quranData.hizbList.forEach(hizb => {
							const option = document.createElement('option');
							option.value = hizb.id;
							option.textContent = hizb.name;
							hizbSelect.appendChild(option);
						});
					}
				}
				
				function handleSelectionTypeChange() {
					const selectionType = document.getElementById('selectionType').value;
					const surahSelection = document.getElementById('surahSelection');
					const juzSelection = document.getElementById('juzSelection');
					const hizbSelection = document.getElementById('hizbSelection');
					
					// Hide all selections
					surahSelection.style.display = 'none';
					juzSelection.style.display = 'none';
					hizbSelection.style.display = 'none';
					
					// Show selected type
					if (selectionType === 'surah') {
						surahSelection.style.display = 'block';
					} else if (selectionType === 'juz') {
						juzSelection.style.display = 'block';
					} else if (selectionType === 'hizb') {
						hizbSelection.style.display = 'block';
					}
					
					// Reset audio info and controls
					resetAudioPlayer();
					updatePlayButton();
				}
				
				function playQuranAudio() {
					const selectionType = document.getElementById('selectionType').value;
					const reciter = document.getElementById('reciterSelect').value;
					
					let audioUrl = '';
					let playingText = '';
					
					if (selectionType === 'surah') {
						const surahId = document.getElementById('surahSelect').value;
						if (!surahId) {
							showQuranMessage('Please select a Surah first.');
							return;
						}
						
						const surah = quranData.surahs.find(s => s.id == surahId);
						if (surah) {
							audioUrl = buildAudioUrl(reciter, 'surah', surahId);
							playingText = \`\${surah.name}\`;
						}
					} else if (selectionType === 'juz') {
						const juzId = document.getElementById('juzSelect').value;
						if (!juzId) {
							showQuranMessage('Please select a Juz first.');
							return;
						}
						
						audioUrl = buildAudioUrl(reciter, 'juz', juzId);
						playingText = \`Juz \${juzId} (الجزء \${juzId})\`;
					} else if (selectionType === 'hizb') {
						const hizbId = document.getElementById('hizbSelection').value;
						if (!hizbId) {
							showQuranMessage('Please select a Hizb first.');
							return;
						}
						
						audioUrl = buildAudioUrl(reciter, 'hizb', hizbId);
						playingText = \`Hizb \${hizbId} (الحزب \${hizbId})\`;
					}
					
					if (audioUrl) {
						currentAudioUrl = audioUrl;
						const audio = document.getElementById('quranAudio');
						const currentPlayingDiv = document.getElementById('currentPlaying');
						const playingTextSpan = document.getElementById('playingText');
						
						audio.src = audioUrl;
						audio.style.display = 'block';
						currentPlayingDiv.style.display = 'block';
						playingTextSpan.textContent = playingText;
						
						setLoadingState(true);
						
						audio.play().then(() => {
							isPlaying = true;
							updatePlayButton();
							setLoadingState(false);
							showQuranMessage('Playing Quran audio...');
						}).catch(error => {
							console.error('Error playing audio:', error);
							showQuranMessage('Error playing audio. Please check your internet connection.');
							setLoadingState(false);
						});
					}
				}
				
				function stopQuranAudio() {
					const audio = document.getElementById('quranAudio');
					const currentPlayingDiv = document.getElementById('currentPlaying');
					
					audio.pause();
					audio.currentTime = 0;
					audio.style.display = 'none';
					currentPlayingDiv.style.display = 'none';
					
					isPlaying = false;
					currentAudioUrl = null;
					updatePlayButton();
					showQuranMessage('Audio stopped.');
				}
				
				function downloadQuranAudio() {
					if (currentAudioUrl) {
						const link = document.createElement('a');
						link.href = currentAudioUrl;
						link.download = 'quran-audio.mp3';
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						showQuranMessage('Download started...');
					} else {
						showQuranMessage('Please select and play audio first.');
					}
				}
				
				function buildAudioUrl(reciter, type, id) {
					const reciterData = quranData.reciters[reciter];
					if (!reciterData) return '';
					
					let fileName = '';
					if (type === 'surah') {
						fileName = String(id).padStart(3, '0') + '.mp3';
					} else if (type === 'juz') {
						// For juz, we'll use a different API structure
						fileName = \`juz_\${String(id).padStart(2, '0')}.mp3\`;
					} else if (type === 'hizb') {
						// For hizb, we'll use a different API structure  
						fileName = \`hizb_\${String(id).padStart(2, '0')}.mp3\`;
					}
					
					return reciterData.baseUrl + fileName;
				}
				
				function updatePlayButton() {
					const playBtn = document.getElementById('playBtn');
					const stopBtn = document.getElementById('stopBtn');
					const downloadBtn = document.getElementById('downloadBtn');
					const playBtnText = document.getElementById('playBtnText');
					
					const hasSelection = getSelectionId() !== null;
					
					playBtn.disabled = !hasSelection || isPlaying;
					stopBtn.disabled = !isPlaying;
					downloadBtn.disabled = !currentAudioUrl;
					
					if (isPlaying) {
						playBtnText.textContent = '⏸️ Playing...';
					} else {
						playBtnText.textContent = '▶️ Play';
					}
				}
				
				function getSelectionId() {
					const selectionType = document.getElementById('selectionType').value;
					
					if (selectionType === 'surah') {
						return document.getElementById('surahSelect').value;
					} else if (selectionType === 'juz') {
						return document.getElementById('juzSelect').value;
					} else if (selectionType === 'hizb') {
						return document.getElementById('hizbSelect').value;
					}
					
					return null;
				}
				
				function resetAudioPlayer() {
					const audio = document.getElementById('quranAudio');
					const currentPlayingDiv = document.getElementById('currentPlaying');
					
					if (audio) {
						audio.pause();
						audio.src = '';
						audio.style.display = 'none';
					}
					
					if (currentPlayingDiv) {
						currentPlayingDiv.style.display = 'none';
					}
					
					isPlaying = false;
					currentAudioUrl = null;
				}
				
				function setLoadingState(loading) {
					const playBtn = document.getElementById('playBtn');
					const playBtnText = document.getElementById('playBtnText');
					
					if (loading) {
						playBtn.classList.add('loading');
						playBtnText.textContent = '🔄 Loading...';
					} else {
						playBtn.classList.remove('loading');
					}
				}
				
				function showQuranMessage(message) {
					// Create a temporary message for Quran player
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
							if (document.body.contains(messageDiv)) {
								document.body.removeChild(messageDiv);
							}
						}, 300);
					}, 3000);
				}
				
				// Add event listeners for selection changes to update play button
				document.addEventListener('change', function(event) {
					if (event.target.id === 'surahSelect' || 
						event.target.id === 'juzSelect' || 
						event.target.id === 'hizbSelect' || 
						event.target.id === 'reciterSelect') {
						updatePlayButton();
					}
				});
				
				// Listen for audio events
				document.addEventListener('DOMContentLoaded', function() {
					const audio = document.getElementById('quranAudio');
					if (audio) {
						audio.addEventListener('ended', function() {
							isPlaying = false;
							updatePlayButton();
							showQuranMessage('Audio playback completed.');
						});
						
						audio.addEventListener('error', function() {
							isPlaying = false;
							setLoadingState(false);
							updatePlayButton();
							showQuranMessage('Error loading audio. Please try again.');
						});
					}
				});
				// Quran Audio Functions
				function initializeQuranPlayer() {
					if (extensionConfig.enableQuranAudio) {
						loadSurahs();
					}
				}
				
				function loadSurahs() {
					const surahSelect = document.getElementById('surahSelect');
					if (!surahSelect) return;
					
					// List of Quranic Surahs
					const surahs = [
						{number: 1, name: "Al-Fatiha", arabic: "الفاتحة"},
						{number: 2, name: "Al-Baqarah", arabic: "البقرة"},
						{number: 3, name: "Ali 'Imran", arabic: "آل عمران"},
						{number: 4, name: "An-Nisa", arabic: "النساء"},
						{number: 5, name: "Al-Ma'idah", arabic: "المائدة"},
						{number: 6, name: "Al-An'am", arabic: "الأنعام"},
						{number: 7, name: "Al-A'raf", arabic: "الأعراف"},
						{number: 8, name: "Al-Anfal", arabic: "الأنفال"},
						{number: 9, name: "At-Tawbah", arabic: "التوبة"},
						{number: 10, name: "Yunus", arabic: "يونس"},
						{number: 11, name: "Hud", arabic: "هود"},
						{number: 12, name: "Yusuf", arabic: "يوسف"},
						{number: 13, name: "Ar-Ra'd", arabic: "الرعد"},
						{number: 14, name: "Ibrahim", arabic: "ابراهيم"},
						{number: 15, name: "Al-Hijr", arabic: "الحجر"},
						{number: 16, name: "An-Nahl", arabic: "النحل"},
						{number: 17, name: "Al-Isra", arabic: "الإسراء"},
						{number: 18, name: "Al-Kahf", arabic: "الكهف"},
						{number: 19, name: "Maryam", arabic: "مريم"},
						{number: 20, name: "Taha", arabic: "طه"},
						{number: 21, name: "Al-Anbya", arabic: "الأنبياء"},
						{number: 22, name: "Al-Hajj", arabic: "الحج"},
						{number: 23, name: "Al-Mu'minun", arabic: "المؤمنون"},
						{number: 24, name: "An-Nur", arabic: "النور"},
						{number: 25, name: "Al-Furqan", arabic: "الفرقان"},
						{number: 26, name: "Ash-Shu'ara", arabic: "الشعراء"},
						{number: 27, name: "An-Naml", arabic: "النمل"},
						{number: 28, name: "Al-Qasas", arabic: "القصص"},
						{number: 29, name: "Al-'Ankabut", arabic: "العنكبوت"},
						{number: 30, name: "Ar-Rum", arabic: "الروم"},
						{number: 31, name: "Luqman", arabic: "لقمان"},
						{number: 32, name: "As-Sajdah", arabic: "السجدة"},
						{number: 33, name: "Al-Ahzab", arabic: "الأحزاب"},
						{number: 34, name: "Saba", arabic: "سبأ"},
						{number: 35, name: "Fatir", arabic: "فاطر"},
						{number: 36, name: "Ya-Sin", arabic: "يس"},
						{number: 37, name: "As-Saffat", arabic: "الصافات"},
						{number: 38, name: "Sad", arabic: "ص"},
						{number: 39, name: "Az-Zumar", arabic: "الزمر"},
						{number: 40, name: "Ghafir", arabic: "غافر"},
						{number: 41, name: "Fussilat", arabic: "فصلت"},
						{number: 42, name: "Ash-Shuraa", arabic: "الشورى"},
						{number: 43, name: "Az-Zukhruf", arabic: "الزخرف"},
						{number: 44, name: "Ad-Dukhan", arabic: "الدخان"},
						{number: 45, name: "Al-Jathiyah", arabic: "الجاثية"},
						{number: 46, name: "Al-Ahqaf", arabic: "الأحقاف"},
						{number: 47, name: "Muhammad", arabic: "محمد"},
						{number: 48, name: "Al-Fath", arabic: "الفتح"},
						{number: 49, name: "Al-Hujurat", arabic: "الحجرات"},
						{number: 50, name: "Qaf", arabic: "ق"},
						{number: 51, name: "Adh-Dhariyat", arabic: "الذاريات"},
						{number: 52, name: "At-Tur", arabic: "الطور"},
						{number: 53, name: "An-Najm", arabic: "النجم"},
						{number: 54, name: "Al-Qamar", arabic: "القمر"},
						{number: 55, name: "Ar-Rahman", arabic: "الرحمن"},
						{number: 56, name: "Al-Waqi'ah", arabic: "الواقعة"},
						{number: 57, name: "Al-Hadid", arabic: "الحديد"},
						{number: 58, name: "Al-Mujadila", arabic: "المجادلة"},
						{number: 59, name: "Al-Hashr", arabic: "الحشر"},
						{number: 60, name: "Al-Mumtahanah", arabic: "الممتحنة"},
						{number: 61, name: "As-Saff", arabic: "الصف"},
						{number: 62, name: "Al-Jumu'ah", arabic: "الجمعة"},
						{number: 63, name: "Al-Munafiqun", arabic: "المنافقون"},
						{number: 64, name: "At-Taghabun", arabic: "التغابن"},
						{number: 65, name: "At-Talaq", arabic: "الطلاق"},
						{number: 66, name: "At-Tahrim", arabic: "التحريم"},
						{number: 67, name: "Al-Mulk", arabic: "الملك"},
						{number: 68, name: "Al-Qalam", arabic: "القلم"},
						{number: 69, name: "Al-Haqqah", arabic: "الحاقة"},
						{number: 70, name: "Al-Ma'arij", arabic: "المعارج"},
						{number: 71, name: "Nuh", arabic: "نوح"},
						{number: 72, name: "Al-Jinn", arabic: "الجن"},
						{number: 73, name: "Al-Muzzammil", arabic: "المزمل"},
						{number: 74, name: "Al-Muddaththir", arabic: "المدثر"},
						{number: 75, name: "Al-Qiyamah", arabic: "القيامة"},
						{number: 76, name: "Al-Insan", arabic: "الإنسان"},
						{number: 77, name: "Al-Mursalat", arabic: "المرسلات"},
						{number: 78, name: "An-Naba", arabic: "النبأ"},
						{number: 79, name: "An-Nazi'at", arabic: "النازعات"},
						{number: 80, name: "Abasa", arabic: "عبس"},
						{number: 81, name: "At-Takwir", arabic: "التكوير"},
						{number: 82, name: "Al-Infitar", arabic: "الإنفطار"},
						{number: 83, name: "Al-Mutaffifin", arabic: "المطففين"},
						{number: 84, name: "Al-Inshiqaq", arabic: "الإنشقاق"},
						{number: 85, name: "Al-Buruj", arabic: "البروج"},
						{number: 86, name: "At-Tariq", arabic: "الطارق"},
						{number: 87, name: "Al-A'la", arabic: "الأعلى"},
						{number: 88, name: "Al-Ghashiyah", arabic: "الغاشية"},
						{number: 89, name: "Al-Fajr", arabic: "الفجر"},
						{number: 90, name: "Al-Balad", arabic: "البلد"},
						{number: 91, name: "Ash-Shams", arabic: "الشمس"},
						{number: 92, name: "Al-Layl", arabic: "الليل"},
						{number: 93, name: "Ad-Duhaa", arabic: "الضحى"},
						{number: 94, name: "Ash-Sharh", arabic: "الشرح"},
						{number: 95, name: "At-Tin", arabic: "التين"},
						{number: 96, name: "Al-Alaq", arabic: "العلق"},
						{number: 97, name: "Al-Qadr", arabic: "القدر"},
						{number: 98, name: "Al-Bayyinah", arabic: "البينة"},
						{number: 99, name: "Az-Zalzalah", arabic: "الزلزلة"},
						{number: 100, name: "Al-Adiyat", arabic: "العاديات"},
						{number: 101, name: "Al-Qari'ah", arabic: "القارعة"},
						{number: 102, name: "At-Takathur", arabic: "التكاثر"},
						{number: 103, name: "Al-Asr", arabic: "العصر"},
						{number: 104, name: "Al-Humazah", arabic: "الهمزة"},
						{number: 105, name: "Al-Fil", arabic: "الفيل"},
						{number: 106, name: "Quraysh", arabic: "قريش"},
						{number: 107, name: "Al-Ma'un", arabic: "الماعون"},
						{number: 108, name: "Al-Kawthar", arabic: "الكوثر"},
						{number: 109, name: "Al-Kafirun", arabic: "الكافرون"},
						{number: 110, name: "An-Nasr", arabic: "النصر"},
						{number: 111, name: "Al-Masad", arabic: "المسد"},
						{number: 112, name: "Al-Ikhlas", arabic: "الإخلاص"},
						{number: 113, name: "Al-Falaq", arabic: "الفلق"},
						{number: 114, name: "An-Nas", arabic: "الناس"}
					];
					
					// Populate surah dropdown
					surahs.forEach(surah => {
						const option = document.createElement('option');
						option.value = surah.number;
						option.textContent = \`\${surah.number}. \${surah.name} - \${surah.arabic}\`;
						surahSelect.appendChild(option);
					});
				}
				
				function handleSurahChange() {
					const surahSelect = document.getElementById('surahSelect');
					const playBtn = document.getElementById('playBtn');
					const downloadBtn = document.getElementById('downloadBtn');
					
					if (surahSelect.value) {
						playBtn.disabled = false;
						downloadBtn.disabled = false;
					} else {
						playBtn.disabled = true;
						downloadBtn.disabled = true;
					}
				}
				
				function playQuranAudio() {
					const surahSelect = document.getElementById('surahSelect');
					const reciterSelect = document.getElementById('reciterSelect');
					const playBtn = document.getElementById('playBtn');
					const stopBtn = document.getElementById('stopBtn');
					const currentPlaying = document.getElementById('currentPlaying');
					const playingText = document.getElementById('playingText');
					const playBtnText = document.getElementById('playBtnText');
					
					if (!surahSelect.value) {
						showQuranMessage('Please select a Surah first.');
						return;
					}
					
					if (isPlaying) {
						// Stop background audio
						vscode.postMessage({
							command: 'stopQuranBackground'
						});
						return;
					}
					
					const surahNumber = String(surahSelect.value).padStart(3, '0');
					const reciter = reciterSelect.value;
					
					// Get reciter-specific URL pattern
					let audioUrl = '';
					switch (reciter) {
						case 'mishari':
							audioUrl = \`https://server8.mp3quran.net/afs/\${surahNumber}.mp3\`;
							break;
						case 'maher':
							audioUrl = \`https://server12.mp3quran.net/maher/\${surahNumber}.mp3\`;
							break;
						case 'sudais':
							audioUrl = \`https://server11.mp3quran.net/sds/\${surahNumber}.mp3\`;
							break;
						case 'shuraim':
							audioUrl = \`https://server6.mp3quran.net/shur/\${surahNumber}.mp3\`;
							break;
						case 'ghamdi':
							audioUrl = \`https://server7.mp3quran.net/s_gmd/\${surahNumber}.mp3\`;
							break;
						case 'husary':
							audioUrl = \`https://server13.mp3quran.net/husr/\${surahNumber}.mp3\`;
							break;
						default:
							audioUrl = \`https://server8.mp3quran.net/afs/\${surahNumber}.mp3\`;
					}
					
					setLoadingState(true);
					
					// Show playing info
					const surahText = surahSelect.options[surahSelect.selectedIndex].text;
					const reciterText = reciterSelect.options[reciterSelect.selectedIndex].text;
					playingText.textContent = \`\${surahText} by \${reciterText}\`;
					currentPlaying.style.display = 'block';
					
					// Start background audio playback
					vscode.postMessage({
						command: 'playQuranBackground',
						audioUrl: audioUrl,
						surah: surahSelect.value,
						reciter: reciterSelect.value
					});
					
					// Update UI immediately
					isPlaying = true;
					setLoadingState(false);
					playBtnText.textContent = 'Stop';
					stopBtn.disabled = false;
					showQuranMessage('Starting Quran audio...');
				}
				
				function stopQuranAudio() {
					const stopBtn = document.getElementById('stopBtn');
					const currentPlaying = document.getElementById('currentPlaying');
					const playBtnText = document.getElementById('playBtnText');
					
					// Stop background audio
					vscode.postMessage({
						command: 'stopQuranBackground'
					});
					
					// Update UI
					isPlaying = false;
					playBtnText.textContent = '▶️ Play';
					stopBtn.disabled = true;
					currentPlaying.style.display = 'none';
					vscode.postMessage({
						command: 'quranAudioStopped'
					});
					
					showQuranMessage('Audio stopped.');
				}
				
				function playWebviewAudioFallback(audioUrl, surah, reciter) {
					const audio = document.getElementById('quranAudio');
					const playBtn = document.getElementById('playBtn');
					const stopBtn = document.getElementById('stopBtn');
					const currentPlaying = document.getElementById('currentPlaying');
					const playingText = document.getElementById('playingText');
					const playBtnText = document.getElementById('playBtnText');
					const audioModeText = document.getElementById('audioModeText');
					
					console.log('Starting webview audio fallback:', audioUrl);
					
					// Set up audio
					audio.src = audioUrl;
					currentAudioUrl = audioUrl;
					
					// Show playing info with fallback notice
					playingText.textContent = \`Surah \${surah} by \${reciter}\`;
					if (audioModeText) {
						audioModeText.textContent = '🌐 Playing in browser mode (system audio unavailable)';
					}
					currentPlaying.style.display = 'block';
					audio.style.display = 'block';
					
					// Play audio
					audio.play().then(() => {
						isPlaying = true;
						playBtnText.textContent = '⏹️ Stop';
						stopBtn.disabled = false;
						showQuranMessage('Playing Quran audio in browser mode...');
						
						// Set up event listeners for this fallback audio
						audio.addEventListener('ended', function() {
							isPlaying = false;
							playBtnText.textContent = '▶️ Play';
							stopBtn.disabled = true;
							currentPlaying.style.display = 'none';
							audio.style.display = 'none';
							
							vscode.postMessage({
								command: 'quranAudioStopped'
							});
							
							showQuranMessage('Audio playback completed.');
						}, { once: true });
						
						audio.addEventListener('error', function() {
							isPlaying = false;
							setLoadingState(false);
							showQuranMessage('Error loading audio. Please check your internet connection.');
						}, { once: true });
						
					}).catch(error => {
						console.error('Error playing webview audio:', error);
						setLoadingState(false);
						showQuranMessage('Error loading audio. Please check your internet connection.');
					});
				}
				
				function downloadQuranAudio() {
					const surahSelect = document.getElementById('surahSelect');
					const reciterSelect = document.getElementById('reciterSelect');
					
					if (!surahSelect.value) {
						showQuranMessage('Please select a Surah first.');
						return;
					}
					
					const surahNumber = String(surahSelect.value).padStart(3, '0');
					const reciter = reciterSelect.value;
					
					let audioUrl = '';
					switch (reciter) {
						case 'mishari':
							audioUrl = \`https://server8.mp3quran.net/afs/\${surahNumber}.mp3\`;
							break;
						case 'maher':
							audioUrl = \`https://server12.mp3quran.net/maher/\${surahNumber}.mp3\`;
							break;
						case 'sudais':
							audioUrl = \`https://server11.mp3quran.net/sds/\${surahNumber}.mp3\`;
							break;
						case 'shuraim':
							audioUrl = \`https://server6.mp3quran.net/shur/\${surahNumber}.mp3\`;
							break;
						case 'ghamdi':
							audioUrl = \`https://server7.mp3quran.net/s_gmd/\${surahNumber}.mp3\`;
							break;
						case 'husary':
							audioUrl = \`https://server13.mp3quran.net/husr/\${surahNumber}.mp3\`;
							break;
						default:
							audioUrl = \`https://server8.mp3quran.net/afs/\${surahNumber}.mp3\`;
					}
					
					const surahText = surahSelect.options[surahSelect.selectedIndex].text;
					const reciterText = reciterSelect.options[reciterSelect.selectedIndex].text;
					
					// Create download link
					const link = document.createElement('a');
					link.href = audioUrl;
					link.download = \`Surah_\${surahNumber}_\${reciter}.mp3\`;
					link.target = '_blank';
					
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					
					showQuranMessage(\`Download started: \${surahText} by \${reciterText}\`);
				}
				
				function setLoadingState(loading) {
					const playBtn = document.getElementById('playBtn');
					const playBtnText = document.getElementById('playBtnText');
					
					if (loading) {
						playBtn.classList.add('loading');
						playBtnText.textContent = 'Loading...';
						playBtn.disabled = true;
					} else {
						playBtn.classList.remove('loading');
						playBtn.disabled = false;
					}
				}
				
				function showQuranMessage(message) {
					// Create a temporary message
					const messageDiv = document.createElement('div');
					messageDiv.textContent = message;
					messageDiv.style.cssText = \`
						position: fixed;
						top: 60px;
						right: 20px;
						background: var(--vscode-notificationsInfoIcon-foreground);
						color: var(--vscode-button-foreground);
						padding: 8px 16px;
						border-radius: 4px;
						font-size: 0.8em;
						z-index: 1000;
						animation: fadeIn 0.3s ease;
						max-width: 300px;
						word-wrap: break-word;
					\`;
					
					document.body.appendChild(messageDiv);
					
					// Remove after 4 seconds
					setTimeout(() => {
						if (messageDiv.parentNode) {
							messageDiv.parentNode.removeChild(messageDiv);
						}
					}, 4000);
				}
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
        `اللهم صل وسلم على نبينا محمد - ${prayerName}`,
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
let timerProvider = null; // Global reference to timer provider for cleanup
let prayerProvider = null; // Global reference to prayer provider for cleanup
let tasksProvider = null; // Global reference to tasks provider for cleanup

/**
 * Timer Data Provider Class for Explorer Panel
 */
class TimerDataProvider {
  constructor(context) {
    this._context = context;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Timer state
    this.isRunning = false;
    this.isPaused = false;
    this.remainingTime = 25 * 60; // 25 minutes in seconds
    this.totalTime = 25 * 60;
    this.timerType = "Focus"; // 'Focus' or 'Break'
    this.interval = null;
    this.pomodoroCount = 0;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      // Root level items
      const items = [];

      // Timer status item
      const statusItem = new vscode.TreeItem(
        `${this.timerType} Session`,
        vscode.TreeItemCollapsibleState.None
      );
      statusItem.description = this.getTimerStatus();
      statusItem.iconPath = new vscode.ThemeIcon(
        this.isRunning
          ? "play-circle"
          : this.isPaused
          ? "debug-pause"
          : "circle-large-outline"
      );
      items.push(statusItem);

      // Time remaining item
      const timeItem = new vscode.TreeItem(
        this.formatTime(this.remainingTime),
        vscode.TreeItemCollapsibleState.None
      );
      timeItem.description = `of ${this.formatTime(this.totalTime)}`;
      timeItem.iconPath = new vscode.ThemeIcon("clock");
      items.push(timeItem);

      // Pomodoro count item
      const countItem = new vscode.TreeItem(
        `Pomodoros: ${this.pomodoroCount}`,
        vscode.TreeItemCollapsibleState.None
      );
      countItem.description = "completed today";
      countItem.iconPath = new vscode.ThemeIcon("check-all");
      items.push(countItem);

      return items;
    }
    return [];
  }

  getTimerStatus() {
    if (this.isRunning) {
      return "Running...";
    } else if (this.isPaused) {
      return "Paused";
    } else if (this.remainingTime === 0) {
      return "Completed!";
    } else {
      return "Ready to start";
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  startTimer() {
    if (this.remainingTime === 0) {
      // Reset timer if completed
      this.resetTimer();
    }

    this.isRunning = true;
    this.isPaused = false;

    this.interval = setInterval(() => {
      this.remainingTime--;
      this.refresh();

      if (this.remainingTime === 0) {
        this.completeTimer();
      }
    }, 1000);

    this.refresh();
    vscode.window.showInformationMessage(`${this.timerType} timer started! 🍅`);
  }

  pauseTimer() {
    if (this.isRunning) {
      this.isRunning = false;
      this.isPaused = true;

      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }

      this.refresh();
      vscode.window.showInformationMessage("Timer paused ⏸️");
    }
  }

  stopTimer() {
    this.isRunning = false;
    this.isPaused = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.resetTimer();
    this.refresh();
    vscode.window.showInformationMessage("Timer stopped 🛑");
  }

  resetTimer() {
    const config = vscode.workspace.getConfiguration("islamic-shoky");

    if (this.timerType === "Focus") {
      this.totalTime = config.get("focusDuration", 25) * 60;
    } else {
      this.totalTime = config.get("breakDuration", 5) * 60;
    }

    this.remainingTime = this.totalTime;
  }

  completeTimer() {
    this.isRunning = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.timerType === "Focus") {
      this.pomodoroCount++;
      this.timerType = "Break";
      vscode.window
        .showInformationMessage(
          "Focus session completed! Time for a break 🎉",
          "Start Break",
          "Skip Break"
        )
        .then((selection) => {
          if (selection === "Start Break") {
            this.resetTimer();
            this.startTimer();
          } else {
            this.timerType = "Focus";
            this.resetTimer();
          }
        });
    } else {
      this.timerType = "Focus";
      vscode.window
        .showInformationMessage(
          "Break completed! Ready for another focus session? 💪",
          "Start Focus",
          "Later"
        )
        .then((selection) => {
          if (selection === "Start Focus") {
            this.resetTimer();
            this.startTimer();
          } else {
            this.resetTimer();
          }
        });
    }

    this.refresh();
  }
}

/**
 * Prayer Data Provider Class for Explorer Panel
 */
class PrayerDataProvider {
  constructor(context) {
    this._context = context;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Prayer times state
    this.prayerTimes = null;
    this.nextPrayer = null;
    this.currentLocation = null;
    this.refreshInterval = null;

    // Start auto-refresh every minute
    this.startAutoRefresh();

    // Load location from main extension
    this.loadLocationFromMainExtension();
  }

  loadLocationFromMainExtension() {
    // Get location data from the main extension's webview localStorage
    // Since we can't directly access localStorage from Node.js, we'll use VS Code settings
    // or try to get it from the main provider if available
    if (
      currentProvider &&
      currentProvider._view &&
      currentProvider._view.webview
    ) {
      // Ask the main webview for location data
      currentProvider._view.webview.postMessage({
        command: "getLocationData",
      });

      // Listen for location data response
      const messageListener = currentProvider._view.webview.onDidReceiveMessage(
        (message) => {
          if (message.command === "locationDataResponse" && message.location) {
            this.currentLocation = message.location;
            this.refresh();
            messageListener.dispose();
          }
        }
      );
    }
  }

  refresh() {
    this.calculatePrayerTimes();
    this._onDidChangeTreeData.fire();
  }

  startAutoRefresh() {
    // Refresh every minute to update countdown
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 60000); // 60 seconds
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      // Root level items
      const items = [];

      if (!this.currentLocation) {
        // No location set
        const locationItem = new vscode.TreeItem(
          "Location not set",
          vscode.TreeItemCollapsibleState.None
        );
        locationItem.description = "Set from main panel";
        locationItem.iconPath = new vscode.ThemeIcon("location");
        locationItem.command = {
          command: "islamic-shoky.prayer.setLocation",
          title: "Set Location",
        };
        items.push(locationItem);
        return items;
      }

      if (!this.nextPrayer) {
        // Loading or error state
        const loadingItem = new vscode.TreeItem(
          "Loading prayer times...",
          vscode.TreeItemCollapsibleState.None
        );
        loadingItem.iconPath = new vscode.ThemeIcon("loading~spin");
        items.push(loadingItem);
        return items;
      }

      // Next prayer item
      const nextPrayerItem = new vscode.TreeItem(
        `Next: ${this.nextPrayer.name}`,
        vscode.TreeItemCollapsibleState.None
      );
      nextPrayerItem.description = this.formatTime(this.nextPrayer.time);
      nextPrayerItem.iconPath = new vscode.ThemeIcon("bell");
      items.push(nextPrayerItem);

      // Time remaining item
      const remainingTime = this.getTimeRemaining();
      if (remainingTime) {
        const remainingItem = new vscode.TreeItem(
          remainingTime,
          vscode.TreeItemCollapsibleState.None
        );
        remainingItem.description = "remaining";
        remainingItem.iconPath = new vscode.ThemeIcon("clock");
        items.push(remainingItem);
      }

      // Location item
      const locationItem = new vscode.TreeItem(
        this.currentLocation.city || "Current Location",
        vscode.TreeItemCollapsibleState.None
      );
      locationItem.description = `${this.currentLocation.country || ""}`;
      locationItem.iconPath = new vscode.ThemeIcon("location");
      items.push(locationItem);

      return items;
    }
    return [];
  }

  calculatePrayerTimes() {
    if (!this.currentLocation) {
      // Try to load location from main extension again
      this.loadLocationFromMainExtension();
      return;
    }

    try {
      const now = new Date();
      const prayerNames = [
        "Fajr",
        "Sunrise",
        "Dhuhr",
        "Asr",
        "Maghrib",
        "Isha",
      ];

      // Simple prayer time calculation (simplified for demo)
      // In a real implementation, you would use a proper Islamic prayer time library
      const times = this.calculateSimplePrayerTimes(now);

      this.prayerTimes = {};
      prayerNames.forEach((name, index) => {
        this.prayerTimes[name] = times[index];
      });

      // Find next prayer
      this.findNextPrayer();
    } catch (error) {
      console.error("Error calculating prayer times:", error);
    }
  }

  calculateSimplePrayerTimes(date) {
    // This is a very simplified calculation for demonstration
    // In a real implementation, use a proper Islamic calendar library
    const times = [];

    // Simplified prayer times (adjust based on actual calculation needs)
    times.push(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 5, 30)
    ); // Fajr
    times.push(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 45)
    ); // Sunrise
    times.push(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 30)
    ); // Dhuhr
    times.push(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 15, 45)
    ); // Asr
    times.push(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18, 15)
    ); // Maghrib
    times.push(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 19, 30)
    ); // Isha

    return times;
  }

  findNextPrayer() {
    if (!this.prayerTimes) return;

    const now = new Date();
    const prayerNames = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

    // Find the next prayer time
    for (const name of prayerNames) {
      const prayerTime = this.prayerTimes[name];
      if (prayerTime > now) {
        this.nextPrayer = {
          name: name,
          time: prayerTime,
        };
        return;
      }
    }

    // If no prayer found today, get tomorrow's Fajr
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowTimes = this.calculateSimplePrayerTimes(tomorrow);

    this.nextPrayer = {
      name: "Fajr",
      time: tomorrowTimes[0],
    };
  }

  formatTime(date) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  getTimeRemaining() {
    if (!this.nextPrayer) return null;

    const now = new Date();
    const diff = this.nextPrayer.time - now;

    if (diff <= 0) return null;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  async setLocation() {
    // Redirect to main extension's location setting
    if (
      currentProvider &&
      currentProvider._handleLocationRequest &&
      currentProvider._view
    ) {
      currentProvider._handleLocationRequest(currentProvider._view);
    } else {
      vscode.window
        .showInformationMessage(
          "Please set your location from the main Islamic Shoky panel first.",
          "Open Main Panel"
        )
        .then((selection) => {
          if (selection === "Open Main Panel") {
            vscode.commands.executeCommand(
              "workbench.view.extension.islamic-shoky-sidebar"
            );
          }
        });
    }
  }

  dispose() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

/**
 * Tasks Data Provider Class for Explorer Panel
 */
class TasksDataProvider {
  constructor(context) {
    this._context = context;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Tasks state
    this.tasks = [];

    // Load tasks from main extension
    this.loadTasksFromMainExtension();
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  refreshFromMainExtension() {
    this.loadTasksFromMainExtension();
    this._onDidChangeTreeData.fire();
  }

  loadTasksFromMainExtension() {
    // Get tasks data from the main extension's webview localStorage
    if (
      currentProvider &&
      currentProvider._view &&
      currentProvider._view.webview
    ) {
      // Ask the main webview for tasks data
      currentProvider._view.webview.postMessage({
        command: "getTasksData",
      });
    } else {
      // If webview is not ready, retry after a short delay
      setTimeout(() => {
        this.loadTasksFromMainExtension();
      }, 1000);
    }
  }

  getTreeItem(element) {
    const item = new vscode.TreeItem(
      element.text,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = element.completed ? "Completed" : "Pending";
    item.iconPath = new vscode.ThemeIcon(
      element.completed ? "check" : "circle-large-outline"
    );
    // Remove contextValue to disable context menus
    item.tooltip = `${element.text} - ${
      element.completed ? "Completed" : "Pending"
    }`;

    return item;
  }

  getChildren(element) {
    if (!element) {
      // Root level - return all tasks
      if (this.tasks.length === 0) {
        const emptyItem = new vscode.TreeItem(
          "No tasks found",
          vscode.TreeItemCollapsibleState.None
        );
        emptyItem.description = "Create tasks from the main panel";
        emptyItem.iconPath = new vscode.ThemeIcon("info");
        return [emptyItem];
      }

      return this.tasks;
    }
    return [];
  }

  updateTasks(tasks) {
    console.log("TasksDataProvider: updateTasks called with:", tasks);
    this.tasks = tasks || [];
    console.log("TasksDataProvider: Updated tasks array:", this.tasks);
    this.refresh();
  }

  async refreshTasks() {
    console.log("[TasksDataProvider] refreshTasks called");
    this.loadTasksFromMainExtension();
    this._onDidChangeTreeData.fire();
  }
}

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

  // Register the timer data provider for Explorer panel
  timerProvider = new TimerDataProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("islamic-shoky.timer", timerProvider)
  );

  // Register the prayer data provider for Explorer panel
  prayerProvider = new PrayerDataProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "islamic-shoky.prayer",
      prayerProvider
    )
  );

  // Register the tasks data provider for Explorer panel
  tasksProvider = new TasksDataProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("islamic-shoky.tasks", tasksProvider)
  );

  // Register timer commands
  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.timer.start", () => {
      timerProvider.startTimer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.timer.pause", () => {
      timerProvider.pauseTimer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.timer.stop", () => {
      timerProvider.stopTimer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.timer.refresh", () => {
      timerProvider.refresh();
    })
  );

  // Register prayer commands
  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.prayer.refresh", () => {
      prayerProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.prayer.setLocation", () => {
      prayerProvider.setLocation();
    })
  );

  // Register task commands
  context.subscriptions.push(
    vscode.commands.registerCommand("islamic-shoky.tasks.refresh", () => {
      tasksProvider.refreshTasks();
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("islamic-shoky")) {
        // Refresh the webview when settings change
        currentProvider.refresh();
        // Also refresh the timer if focus/break durations changed
        if (
          e.affectsConfiguration("islamic-shoky.focusDuration") ||
          e.affectsConfiguration("islamic-shoky.breakDuration")
        ) {
          timerProvider.resetTimer();
          timerProvider.refresh();
        }
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

  // Stop reminder system when extension is deactivated
  if (currentProvider && currentProvider._stopReminderSystem) {
    currentProvider._stopReminderSystem();
  }

  // Stop background audio when extension is deactivated
  if (currentProvider && currentProvider._stopBackgroundAudio) {
    currentProvider._stopBackgroundAudio();
  }

  // Clear all prayer notification timeouts
  if (currentProvider && currentProvider._clearPrayerTimeouts) {
    currentProvider._clearPrayerTimeouts();
  }

  // Stop timer when extension is deactivated
  if (timerProvider && timerProvider.interval) {
    clearInterval(timerProvider.interval);
    timerProvider.interval = null;
  }

  // Stop prayer provider refresh when extension is deactivated
  if (prayerProvider && prayerProvider.dispose) {
    prayerProvider.dispose();
  }

  // Clean up tasks provider when extension is deactivated
  if (tasksProvider) {
    tasksProvider.tasks = [];
  }
}

module.exports = {
  activate,
  deactivate,
};
