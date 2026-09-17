import { promises as fs } from "fs";
import { spawn } from "child_process";
import { killProcess } from "./utils.mjs";

let runningAdditionalProcess = null;

const isBlank = (value) => String(value ?? "").trim().length === 0;

const pidFile = (baseConfig) => baseConfig?.pids?.startxAdditional;
const additionalConfig = (baseConfig) => baseConfig?.startx ?? {};

const readPidData = async (file) => {
	if (!file) return null;
	try {
		return JSON.parse(await fs.readFile(file, "utf-8"));
	} catch {
		return null;
	}
};

const writePidData = async (file, data) => {
	if (!file) return;
	await fs.writeFile(file, JSON.stringify(data, null, 2));
};

const removePidFile = async (file) => {
	if (!file) return;
	try {
		await fs.unlink(file);
	} catch {
		// PID file is optional.
	}
};

const runOneShotCommand = async (command, cwd, label) => {
	if (isBlank(command)) return 0;

	console.log(`🔧 Running ${label}: ${command}`);
	return await new Promise((resolve) => {
		const child = spawn(command, {
			cwd,
			stdio: "inherit",
			shell: true,
			env: {
				...process.env,
				MAGNOLIA_STARTX: "true",
			},
		});

		child.on("error", (error) => {
			console.warn(`⚠️  ${label} failed to start: ${error.message}`);
			resolve(1);
		});

		child.on("exit", (code) => {
			resolve(code ?? 0);
		});
	});
};

export const startAdditionalScript = async (baseConfig, onUnexpectedExit) => {
	const config = additionalConfig(baseConfig);
	const command = String(config.additionalScript ?? "").trim();
	if (!command) return null;

	const cwd = config.additionalCwd || baseConfig.paths.projectRoot;
	const file = pidFile(baseConfig);

	await stopAdditionalScript(baseConfig, { runShutdownScript: false, quiet: true });

	console.log(`🔧 Starting startx additional script: ${command}`);
	console.log(`   Working directory: ${cwd}`);

	const child = spawn(command, {
		cwd,
		stdio: "inherit",
		shell: true,
		env: {
			...process.env,
			MAGNOLIA_STARTX: "true",
		},
	});

	runningAdditionalProcess = child;
	await writePidData(file, {
		pid: child.pid,
		command,
		cwd,
		timestamp: new Date().toISOString(),
	});

	child.on("error", (error) => {
		console.error(`❌ startx additional script failed to start: ${error.message}`);
		onUnexpectedExit?.(1);
	});

	child.on("exit", async (code) => {
		if (runningAdditionalProcess === child) {
			runningAdditionalProcess = null;
			await removePidFile(file);
		}

		if (code !== 0 && code !== null) {
			console.error(`❌ startx additional script exited with code ${code}`);
			onUnexpectedExit?.(code);
		}
	});

	console.log(`📝 startx additional script started with PID: ${child.pid}\n`);
	return child;
};

export const stopAdditionalScript = async (baseConfig, options = {}) => {
	const { runShutdownScript = true, quiet = false } = options;
	const config = additionalConfig(baseConfig);
	const file = pidFile(baseConfig);
	const cwd = config.additionalCwd || baseConfig.paths.projectRoot;
	const pidData = await readPidData(file);
	const pid = runningAdditionalProcess?.pid || pidData?.pid;

	if (runShutdownScript && !isBlank(config.additionalShutdownScript)) {
		const code = await runOneShotCommand(config.additionalShutdownScript, cwd, "startx additional shutdown script");
		if (code !== 0) {
			console.warn(`⚠️  startx additional shutdown script exited with code ${code}`);
		}
	}

	if (pid) {
		if (!quiet) {
			console.log(`🔄 Stopping startx additional script process (${pid})...`);
		}

		try {
			if (runningAdditionalProcess && !runningAdditionalProcess.killed) {
				runningAdditionalProcess.kill("SIGTERM");
			}
		} catch {
			// Fall back to force kill below.
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
		await killProcess(pid);
	}

	runningAdditionalProcess = null;
	await removePidFile(file);
};
