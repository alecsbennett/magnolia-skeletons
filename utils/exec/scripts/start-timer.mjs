import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get project root (three levels up from utils/exec/scripts)
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const START_TIMES_LOG = path.join(PROJECT_ROOT, "startTimes.log");

const main = async () => {
	const startTime = Date.now();
	const timestamp = new Date().toISOString();
	const logEntry = `START | ${timestamp} | ${startTime}\n`;
	
	try {
		await fs.appendFile(START_TIMES_LOG, logEntry, "utf-8");
	} catch (error) {
		console.error(`⚠️  Failed to log start time: ${error.message}`);
		process.exit(1);
	}
};

main();

