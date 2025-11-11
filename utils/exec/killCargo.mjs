import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import loadConfig from "./loadConfig.mjs";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
let CONFIG;

const initializeConfig = async () => {
	const baseConfig = await loadConfig();
	CONFIG = {
		pidFile: baseConfig.pids.author,
		maildevPidFile: baseConfig.pids.maildev,
		cargoPort: baseConfig.ports.author.cargo,
		rmiPort: baseConfig.ports.author.rmi,
		maildevSmtpPort: baseConfig.ports.maildev.smtp,
		maildevUiPort: baseConfig.ports.maildev.ui,
		cargoWorkingDir: baseConfig.paths.workingDir,
		mavenCommand: baseConfig.maven.command,
		mavenProfile: baseConfig.maven.profiles.author,
	};
	return CONFIG;
};

// Kill process by PID
const killProcess = async (pid) => {
	try {
		const platform = process.platform;
		const command = platform === "win32" ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
		await execAsync(command);
		return true;
	} catch (error) {
		return false;
	}
};

// Get PIDs from port
const getPidsFromPort = async (port) => {
	try {
		const platform = process.platform;
		let command;
		
		if (platform === "win32") {
			command = `netstat -ano | findstr :${port}`;
		} else {
			command = `lsof -i :${port} -t`;
		}
		
		const { stdout } = await execAsync(command);
		if (platform === "win32") {
			// Parse Windows netstat output
			const pids = new Set();
			stdout.split("\n").forEach((line) => {
				const match = line.trim().match(/\s+(\d+)$/);
				if (match) pids.add(match[1]);
			});
			return Array.from(pids);
		} else {
			return stdout.trim().split("\n").filter(Boolean);
		}
	} catch (error) {
		return [];
	}
};

// Load PIDs from file
const loadPids = async () => {
	try {
		const data = await fs.readFile(CONFIG.pidFile, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		return null;
	}
};

// Kill all Java processes (fallback)
const killAllJava = async () => {
	try {
		const platform = process.platform;
		const command = platform === "win32" 
			? `taskkill /F /IM java.exe` 
			: `pkill -9 java`;
		await execAsync(command);
		return true;
	} catch (error) {
		return false;
	}
};

// Execute Maven Cargo stop command for proper Tomcat shutdown
const stopCargoWithMaven = async () => {
	try {
		console.log("🚧 Executing Maven Cargo stop command...");
		const { stdout, stderr } = await execAsync(`${CONFIG.mavenCommand} cargo:stop -Dcargo.tomcat.shutdown.quiet=true -P${CONFIG.mavenProfile}`, {
			cwd: CONFIG.cargoWorkingDir,
			timeout: 60000 // 60 second timeout
		});
		console.log("✅ Maven Cargo stop command executed");
		
		// Wait for port to be released to ensure complete shutdown
		console.log("⏳ Waiting for server to shut down completely...");
		let shutdownComplete = false;
		for (let i = 0; i < 30; i++) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			const portInUse = await isPortInUse(CONFIG.cargoPort);
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
		
		return true;
	} catch (error) {
		console.warn(`⚠️  Maven Cargo stop failed: ${error.message}`);
		return false;
	}
};

// Load MailDev PID from file
const loadMailDevPid = async () => {
	try {
		const data = await fs.readFile(CONFIG.maildevPidFile, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		return null;
	}
};

// Check if port is in use
const isPortInUse = async (port) => {
	try {
		const platform = process.platform;
		let command;
		
		if (platform === "win32") {
			command = `netstat -ano | findstr :${port}`;
		} else {
			command = `lsof -i :${port} -t`;
		}
		
		const { stdout } = await execAsync(command);
		return stdout.trim().length > 0;
	} catch (error) {
		return false;
	}
};

// Main execution
const main = async () => {
	// Initialize configuration
	await initializeConfig();
	
	console.log("🛑 Stopping Magnolia Cargo Server...\n");
	
	let killedCount = 0;

	// First try to stop MailDev
	console.log("📧 Stopping MailDev server...");
	const mailDevPidData = await loadMailDevPid();
	if (mailDevPidData && mailDevPidData.maildevPid) {
		const killed = await killProcess(mailDevPidData.maildevPid);
		console.log(`   ${killed ? "✅" : "⚠️"} MailDev process (${mailDevPidData.maildevPid})`);
		if (killed) killedCount++;
	} else {
		// Check if any process is using the maildev ports
		const maildevPortPids = await getPidsFromPort(CONFIG.maildevSmtpPort);
		for (const pid of maildevPortPids) {
			const killed = await killProcess(pid);
			console.log(`   ${killed ? "✅" : "⚠️"} Process on MailDev port ${CONFIG.maildevSmtpPort}: ${pid}`);
			if (killed) killedCount++;
		}
	}

	// Clean up MailDev PID file
	try {
		await fs.unlink(CONFIG.maildevPidFile);
	} catch (error) {
		// Ignore if file doesn't exist
	}

	// Step 1: Try to stop Tomcat using Maven cargo:stop (most graceful method)
	console.log("\n🔄 Attempting graceful shutdown sequence...");
	const mavenStopSuccessful = await stopCargoWithMaven();
	
	// Check if the port was released after Maven stop
	const portStillInUse = await isPortInUse(CONFIG.cargoPort);
	if (!portStillInUse && mavenStopSuccessful) {
		console.log("✅ Server stopped gracefully via Maven\n");
		
		// Clean up PID file
		try {
			await fs.unlink(CONFIG.pidFile);
			console.log("🧹 Cleaned up PID file");
		} catch (error) {
			// Ignore if file doesn't exist
		}
		
		console.log(`\n${"=".repeat(60)}`);
		console.log("✅ Server shutdown completed successfully");
		console.log(`${"=".repeat(60)}\n`);
		return;
	}
	
	console.log("\n⚠️ Graceful shutdown incomplete, proceeding with process termination...\n");
	
	// Try to load and kill tracked PIDs
	const pidData = await loadPids();
	
	if (pidData) {
		console.log("📋 Found tracked processes:");
		console.log(`   Cargo PID: ${pidData.cargoPid}`);
		if (pidData.tomcatPids && pidData.tomcatPids.length > 0) {
			console.log(`   Tomcat PIDs: ${pidData.tomcatPids.join(", ")}`);
		}
		console.log(`   Started: ${new Date(pidData.timestamp).toLocaleString()}\n`);
		
		// Kill Cargo process
		if (pidData.cargoPid) {
			const killed = await killProcess(pidData.cargoPid);
			console.log(`   ${killed ? "✅" : "⚠️"} Cargo process (${pidData.cargoPid})`);
			if (killed) killedCount++;
		}
		
		// Kill Tomcat processes
		if (pidData.tomcatPids) {
			for (const pid of pidData.tomcatPids) {
				const killed = await killProcess(pid);
				console.log(`   ${killed ? "✅" : "⚠️"} Tomcat process (${pid})`);
				if (killed) killedCount++;
			}
		}
		
		console.log();
	} else {
		console.log("⚠️  No PID file found. Searching for processes by port...\n");
	}
	
	// Kill any remaining processes on the ports
	console.log("🔍 Checking ports for remaining processes...");
	const portPids = await getPidsFromPort(CONFIG.cargoPort);
	
	if (portPids.length > 0) {
		console.log(`   Found ${portPids.length} process(es) on port ${CONFIG.cargoPort}`);
		for (const pid of portPids) {
			const killed = await killProcess(pid);
			console.log(`   ${killed ? "✅" : "⚠️"} Process ${pid}`);
			if (killed) killedCount++;
		}
		console.log();
	} else {
		console.log("   No processes found on port 8080\n");
	}
	
	// Clean up PID file
	try {
		await fs.unlink(CONFIG.pidFile);
		console.log("🧹 Cleaned up PID file");
	} catch (error) {
		// Ignore if file doesn't exist
	}
	
	// Summary
	console.log(`\n${"=".repeat(60)}`);
	if (killedCount > 0) {
		console.log(`✅ Successfully stopped ${killedCount} process(es)`);
	} else {
		console.log("ℹ️  No running processes found");
	}
	console.log(`${"=".repeat(60)}\n`);
	
	// Offer to kill all Java processes if needed
	if (killedCount === 0 && pidData) {
		console.log("⚠️  Some processes may not have been killed.");
		console.log("    You can try: npm run kill:force (kills all Java processes)");
	}
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});

