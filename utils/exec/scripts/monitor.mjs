import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import notifier from "node-notifier";
import { getConfig, savePids, getPidsFromPort, loadPids, PROJECT_ROOT } from "./utils.mjs";

// Debug mode - set to true to enable verbose debug logging
// Can also be enabled via environment variable: DEBUG=true node monitor.mjs
const DEBUG = process.env.DEBUG === "true" || false;

// Debug logging helper
const debugLog = (...args) => {
	if (DEBUG) {
		console.log(...args);
	}
};

const checkLogFileExists = async (logPath) => {
	try {
		await fs.access(logPath, fs.constants.R_OK);
		return true;
	} catch (error) {
		return false;
	}
};

const openBrowser = (url) => {
	const platform = process.platform;
	try {
		console.log(`🌐 Opening browser to ${url}...`);
		
		if (platform === "win32") {
			// Windows - use rundll32 approach (more reliable than start command)
			exec(`start "" "${url}"`, (error2) => {
				if (error2) {
				  console.error(`❌ Fallback also failed: ${error2.message}`);
				} else {
				  console.log("✅ Browser opened successfully with fallback method");
				}
			});
		} else if (platform === "darwin") {
		  // macOS - use open command
		  exec(`open "${url}"`, (error) => {
			if (error) {
			  console.error(`❌ Error opening browser: ${error.message}`);
			} else {
			  console.log("✅ Browser opened successfully");
			}
		  });
		} else {
		  // Linux/Unix - try xdg-open
		  exec(`xdg-open "${url}"`, (error) => {
			if (error) {
			  console.error(`❌ Error opening browser: ${error.message}`);
			} else {
			  console.log("✅ Browser opened successfully");
			}
		  });
		}
	  } catch (error) {
		console.error(`❌ Failed to open browser: ${error.message}`);
	  }
};

const monitorLogs = (config) => {
	return new Promise(async (resolve, reject) => {
		let lastSize = 0;
		let initialSize = 0;
		let checkCount = 0;
		let fileNotFoundCount = 0;
		const maxFileNotFoundAttempts = 60;
		const logPath = path.join(config.logDir, config.logFile);
		
		console.log("👀 Monitoring logs for server startup...\n");
		debugLog(`[DEBUG] Log file path: ${logPath}`);
		debugLog(`[DEBUG] Startup pattern: ${config.startupPattern}`);
		debugLog(`[DEBUG] Poll interval: ${config.pollInterval}ms`);
		debugLog(`[DEBUG] Startup timeout: ${config.startupTimeout}ms\n`);
		
		// Get initial file size to only check new content
		try {
			const logFileExists = await checkLogFileExists(logPath);
			if (logFileExists) {
				const stats = await fs.stat(logPath);
				initialSize = stats.size;
				lastSize = initialSize;
				debugLog(`[DEBUG] Initial log file size: ${initialSize} bytes - will only check new content`);
			}
		} catch (error) {
			debugLog(`[DEBUG] Could not get initial file size: ${error.message}`);
		}
		
		let interval;
		let timeout;
		
		timeout = setTimeout(() => {
			if (interval) clearInterval(interval);
			reject(new Error("Timeout waiting for server startup"));
		}, config.startupTimeout);
		
		interval = setInterval(async () => {
			try {
				checkCount++;
				
				const logFileExists = await checkLogFileExists(logPath);
				debugLog(`[DEBUG] Check #${checkCount}: Log file exists: ${logFileExists}`);
				
				if (!logFileExists) {
					fileNotFoundCount++;
					debugLog(`[DEBUG] Log file not found (attempt ${fileNotFoundCount}/${maxFileNotFoundAttempts})`);
					if (fileNotFoundCount >= maxFileNotFoundAttempts) {
						if (interval) clearInterval(interval);
						if (timeout) clearTimeout(timeout);
						reject(new Error("Log file not found after maximum attempts"));
						return;
					}
					return;
				}
				
				fileNotFoundCount = 0;
				const stats = await fs.stat(logPath);
				const currentSize = stats.size;
				debugLog(`[DEBUG] Log file size: ${currentSize} bytes (initial: ${initialSize}, previous: ${lastSize})`);
				
				// Check only new content added since monitoring started to avoid matching
				// old startup messages from previous runs. This ensures we only detect new startup.
				if (currentSize > lastSize || (currentSize > 0 && lastSize === 0)) {
					// Only check content that was added since monitoring started
					// Read from initialSize onwards (or last 50KB if file is smaller)
					const contentToCheck = currentSize - initialSize;
					const tailSize = Math.min(Math.max(contentToCheck, 0), 50000);
					const startPos = Math.max(initialSize, currentSize - tailSize);
					
					const fileHandle = await fs.open(logPath, "r");
					const buffer = Buffer.alloc(tailSize);
					await fileHandle.read(buffer, 0, tailSize, startPos);
					await fileHandle.close();
					
					const fileContent = buffer.toString("utf-8");
					debugLog(`[DEBUG] Reading log file tail (${tailSize} bytes from position ${startPos}, total size: ${currentSize})`);
					debugLog(`[DEBUG] Last 200 chars of tail: ${fileContent.slice(-200)}`);
					
					// Reset regex lastIndex to avoid state issues
					config.startupPattern.lastIndex = 0;
					const patternMatch = config.startupPattern.test(fileContent);
					debugLog(`[DEBUG] Pattern: ${config.startupPattern}`);
					debugLog(`[DEBUG] Pattern source: ${config.startupPattern.source}`);
					debugLog(`[DEBUG] Pattern flags: ${config.startupPattern.flags}`);
					debugLog(`[DEBUG] Pattern match result: ${patternMatch}`);
					if (patternMatch) {
						const matchResult = fileContent.match(config.startupPattern);
						debugLog(`[DEBUG] Match details: ${JSON.stringify(matchResult)}`);
					}
					
					if (patternMatch) {
						debugLog(`[DEBUG] ✅ Startup pattern found! Resolving promise...`);
						if (interval) clearInterval(interval);
						if (timeout) clearTimeout(timeout);
						resolve();
						return;
					}
					
					lastSize = currentSize;
				} else {
					debugLog(`[DEBUG] File size unchanged, skipping read`);
				}
			} catch (error) {
				debugLog(`[DEBUG] Error in monitoring loop: ${error.message}`);
				// Continue monitoring
			}
		}, config.pollInterval);
	});
};

const trackTomcatPids = async (config) => {
	debugLog(`[DEBUG] Tracking Tomcat PIDs on port ${config.cargoPort}`);
	const pids = await getPidsFromPort(config.cargoPort);
	debugLog(`[DEBUG] Found PIDs on port ${config.cargoPort}: ${JSON.stringify(pids)}`);
	
	// Filter out the cargo process itself
	const pidData = await loadPids(config.pidFile);
	const cargoPid = pidData?.cargoPid;
	debugLog(`[DEBUG] Cargo PID from file: ${cargoPid}`);
	
	const filteredPids = pids.filter(pid => pid !== cargoPid?.toString());
	debugLog(`[DEBUG] Filtered Tomcat PIDs (excluding cargo): ${JSON.stringify(filteredPids)}`);
	return filteredPids;
};

const main = async () => {
	debugLog("[DEBUG] Starting monitor script...");
	const config = await getConfig();
	debugLog(`[DEBUG] Config loaded:`);
	debugLog(`[DEBUG]   Instance type: ${config.instanceType}`);
	debugLog(`[DEBUG]   Server URL: ${config.serverUrl}`);
	debugLog(`[DEBUG]   Cargo port: ${config.cargoPort}`);
	debugLog(`[DEBUG]   Log dir: ${config.logDir}`);
	debugLog(`[DEBUG]   Log file: ${config.logFile}`);
	debugLog(`[DEBUG]   PID file: ${config.pidFile}`);
	debugLog(`[DEBUG]   Show toasts: ${config.showToasts}`);
	debugLog(`[DEBUG]   Notification config: ${JSON.stringify(config.notificationConfig, null, 2)}\n`);
	
	try {
		debugLog("[DEBUG] Starting log monitoring...");
		await monitorLogs(config);
		debugLog("[DEBUG] ✅ Log monitoring completed successfully\n");
		
		// Track Tomcat PIDs
		const tomcatPids = await trackTomcatPids(config);
		
		// Update PID file with Tomcat PIDs and MailDev PID
		const pidData = await loadPids(config.pidFile);
		debugLog(`[DEBUG] Loaded PID data: ${JSON.stringify(pidData, null, 2)}`);
		let maildevPid = pidData?.maildevPid || null;
		
		// Try to read MailDev PID from its own file
		if (!maildevPid) {
			try {
				const maildevData = await fs.readFile(config.maildevPidFile, "utf-8");
				const maildevPidData = JSON.parse(maildevData);
				maildevPid = maildevPidData.maildevPid;
				debugLog(`[DEBUG] Loaded MailDev PID from file: ${maildevPid}`);
			} catch (error) {
				debugLog(`[DEBUG] MailDev PID file not found or error reading: ${error.message}`);
				// MailDev PID file doesn't exist or MailDev not running
			}
		}
		
		if (pidData) {
			debugLog(`[DEBUG] Saving PIDs to file: cargo=${pidData.cargoPid}, tomcat=${JSON.stringify(tomcatPids)}, maildev=${maildevPid}`);
			await savePids(config.pidFile, pidData.cargoPid, tomcatPids, maildevPid);
			debugLog(`[DEBUG] ✅ PIDs saved successfully`);
		} else {
			debugLog(`[DEBUG] ⚠️  No PID data found, skipping save`);
		}
		
		// Show notification and URL
		console.log(`\n🔗 ${config.serverUrl}\n`);
		
		// Calculate and log finish time with elapsed duration
		const START_TIMES_LOG = path.join(PROJECT_ROOT, "startTimes.log");
		try {
			// Read the log file to get the last start time
			const logContent = await fs.readFile(START_TIMES_LOG, "utf-8");
			const lines = logContent.trim().split("\n").filter(line => line.trim());
			const lastStartLine = lines.reverse().find(line => line.startsWith("START"));
			
			if (lastStartLine) {
				// Parse: START | timestamp | startTimeMs
				const parts = lastStartLine.split(" | ");
				if (parts.length === 3) {
					const startTimeMs = parseInt(parts[2], 10);
					const finishTimeMs = Date.now();
					const elapsedMs = finishTimeMs - startTimeMs;
					
					const elapsedMinutes = Math.floor(elapsedMs / 60000);
					const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
					const elapsedMilliseconds = elapsedMs % 1000;
					
					const finishTimestamp = new Date().toISOString();
					const logEntry = `FINISH | ${finishTimestamp} | ${finishTimeMs} | Elapsed: ${elapsedMinutes}min ${elapsedSeconds}s ${elapsedMilliseconds}ms\n`;
					
					await fs.appendFile(START_TIMES_LOG, logEntry, "utf-8");
					console.log(`⏱️  Startup completed in ${elapsedMinutes}min ${elapsedSeconds}s ${elapsedMilliseconds}ms`);
					console.log(`\n💡 Type 'x' or 'q' + Enter to gracefully shutdown\n`);
				}
			}
		} catch (error) {
			// Log file might not exist or might be empty - that's okay
			debugLog(`[DEBUG] Could not read start time: ${error.message}`);
			// Show shutdown message even if startup time wasn't logged
			console.log(`\n💡 Type 'x' or 'q' + Enter to gracefully shutdown\n`);
		}
		
		if (config.showToasts && config.notificationConfig) {
			const notifConfig = config.notificationConfig;
			debugLog(`[DEBUG] Preparing to show notification...`);
			debugLog(`[DEBUG]   Title: ${notifConfig.titlePrefix} ${config.instanceType.toUpperCase()} Server Loaded`);
			debugLog(`[DEBUG]   Message: Server is ready!\\nClick to open: ${config.serverUrl}`);
			debugLog(`[DEBUG]   Wait: ${notifConfig.wait}`);
			debugLog(`[DEBUG]   Timeout: ${notifConfig.timeout}`);
			
			// Set up event listeners for notification clicks
			notifier.on('click', () => {
				debugLog(`[DEBUG] Notification clicked!`);
				openBrowser(config.serverUrl);
				if (notifConfig.wait) {
					process.exit(0);
				}
			});
			
			notifier.on('activate', () => {
				debugLog(`[DEBUG] Notification activated!`);
				openBrowser(config.serverUrl);
				if (notifConfig.wait) {
					process.exit(0);
				}
			});
			
			// Show the notification
			notifier.notify({
				title: `${notifConfig.titlePrefix} ${config.instanceType.toUpperCase()} Server Loaded`,
				message: `Server is ready!\nClick to open: ${config.serverUrl}`,
				sound: notifConfig.sound,
				wait: notifConfig.wait,
				timeout: notifConfig.timeout,
				appID: notifConfig.appId,
				icon: path.join("./assets/magnolia-logo.png"),
			}, (err, response, metadata) => {
				debugLog(`[DEBUG] Notification callback - err: ${err}, response: ${response}`);
				// Handle notification response via callback (more reliable on Windows)
				// On Windows, clicking often results in undefined response but callback is still called
				if (!err) {
					if (response === 'activate' || response === 'clicked' || response === undefined) {
						// undefined response on Windows often means the notification was clicked
						openBrowser(config.serverUrl);
					}
				}
				// Exit after callback if wait was true
				// Exit after callback if wait was true (for timeout/dismiss cases)
				if (notifConfig.wait) {
					setTimeout(() => {
						debugLog(`[DEBUG] Exiting due to wait=true`);
						process.exit(0);
					}, 500);
				}
			});
			
			debugLog(`[DEBUG] ✅ Notification sent`);
			
			// If wait is true, keep process alive; otherwise exit after a short delay
			if (notifConfig.wait) {
				debugLog(`[DEBUG] Waiting for notification interaction...`);
				// Process will exit when notification is clicked or times out
				return;
			}
		} else {
			debugLog(`[DEBUG] Skipping notification (showToasts=${config.showToasts}, notificationConfig=${!!config.notificationConfig})`);
		}
		
		// Open browser if enabled
		if (config.openBrowser || process.env.OPEN_BROWSER === "true") {
			debugLog(`[DEBUG] Opening browser: ${config.serverUrl}`);
			openBrowser(config.serverUrl);
		} else {
			debugLog(`[DEBUG] Browser auto-open disabled`);
		}
		
		debugLog(`[DEBUG] Exiting successfully`);
		process.exit(0);
	} catch (error) {
		console.error("\n❌ Error:", error.message);
		if (DEBUG) {
			console.error(`[DEBUG] Error stack: ${error.stack}`);
		}
		process.exit(1);
	}
};

main();

