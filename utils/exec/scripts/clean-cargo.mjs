import { promises as fs } from "fs";
import { getConfig } from "./utils.mjs";

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000; // 1 second delay between retries

const cleanCargoDirectory = async (cargoHome, attempt = 1) => {
	try {
		await fs.rm(cargoHome, { recursive: true, force: true });
		await new Promise(resolve => setTimeout(resolve, 500));
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') {
			// Directory doesn't exist - this is fine
			return true;
		}
		
		// If this is a locking/permission error and we have retries left, retry
		if (attempt < RETRY_ATTEMPTS) {
			const isLockError = 
				error.code === 'EBUSY' || // File/directory is busy (Windows)
				error.code === 'EPERM' || // Permission denied (could be locked)
				error.code === 'EACCES' || // Access denied
				error.message?.toLowerCase().includes('locked') ||
				error.message?.toLowerCase().includes('in use');
			
			if (isLockError) {
				console.log(`⚠️  Lock detected (attempt ${attempt}/${RETRY_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms...`);
				await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
				return cleanCargoDirectory(cargoHome, attempt + 1);
			}
		}
		
		// Re-throw if we can't handle it or out of retries
		throw error;
	}
};

const main = async () => {
	const config = await getConfig();
	
	try {
		console.log("🧹 Cleaning cargo directory...");
		
		try {
			await cleanCargoDirectory(config.cargoHome);
			console.log("✅ Cargo directory cleaned\n");
		} catch (error) {
			if (error.code === 'ENOENT') {
				console.log("ℹ️  Cargo directory doesn't exist yet\n");
			} else {
				console.error("⚠️  Error cleaning cargo directory after retries:", error.message);
				process.exit(1);
			}
		}
	} catch (error) {
		console.error("⚠️  Error:", error.message);
		process.exit(1);
	}
};

main();

