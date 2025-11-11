import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { getConfig, savePids, getPidsFromPort } from "./utils.mjs";

let cargoProcessGlobal = null;

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

const main = async () => {
	const config = await getConfig();
	
	console.log("📦 Starting Maven Cargo...");
	console.log(`   Profile: ${config.profileConfig.profile}`);
	console.log(`   Command: ${config.cargoCommand} ${config.cargoArgs.join(' ')}`);
	console.log(`   Working directory: ${config.cargoWorkingDir}`);
	console.log(`   Output redirecting to: ${path.join(config.logDir, config.logFile)}\n`);
	
	const cargoProcess = spawn(config.cargoCommand, config.cargoArgs, {
		cwd: config.cargoWorkingDir,
		stdio: "inherit",
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
	
	// Keep process running
	cargoProcess.on("exit", async (code) => {
		try {
			await fs.unlink(config.pidFile);
		} catch (error) {
			// Ignore
		}
		if (code !== 0 && code !== null) {
			process.exit(code);
		}
	});
	
	// Handle shutdown signals
	process.on("SIGINT", async () => {
		console.log("\n👋 Shutting down...");
		if (cargoProcessGlobal) {
			cargoProcessGlobal.kill();
		}
		process.exit(0);
	});
	
	process.on("SIGTERM", async () => {
		if (cargoProcessGlobal) {
			cargoProcessGlobal.kill();
		}
		process.exit(0);
	});
	
	// Keep script running
	await new Promise(() => {});
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});

