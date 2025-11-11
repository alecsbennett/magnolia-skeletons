import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import loadConfig from "../loadConfig.mjs";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get project root (two levels up from utils/exec/scripts)
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

let cachedConfig = null;
let cachedEnvKey = null;

/**
 * Load and cache configuration
 */
export const getConfig = async () => {
	const instanceType = process.env.MAGNOLIA_INSTANCE || 'author';
	const envKey = instanceType;
	
	// Invalidate cache if environment variables changed
	if (cachedConfig && cachedEnvKey !== envKey) {
		cachedConfig = null;
		cachedEnvKey = null;
	}
	
	if (!cachedConfig) {
		const baseConfig = await loadConfig();
		const resolvedInstanceType = instanceType || baseConfig.instanceType || 'author';
		
		const profileConfig = resolvedInstanceType === 'author' 
			? {
				profile: baseConfig.maven.profiles.author,
				cargoPort: baseConfig.ports.author.cargo,
				rmiPort: baseConfig.ports.author.rmi,
				shutdownPort: baseConfig.ports.author.shutdown,
				ajpPort: baseConfig.ports.author.ajp,
				serverUrl: baseConfig.paths.author.serverUrl,
				logFile: baseConfig.logging.fileName,
				reposDir: baseConfig.paths.author.repos,
				contextPath: baseConfig.paths.author.contextPath,
				pidFile: baseConfig.pids.author,
			}
			: {
				profile: baseConfig.maven.profiles.runtime,
				cargoPort: baseConfig.ports.runtime.cargo,
				rmiPort: baseConfig.ports.runtime.rmi,
				shutdownPort: baseConfig.ports.runtime.shutdown,
				ajpPort: baseConfig.ports.runtime.ajp,
				serverUrl: baseConfig.paths.runtime.serverUrl,
				logFile: baseConfig.logging.fileName,
				reposDir: baseConfig.paths.runtime.repos,
				contextPath: baseConfig.paths.runtime.contextPath,
				pidFile: baseConfig.pids.runtime,
			};
		
		const instancePaths = resolvedInstanceType === 'author' ? baseConfig.paths.author : baseConfig.paths.runtime;
		
		cachedConfig = {
			instanceType: resolvedInstanceType,
			profileConfig,
			logDir: instancePaths.logs,
			logFile: profileConfig.logFile,
			pidFile: profileConfig.pidFile,
			maildevPidFile: baseConfig.pids.maildev,
			serverUrl: profileConfig.serverUrl,
			cargoPort: profileConfig.cargoPort,
			rmiPort: profileConfig.rmiPort,
			cargoHome: instancePaths.cargoHome,
			maildevSmtpPort: baseConfig.ports.maildev.smtp,
			maildevUiPort: baseConfig.ports.maildev.ui,
			maildevUrl: baseConfig.maildev.url,
			cargoCommand: baseConfig.maven.command,
			cargoArgs: ["cargo:run", `-P${profileConfig.profile}`],
			cargoWorkingDir: baseConfig.paths.workingDir,
			startupPattern: baseConfig.logging.startupPattern,
			clearLogs: baseConfig.flags.clearLogs,
			openBrowser: baseConfig.flags.openBrowser,
			pollInterval: baseConfig.intervals.poll,
			forceRestart: baseConfig.flags.forceRestart,
			heartbeatInterval: baseConfig.intervals.heartbeat,
			verboseDebug: baseConfig.flags.verboseDebug,
			quietHeartbeat: baseConfig.flags.quietHeartbeat,
			clearJcrLocks: baseConfig.flags.clearJcrLocks,
			reposDir: profileConfig.reposDir,
			skipMaildev: !baseConfig.maildev.enabled,
			startupTimeout: baseConfig.intervals.startupTimeout,
			showToasts: baseConfig.flags.showToasts,
			notificationConfig: baseConfig.notifications,
			baseConfig,
		};
		cachedEnvKey = envKey;
	}
	return cachedConfig;
};

/**
 * Check if port is in use
 */
export const isPortInUse = async (port) => {
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

/**
 * Get PIDs from port
 */
export const getPidsFromPort = async (port) => {
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

/**
 * Load PIDs from file
 */
export const loadPids = async (pidFile) => {
	try {
		const data = await fs.readFile(pidFile, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		return null;
	}
};

/**
 * Save PIDs to file
 */
export const savePids = async (pidFile, cargoPid, tomcatPids = [], maildevPid = null) => {
	const data = {
		cargoPid,
		tomcatPids,
		maildevPid,
		timestamp: new Date().toISOString(),
	};
	await fs.writeFile(pidFile, JSON.stringify(data, null, 2));
};

/**
 * Kill process by PID
 */
export const killProcess = async (pid) => {
	try {
		const platform = process.platform;
		const command = platform === "win32" ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
		await execAsync(command);
		return true;
	} catch (error) {
		return false;
	}
};

export { PROJECT_ROOT };

