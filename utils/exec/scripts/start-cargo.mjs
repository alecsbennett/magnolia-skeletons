import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { createInterface } from "readline";
import {
	getConfig,
	getSelectedInstanceConfigs,
	savePids,
	isPortInUse,
	killProcess,
	forceStopLikelyCargoProcesses,
} from "./utils.mjs";

const cargoProcesses = [];
let shutdownInProgress = false;

const waitForPortRelease = async (config) => {
	for (let attempt = 0; attempt < 30; attempt++) {
		if (!(await isPortInUse(config.cargoPort))) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	return false;
};

const gracefulShutdown = async (configs, rl, exitCode = 0) => {
	if (shutdownInProgress) return;
	shutdownInProgress = true;

	console.log("\n👋 Shutting down Magnolia...");
	rl?.close();

	for (const { config, process: cargoProcess } of cargoProcesses) {
		if (!cargoProcess.killed) {
			console.log(`🔄 Stopping ${config.instanceType} Cargo process...`);
			cargoProcess.kill("SIGTERM");
		}
	}

	for (const { config, process: cargoProcess } of cargoProcesses) {
		await waitForPortRelease(config);
		await killProcess(cargoProcess.pid);
		await forceStopLikelyCargoProcesses(config);
	}

	for (const config of configs) {
		try {
			await fs.unlink(config.pidFile);
		} catch (error) {
			// PID file is optional.
		}
	}

	console.log("✅ Shutdown complete");
	process.exit(exitCode);
};

const startCargoForInstance = async (config, onUnexpectedExit) => {
	const sensitiveProperties = [
		"magnolia.license.key",
		"magnolia.superuser.bootstrap.password",
	];
	const displayArgs = config.cargoArgs.map((argument) => {
		const property = sensitiveProperties.find((name) =>
			argument.startsWith(`-D${name}=`)
		);
		return property ? `-D${property}=<redacted>` : argument;
	});

	console.log(`📦 Starting Maven Cargo (${config.instanceType})...`);
	console.log(`   Profile: ${config.profileConfig.profile}`);
	console.log(`   Command: ${config.cargoCommand} ${displayArgs.join(" ")}`);
	console.log(`   Working directory: ${config.cargoWorkingDir}`);
	console.log(`   Output redirecting to: ${path.join(config.logDir, config.logFile)}\n`);

	const cargoProcess = spawn(config.cargoCommand, config.cargoArgs, {
		cwd: config.cargoWorkingDir,
		stdio: ["ignore", "inherit", "inherit"],
		shell: true,
		env: process.env,
	});

	cargoProcesses.push({ config, process: cargoProcess });
	await savePids(config.pidFile, cargoProcess.pid, [], null);
	console.log(`📝 ${config.instanceType} Cargo process started with PID: ${cargoProcess.pid}\n`);

	cargoProcess.on("exit", async (code) => {
		try {
			await fs.unlink(config.pidFile);
		} catch (error) {
			// PID file is optional.
		}

		if (!shutdownInProgress && code !== 0 && code !== null) {
			onUnexpectedExit(config, code);
		}
	});
};

const main = async () => {
	const config = await getConfig();
	const configs = getSelectedInstanceConfigs(config);
	let rl;

	if (config.instanceMode === "both") {
		console.log("🚀 Starting both Magnolia instances (author + public)...\n");
	}

	const onUnexpectedExit = (instanceConfig, code) => {
		console.error(`❌ ${instanceConfig.instanceType} Cargo process exited with code ${code}`);
		gracefulShutdown(configs, rl, code);
	};

	await Promise.all(configs.map((instanceConfig) => startCargoForInstance(instanceConfig, onUnexpectedExit)));

	rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	rl.on("line", (input) => {
		if (["x", "q"].includes(input.trim().toLowerCase())) {
			gracefulShutdown(configs, rl);
		}
	});

	process.on("SIGINT", () => gracefulShutdown(configs, rl));
	process.on("SIGTERM", () => gracefulShutdown(configs, rl));

	await new Promise(() => {});
};

main().catch(async (error) => {
	console.error("❌ Error:", error.message);
	const config = await getConfig();
	await gracefulShutdown(getSelectedInstanceConfigs(config), null, 1);
});
