import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import loadConfig from "./loadConfig.mjs";
import { getLikelyCargoPids } from "./scripts/utils.mjs";

const execAsync = promisify(exec);

const killProcess = async (pid) => {
	try {
		const command = process.platform === "win32"
			? `taskkill /T /F /PID ${pid}`
			: `kill -9 ${pid}`;
		await execAsync(command);
		return true;
	} catch (error) {
		return false;
	}
};

const getPidsFromPort = async (port) => {
	try {
		const command = process.platform === "win32"
			? `netstat -ano -p tcp | findstr ":${port}" | findstr "LISTENING"`
			: `lsof -i :${port} -t`;
		const { stdout } = await execAsync(command);
		if (process.platform !== "win32") {
			return stdout.trim().split("\n").filter(Boolean);
		}

		const pids = new Set();
		for (const line of stdout.split("\n")) {
			const match = line.trim().match(/\s+(\d+)$/);
			if (match) pids.add(match[1]);
		}
		return [...pids];
	} catch (error) {
		return [];
	}
};

const loadPids = async (pidFile) => {
	try {
		return JSON.parse(await fs.readFile(pidFile, "utf-8"));
	} catch (error) {
		return null;
	}
};

const buildInstanceConfig = (baseConfig, instanceType) => {
	const isAuthor = instanceType === "author";
	const ports = isAuthor ? baseConfig.ports.author : baseConfig.ports.runtime;
	return {
		instanceType,
		pidFile: isAuthor ? baseConfig.pids.author : baseConfig.pids.runtime,
		profile: isAuthor ? baseConfig.maven.profiles.author : baseConfig.maven.profiles.runtime,
		profileConfig: {
			profile: isAuthor ? baseConfig.maven.profiles.author : baseConfig.maven.profiles.runtime,
		},
		ports: [ports.cargo, ports.rmi, ports.shutdown],
		cargoPort: ports.cargo,
		cargoWorkingDir: baseConfig.paths.workingDir,
		cargoHome: (isAuthor ? baseConfig.paths.author : baseConfig.paths.runtime).cargoHome,
		reposDir: (isAuthor ? baseConfig.paths.author : baseConfig.paths.runtime).repos,
		mavenCommand: baseConfig.maven.command,
	};
};

const stopInstance = async (config) => {
	const pidData = await loadPids(config.pidFile);
	const portPids = await getPidsFromPort(config.cargoPort);

	if (!pidData && portPids.length === 0) {
		console.log(`ℹ️  No running ${config.instanceType} instance found`);
		return 0;
	}

	console.log(`\n🛑 Stopping ${config.instanceType} instance...`);
	try {
		await execAsync(
			`${config.mavenCommand} cargo:stop -Dcargo.tomcat.shutdown.quiet=true -P${config.profile}`,
			{ cwd: config.cargoWorkingDir, timeout: 60000 }
		);
	} catch (error) {
		console.warn(`⚠️  Graceful Cargo stop did not complete for ${config.instanceType}`);
	}

	let killedCount = 0;
	if (pidData?.cargoPid && await killProcess(pidData.cargoPid)) killedCount++;
	for (const pid of pidData?.tomcatPids || []) {
		if (await killProcess(pid)) killedCount++;
	}
	for (const port of config.ports) {
		for (const pid of await getPidsFromPort(port)) {
			if (await killProcess(pid)) killedCount++;
		}
	}
	for (const pid of await getLikelyCargoPids(config)) {
		if (await killProcess(pid)) killedCount++;
	}

	try {
		await fs.unlink(config.pidFile);
	} catch (error) {
		// PID file is optional.
	}

	console.log(`✅ ${config.instanceType} instance stopped`);
	return killedCount;
};

const stopMailDev = async (baseConfig) => {
	const pidData = await loadPids(baseConfig.pids.maildev);
	if (pidData?.maildevPid) await killProcess(pidData.maildevPid);

	for (const port of [baseConfig.ports.maildev.smtp, baseConfig.ports.maildev.ui]) {
		for (const pid of await getPidsFromPort(port)) {
			await killProcess(pid);
		}
	}

	try {
		await fs.unlink(baseConfig.pids.maildev);
	} catch (error) {
		// PID file is optional.
	}
};

const main = async () => {
	const baseConfig = await loadConfig();
	const configs = [
		buildInstanceConfig(baseConfig, "author"),
		buildInstanceConfig(baseConfig, "public"),
	];

	console.log("🛑 Stopping Magnolia Cargo server(s)...");
	await stopMailDev(baseConfig);

	let killedCount = 0;
	for (const config of configs) {
		killedCount += await stopInstance(config);
	}

	console.log(killedCount > 0
		? `\n✅ Stopped ${killedCount} tracked process(es)`
		: "\n✅ Magnolia Cargo is stopped");
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});
