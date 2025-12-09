import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { createInterface } from "readline";
import { getConfig, savePids, isPortInUse } from "./utils.mjs";
let cargoProcessGlobal = null;
let shutdownInProgress = false;

const isProcessRunning = async (pid) => {
	try {
		const platform = process.platform;
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);
		
		if (platform === "win32") {
			const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}"`);
			return stdout.includes(pid.toString());
		} else {
			await execAsync(`kill -0 ${pid}`);
			return true;
		}
	} catch (error) {
		return false;
	}
};

// Graceful shutdown handler
const gracefulShutdown = async (config, rl) => {
	if (shutdownInProgress) {
		return;
	}
	
	shutdownInProgress = true;
	console.log("\n👋 Shutting down gracefully...");
	
	// Close readline interface first to release stdin
	if (rl) {
		rl.close();
	}
	
	// Send SIGTERM to cargo process - this allows Maven Cargo to handle shutdown properly
	if (cargoProcessGlobal && !cargoProcessGlobal.killed) {
		console.log("🔄 Sending shutdown signal to Cargo process...");
		
		// Send SIGTERM signal
		cargoProcessGlobal.kill('SIGTERM');
		
		// Wait for process to exit gracefully
		let processExited = false;
		await new Promise((resolve) => {
			const timeout = setTimeout(() => {
				if (!processExited) {
					console.log("⏳ Process didn't exit within timeout, checking port...");
					resolve();
				}
			}, 10000); // 10 second timeout
			
			cargoProcessGlobal.on("exit", (code) => {
				processExited = true;
				clearTimeout(timeout);
				console.log(`✅ Cargo process exited (code: ${code})`);
				resolve();
			});
		});
		
		// Wait for port to be released to ensure complete shutdown
		if (!processExited || await isPortInUse(config.cargoPort)) {
			console.log("⏳ Waiting for server to shut down completely...");
			let shutdownComplete = false;
			for (let i = 0; i < 30; i++) {
				await new Promise(resolve => setTimeout(resolve, 1000));
				const portInUse = await isPortInUse(config.cargoPort);
				if (!portInUse) {
					shutdownComplete = true;
					console.log(`✅ Server shut down gracefully after ${i + 1} seconds`);
					break;
				}
				if (i % 5 === 4) {
					console.log(`   Still waiting... (${i + 1}s)`);
				}
			}
			
			if (!shutdownComplete) {
				console.warn("⚠️  Port still in use after timeout");
			}
		}
		
		// Final check - force kill if still running
		if (cargoProcessGlobal && !cargoProcessGlobal.killed) {
			console.log("⚠️  Force killing Cargo process...");
			const platform = process.platform;
			if (platform === "win32") {
				// On Windows, use taskkill
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const execAsync = promisify(exec);
				try {
					await execAsync(`taskkill /F /PID ${cargoProcessGlobal.pid} /T`);
				} catch (error) {
					// Ignore if already killed
				}
			} else {
				cargoProcessGlobal.kill('SIGKILL');
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
	
	// Clean up PID file
	try {
		await fs.unlink(config.pidFile);
	} catch (error) {
		// Ignore
	}
	
	console.log("✅ Shutdown complete");
	
	// Ensure process exits
	setTimeout(() => {
		process.exit(0);
	}, 100);
};

const main = async () => {
	const config = await getConfig();
	
	console.log("📦 Starting Maven Cargo...");
	console.log(`   Profile: ${config.profileConfig.profile}`);
	console.log(`   Command: ${config.cargoCommand} ${config.cargoArgs.join(' ')}`);
	console.log(`   Working directory: ${config.cargoWorkingDir}`);
	console.log(`   Output redirecting to: ${path.join(config.logDir, config.logFile)}\n`);
	
	const cargoProcess = spawn(config.cargoCommand, config.cargoArgs, {
		cwd: config.cargoWorkingDir,
		stdio: ["ignore", "inherit", "inherit"], // Don't inherit stdin so we can read it
		shell: true,
	});
	
	cargoProcessGlobal = cargoProcess;
	const cargoPid = cargoProcess.pid;
	
	console.log(`📝 Cargo process started with PID: ${cargoPid}\n`);
	
	// Wait for process to initialize
	await new Promise(resolve => setTimeout(resolve, 2000));
	
	const isRunning = await isProcessRunning(cargoPid);
	if (!isRunning) {
		console.error("❌ Cargo process failed to start");
		process.exit(1);
	}
	
	// Save initial PID (Tomcat PIDs will be tracked later by monitor)
	await savePids(config.pidFile, cargoPid, [], null);
	
	// Set up stdin reading for graceful shutdown commands
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	
	rl.on('line', (input) => {
		const command = input.trim().toLowerCase();
		if (command === 'x' || command === 'q') {
			gracefulShutdown(config, rl);
		}
	});
	
	// Handle process exit
	cargoProcess.on("exit", async (code) => {
		try {
			await fs.unlink(config.pidFile);
		} catch (error) {
			// Ignore
		}
		if (code !== 0 && code !== null && !shutdownInProgress) {
			rl.close();
			process.exit(code);
		} else if (shutdownInProgress) {
			// Process exited during shutdown, ensure we exit too
			rl.close();
			setTimeout(() => process.exit(0), 100);
		}
	});
	
	// Handle SIGINT/SIGTERM as fallback (but prefer x/q commands)
	process.on("SIGINT", async () => {
		if (!shutdownInProgress) {
			await gracefulShutdown(config, rl);
		}
	});
	
	process.on("SIGTERM", async () => {
		if (!shutdownInProgress) {
			await gracefulShutdown(config, rl);
		}
	});
	
	// Keep script running
	await new Promise(() => {});
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});

