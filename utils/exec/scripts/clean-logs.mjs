import { promises as fs } from "fs";
import path from "path";
import { getConfig, getSelectedInstanceConfigs } from "./utils.mjs";

const main = async () => {
	const config = await getConfig();
	const configs = getSelectedInstanceConfigs(config);
	
	if (!configs[0].clearLogs && process.env.CLEAR_LOGS !== "true") {
		console.log("⏭️ Skipping log clearing (disabled in config)");
		process.exit(0);
	}
	
	try {
		console.log("🧹 Clearing logs...");
		
		for (const instanceConfig of configs) {
			try {
				const files = await fs.readdir(instanceConfig.logDir);
				for (const file of files) {
					const filePath = path.join(instanceConfig.logDir, file);
					try {
						const stat = await fs.lstat(filePath);
						if (stat.isFile()) {
							await fs.unlink(filePath);
						}
					} catch (error) {
						// Ignore errors
					}
				}
				console.log(`✅ ${instanceConfig.instanceType} logs cleared`);
			} catch (error) {
				if (error.code === 'ENOENT') {
					console.log(`ℹ️  ${instanceConfig.instanceType} log directory doesn't exist yet`);
				} else {
					throw error;
				}
			}
		}
		console.log();
	} catch (error) {
		console.error("⚠️  Error clearing logs:", error.message);
		process.exit(1);
	}
};

main();

