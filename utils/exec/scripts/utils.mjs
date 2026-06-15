import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import loadConfig from "../loadConfig.mjs";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCK_RELEASE_WAIT_MS = 3000;

// Get project root (two levels up from utils/exec/scripts)
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

let cachedConfig = null;
let cachedEnvKey = null;

const normalizeInstanceMode = (value) => {
	const normalized = (value || "author").toLowerCase();
	if (normalized === "both") return "both";
	if (normalized === "public" || normalized === "runtime") return "public";
	return "author";
};

const buildInstanceConfig = (baseConfig, instanceType) => {
	const isAuthor = instanceType === "author";
	const profileConfig = isAuthor
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
	const instancePaths = isAuthor ? baseConfig.paths.author : baseConfig.paths.runtime;
	const cargoArgs = ["cargo:run", `-P${profileConfig.profile}`];
	const resourcesDir = path.join(baseConfig.paths.projectRoot, "light-modules");

	cargoArgs.push(`-Dcargo.magnolia.repositories.home=${instancePaths.repos.replace(/\\/g, "/")}`);
	cargoArgs.push(`-Dcargo.magnolia.logs.dir=${instancePaths.logs.replace(/\\/g, "/")}`);
	cargoArgs.push(`-Dcargo.magnolia.resources.dir=${resourcesDir.replace(/\\/g, "/")}`);

	if (baseConfig.license.owner && baseConfig.license.key) {
		cargoArgs.push(`-Dmagnolia.license.owner=${baseConfig.license.owner}`);
		cargoArgs.push(`-Dmagnolia.license.key=${baseConfig.license.key}`);
	}

	if (baseConfig.superuser.bootstrapPassword) {
		cargoArgs.push(
			`-Dmagnolia.superuser.bootstrap.password=${baseConfig.superuser.bootstrapPassword}`
		);
	}

	return {
		instanceType,
		instanceMode: instanceType,
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
		mavenCommand: baseConfig.maven.command,
		cargoArgs,
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
};

export const getSelectedInstanceConfigs = (config) =>
	config.instanceMode === "both" ? [config.author, config.public] : [config];

/**
 * Load and cache configuration
 */
export const getConfig = async () => {
	const instanceMode = normalizeInstanceMode(
		process.env.MAGNOLIA_INSTANCE_MODE || process.env.MAGNOLIA_INSTANCE || "author"
	);
	const envKey = instanceMode;
	
	// Invalidate cache if environment variables changed
	if (cachedConfig && cachedEnvKey !== envKey) {
		cachedConfig = null;
		cachedEnvKey = null;
	}
	
	if (!cachedConfig) {
		const baseConfig = await loadConfig();

		cachedConfig = instanceMode === "both"
			? {
				instanceMode: "both",
				author: buildInstanceConfig(baseConfig, "author"),
				public: buildInstanceConfig(baseConfig, "public"),
				baseConfig,
			}
			: buildInstanceConfig(baseConfig, instanceMode);
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
			command = `netstat -ano -p tcp | findstr ":${port}" | findstr "LISTENING"`;
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
			command = `netstat -ano -p tcp | findstr ":${port}" | findstr "LISTENING"`;
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
	const existing = await loadPids(pidFile);
	const data = {
		cargoPid,
		tomcatPids,
		maildevPid,
		timestamp: existing?.timestamp || new Date().toISOString(),
	};
	await fs.writeFile(pidFile, JSON.stringify(data, null, 2));
};

const normalizeText = (value = "") => value.replace(/\\/g, "/").toLowerCase();

const listWindowsProcesses = async () => {
	if (process.platform !== "win32") return [];

	try {
		const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";
		const { stdout } = await execAsync(
			`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${command}"`,
			{ maxBuffer: 16 * 1024 * 1024, windowsHide: true }
		);
		const parsed = JSON.parse(stdout?.trim() || "[]");
		return Array.isArray(parsed) ? parsed : parsed?.ProcessId ? [parsed] : [];
	} catch (error) {
		return [];
	}
};

export const getLikelyCargoPids = async (config) => {
	if (process.platform !== "win32") return [];

	const cargoHome = normalizeText(config.cargoHome);
	const reposDir = normalizeText(config.reposDir);
	const profileMarker = normalizeText(`cargo:run -p${config.profileConfig.profile}`);
	const pids = new Set();

	for (const processInfo of await listWindowsProcesses()) {
		const commandLine = normalizeText(processInfo.CommandLine || "");
		if (
			(cargoHome && commandLine.includes(cargoHome)) ||
			(reposDir && commandLine.includes(reposDir)) ||
			(profileMarker && commandLine.includes(profileMarker))
		) {
			pids.add(String(processInfo.ProcessId));
		}
	}

	return [...pids];
};

export const forceStopLikelyCargoProcesses = async (config) => {
	const killedPids = [];
	for (const pid of await getLikelyCargoPids(config)) {
		if (await killProcess(pid)) killedPids.push(pid);
	}
	if (killedPids.length) {
		await new Promise((resolve) => setTimeout(resolve, LOCK_RELEASE_WAIT_MS));
	}
	return killedPids;
};

/**
 * Kill process by PID
 */
export const killProcess = async (pid) => {
	try {
		const platform = process.platform;
		const command = platform === "win32" ? `taskkill /T /F /PID ${pid}` : `kill -9 ${pid}`;
		await execAsync(command);
		return true;
	} catch (error) {
		return false;
	}
};

export { PROJECT_ROOT };

