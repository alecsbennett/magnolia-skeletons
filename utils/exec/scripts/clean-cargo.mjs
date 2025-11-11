import { promises as fs } from "fs";
import { getConfig } from "./utils.mjs";

const main = async () => {
	const config = await getConfig();
	
	try {
		console.log("🧹 Cleaning cargo directory...");
		
		try {
			await fs.rm(config.cargoHome, { recursive: true, force: true });
			await new Promise(resolve => setTimeout(resolve, 500));
			console.log("✅ Cargo directory cleaned\n");
		} catch (error) {
			if (error.code === 'ENOENT') {
				console.log("ℹ️  Cargo directory doesn't exist yet\n");
			} else {
				console.error("⚠️  Error cleaning cargo directory:", error.message);
				process.exit(1);
			}
		}
	} catch (error) {
		console.error("⚠️  Error:", error.message);
		process.exit(1);
	}
};

main();

