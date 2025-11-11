import { promises as fs } from "fs";
import path from "path";
import { getConfig } from "./utils.mjs";

const main = async () => {
	const config = await getConfig();
	
	if (!config.clearLogs && process.env.CLEAR_LOGS !== "true") {
		console.log("⏭️ Skipping log clearing (disabled in config)");
		process.exit(0);
	}
	
	try {
		console.log("🧹 Clearing logs...");
		
		const files = await fs.readdir(config.logDir);
		for (const file of files) {
			const filePath = path.join(config.logDir, file);
			try {
				const stat = await fs.lstat(filePath);
				if (stat.isFile()) {
					await fs.unlink(filePath);
				}
			} catch (error) {
				// Ignore errors
			}
		}
		console.log("✅ Logs cleared\n");
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.log("ℹ️  Log directory doesn't exist yet\n");
		} else {
			console.error("⚠️  Error clearing logs:", error.message);
			process.exit(1);
		}
	}
};

main();

