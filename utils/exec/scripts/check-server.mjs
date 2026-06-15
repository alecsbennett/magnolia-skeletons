import { promises as fs } from "fs";
import {
	getConfig,
	getSelectedInstanceConfigs,
	loadPids,
	isPortInUse,
	killProcess,
	getPidsFromPort,
} from "./utils.mjs";

const checkInstance = async (config) => {
	const portInUse = await isPortInUse(config.cargoPort);
	const pidData = await loadPids(config.pidFile);

	if (!portInUse && !pidData) {
		return { running: false, pidData };
	}

	console.log(`\n⚠️  ${config.instanceType} server appears to be already running!`);
	if (pidData) {
		console.log(`   Cargo PID: ${pidData.cargoPid}`);
		if (pidData.tomcatPids?.length) {
			console.log(`   Tomcat PIDs: ${pidData.tomcatPids.join(", ")}`);
		}
		console.log(`   Started: ${new Date(pidData.timestamp).toLocaleString()}`);
	}

	return { running: true, pidData };
};

const stopInstance = async (config, pidData) => {
	if (pidData?.cargoPid) await killProcess(pidData.cargoPid);
	for (const pid of pidData?.tomcatPids || []) await killProcess(pid);

	for (const port of [config.cargoPort, config.rmiPort, config.profileConfig.shutdownPort]) {
		for (const pid of await getPidsFromPort(port)) {
			await killProcess(pid);
		}
	}

	try {
		await fs.unlink(config.pidFile);
	} catch (error) {
		// PID file is optional.
	}
};

const main = async () => {
	const config = await getConfig();
	const configs = getSelectedInstanceConfigs(config);

	console.log("🔍 Checking if server is already running...");
	const results = await Promise.all(configs.map(checkInstance));

	if (!results.some((result) => result.running)) {
		console.log("✅ No existing server found\n");
		return;
	}

	const forceRestart =
		configs.some((instanceConfig) => instanceConfig.forceRestart) ||
		process.env.FORCE_RESTART === "true";

	if (!forceRestart) {
		console.log("\n❌ Server is already running. Use 'npm run kill' to stop it first.");
		console.log("   Or set FORCE_RESTART=true to automatically restart.");
		process.exit(1);
	}

	console.log("🔄 FORCE_RESTART enabled, stopping existing server(s)...\n");
	for (let index = 0; index < configs.length; index++) {
		if (results[index].running) {
			await stopInstance(configs[index], results[index].pidData);
		}
	}

	await new Promise((resolve) => setTimeout(resolve, 2500));
	console.log("✅ Server stopped\n");
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});
