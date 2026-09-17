import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (file, fallback = null) => {
	try {
		return JSON.parse(await fs.readFile(file, "utf-8"));
	} catch (error) {
		if (error.code === "ENOENT") return fallback;
		throw new Error(`Could not read ${file}: ${error.message}`);
	}
};

const writeJsonAtomically = async (file, value) => {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	await fs.rename(temp, file);
};

const removeFile = async (file) => {
	try {
		await fs.unlink(file);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
};

const runCommand = async (command, cwd, label) => new Promise((resolve, reject) => {
	console.log(`🔧 ${label}: ${command}`);
	const child = spawn(command, {
		cwd,
		stdio: "inherit",
		shell: true,
		env: { ...process.env, MAGNOLIA_STARTX: "true" },
	});
	child.on("error", reject);
	child.on("exit", (code) => {
		if (code === 0) resolve();
		else reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
	});
});

const isHealthy = async (url) => {
	try {
		return (await fetch(url)).ok;
	} catch {
		return false;
	}
};

const waitForHealth = async (url, timeoutMs, pollMs, wanted) => {
	const deadline = Date.now() + timeoutMs;
	do {
		if ((await isHealthy(url)) === wanted) return true;
		await sleep(pollMs);
	} while (Date.now() < deadline);
	return false;
};

const getServiceConfig = (baseConfig) => ({
	descriptorFile: baseConfig?.startx?.servicesFile,
	stateFile: baseConfig?.pids?.startxServices,
	projectRoot: baseConfig?.paths?.projectRoot,
});

const loadServices = async (baseConfig) => {
	const { descriptorFile, projectRoot } = getServiceConfig(baseConfig);
	if (!descriptorFile) return [];
	const descriptor = await readJson(descriptorFile);
	if (!descriptor || !Array.isArray(descriptor.services)) {
		throw new Error(`Service descriptor must contain a services array: ${descriptorFile}`);
	}

	const names = new Set();
	return descriptor.services.map((service, index) => {
		if (!service || typeof service !== "object") throw new Error(`Service ${index + 1} must be an object`);
		const name = String(service.name ?? "").trim();
		const start = String(service.start ?? "").trim();
		const stop = String(service.stop ?? "").trim();
		const healthUrl = String(service.healthUrl ?? "").trim();
		if (!name || !start || !stop || !healthUrl) {
			throw new Error(`Service ${index + 1} requires name, start, stop, and healthUrl`);
		}
		if (names.has(name)) throw new Error(`Service names must be unique: ${name}`);
		names.add(name);
		return {
			name,
			start,
			stop,
			healthUrl,
			cwd: path.resolve(projectRoot, service.cwd || "."),
			timeoutMs: Number(service.timeoutMs ?? 30000),
			pollIntervalMs: Number(service.pollIntervalMs ?? 500),
		};
	});
};

const reconcileStaleState = async (stateFile) => {
	if (!stateFile) return;
	const stale = await readJson(stateFile);
	if (stale?.services?.length) {
		console.warn("⚠️  Found a previous startx service ledger; preserving any running services as externally managed.");
	}
	await removeFile(stateFile);
};

const stopRecordedServices = async (services, stateFile, { quiet = false } = {}) => {
	const failures = [];
	for (const service of [...services].reverse()) {
		try {
			if (!quiet) console.log(`🛑 Stopping companion service: ${service.name}`);
			await runCommand(service.stop, service.cwd, `Stopping ${service.name}`);
			if (!(await waitForHealth(service.healthUrl, service.timeoutMs, service.pollIntervalMs, false))) {
				throw new Error(`${service.name} remained healthy after its stop command`);
			}
		} catch (error) {
			failures.push(error);
			console.warn(`⚠️  ${error.message}`);
		}
	}
	if (stateFile) await removeFile(stateFile);
	return failures;
};

export const startServices = async (baseConfig) => {
	const { descriptorFile, stateFile } = getServiceConfig(baseConfig);
	if (!descriptorFile) return [];
	if (!stateFile) throw new Error("Service state file is not configured");

	await reconcileStaleState(stateFile);
	const services = await loadServices(baseConfig);
	const started = [];
	try {
		for (const service of services) {
			if (await isHealthy(service.healthUrl)) {
				console.log(`ℹ️  Companion service already healthy: ${service.name}`);
				continue;
			}
			await runCommand(service.start, service.cwd, `Starting ${service.name}`);
			if (!(await waitForHealth(service.healthUrl, service.timeoutMs, service.pollIntervalMs, true))) {
				throw new Error(`${service.name} did not become healthy at ${service.healthUrl}`);
			}
			started.push(service);
			await writeJsonAtomically(stateFile, { version: 1, services: started, startedAt: new Date().toISOString() });
			console.log(`✅ Companion service healthy: ${service.name}`);
		}
		return started;
	} catch (error) {
		await stopRecordedServices(started, stateFile, { quiet: true });
		throw error;
	}
};

export const stopServices = async (baseConfig) => {
	const { descriptorFile, stateFile } = getServiceConfig(baseConfig);
	if (!descriptorFile || !stateFile) return [];
	const state = await readJson(stateFile);
	if (!state?.services?.length) return [];
	return stopRecordedServices(state.services, stateFile);
};

export const serviceStatus = async (baseConfig) => {
	const services = await loadServices(baseConfig);
	return Promise.all(services.map(async (service) => ({ name: service.name, healthy: await isHealthy(service.healthUrl), healthUrl: service.healthUrl })));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { default: loadConfig } = await import("../loadConfig.mjs");
	const config = await loadConfig();
	const command = process.argv[2] ?? "status";
	if (command === "status") console.log(JSON.stringify(await serviceStatus(config), null, 2));
	else if (command === "start") await startServices(config);
	else if (command === "stop") await stopServices(config);
	else throw new Error(`Unknown service command: ${command}`);
}
