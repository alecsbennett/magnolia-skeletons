import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import http from "http";
import https from "https";
import notifier from "node-notifier";
import {
	getConfig,
	getSelectedInstanceConfigs,
	savePids,
	getPidsFromPort,
	loadPids,
	PROJECT_ROOT,
} from "./utils.mjs";

const DEBUG = process.env.DEBUG === "true";
const debugLog = (...args) => {
	if (DEBUG) console.log(...args);
};

const serverResponding = (serverUrl) => new Promise((resolve) => {
	const client = serverUrl.startsWith("https:") ? https : http;
	const request = client.get(serverUrl, { timeout: 2000 }, (response) => {
		response.destroy();
		resolve(true);
	});
	request.on("error", () => resolve(false));
	request.on("timeout", () => {
		request.destroy();
		resolve(false);
	});
});

const monitorLogs = async (config) => {
	const logPath = path.join(config.logDir, config.logFile);
	let initialSize = 0;
	let checks = 0;

	try {
		initialSize = (await fs.stat(logPath)).size;
	} catch (error) {
		// The log is normally created after Cargo starts.
	}

	console.log(`👀 Monitoring ${config.instanceType} logs for server startup...`);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(interval);
			reject(new Error(`Timeout waiting for ${config.instanceType} server startup`));
		}, config.startupTimeout);

		const interval = setInterval(async () => {
			checks++;
			try {
				const stats = await fs.stat(logPath);
				if (stats.size > initialSize) {
					const length = Math.min(stats.size - initialSize, 100000);
					const start = Math.max(initialSize, stats.size - length);
					const handle = await fs.open(logPath, "r");
					const buffer = Buffer.alloc(length);
					await handle.read(buffer, 0, length, start);
					await handle.close();

					const content = buffer.toString("utf-8");
					if (content.includes("Magnolia could not be started")) {
						clearInterval(interval);
						clearTimeout(timeout);
						reject(new Error(`${config.instanceType} Magnolia startup failed; check ${logPath}`));
						return;
					}

					config.startupPattern.lastIndex = 0;
					if (config.startupPattern.test(content)) {
						clearInterval(interval);
						clearTimeout(timeout);
						resolve();
						return;
					}
				}

				if (checks % 10 === 0 && await serverResponding(config.serverUrl)) {
					clearInterval(interval);
					clearTimeout(timeout);
					resolve();
				}
			} catch (error) {
				debugLog(`[${config.instanceType}] ${error.message}`);
			}
		}, config.pollInterval);
	});
};

const updatePids = async (config) => {
	const pidData = await loadPids(config.pidFile);
	if (!pidData) return;

	const tomcatPids = (await getPidsFromPort(config.cargoPort))
		.filter((pid) => String(pid) !== String(pidData.cargoPid));
	await savePids(config.pidFile, pidData.cargoPid, tomcatPids, pidData.maildevPid);
};

const openBrowser = (url) => {
	if (process.platform === "win32") {
		exec(`start "" "${url}"`);
	} else if (process.platform === "darwin") {
		exec(`open "${url}"`);
	} else {
		exec(`xdg-open "${url}"`);
	}
};

const recordStartupTime = async () => {
	const logPath = path.join(PROJECT_ROOT, "startTimes.log");
	try {
		const content = await fs.readFile(logPath, "utf-8");
		const startLine = content.trim().split("\n").reverse().find((line) => line.startsWith("START"));
		if (!startLine) return;

		const startTime = Number(startLine.split(" | ")[2]);
		const elapsed = Date.now() - startTime;
		await fs.appendFile(
			logPath,
			`FINISH | ${new Date().toISOString()} | ${Date.now()} | Elapsed: ${Math.floor(elapsed / 60000)}min ${Math.floor((elapsed % 60000) / 1000)}s\n`,
			"utf-8"
		);
		console.log(`⏱️  Startup completed in ${Math.floor(elapsed / 60000)}min ${Math.floor((elapsed % 60000) / 1000)}s`);
	} catch (error) {
		debugLog(error.message);
	}
};

const main = async () => {
	const config = await getConfig();
	const configs = getSelectedInstanceConfigs(config);
	const primaryConfig = configs[0];

	await Promise.all(configs.map(monitorLogs));
	await Promise.all(configs.map(updatePids));

	if (config.instanceMode === "both") {
		console.log(`\n🔗 Author: ${config.author.serverUrl}`);
		console.log(`🔗 Public: ${config.public.serverUrl}\n`);
	} else {
		console.log(`\n🔗 ${primaryConfig.serverUrl}\n`);
	}

	await recordStartupTime();
	console.log("\n💡 Type 'x' or 'q' + Enter to gracefully shut down\n");

	if (primaryConfig.showToasts && primaryConfig.notificationConfig) {
		const notification = primaryConfig.notificationConfig;
		const titleMode = config.instanceMode === "both" ? "BOTH" : primaryConfig.instanceType.toUpperCase();
		notifier.notify({
			title: `${notification.titlePrefix} ${titleMode} Server Loaded`,
			message: config.instanceMode === "both"
				? `Author: ${config.author.serverUrl}\nPublic: ${config.public.serverUrl}`
				: `Server is ready: ${primaryConfig.serverUrl}`,
			sound: notification.sound,
			wait: false,
			timeout: notification.timeout,
			appID: notification.appId,
			icon: path.join("./assets/magnolia-logo.png"),
		});
	}

	if (primaryConfig.openBrowser || process.env.OPEN_BROWSER === "true") {
		openBrowser(primaryConfig.serverUrl);
	}
};

main().catch((error) => {
	console.error("\n❌ Error:", error.message);
	process.exit(1);
});
