import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
	pidFile: path.resolve(__dirname, ".cargo.pid"),
	forceKill: process.env.FORCE === "true",
};

// Prompt user for input
const prompt = (question) => {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
};

// Kill all Java processes
const killAllJava = async () => {
	try {
		const platform = process.platform;
		const command = platform === "win32" 
			? `taskkill /F /IM java.exe` 
			: `pkill -9 java`;
		const { stdout, stderr } = await execAsync(command);
		return { success: true, output: stdout || stderr };
	} catch (error) {
		return { success: false, output: error.message };
	}
};

// Kill all Node processes (excluding current)
const killAllNode = async () => {
	try {
		const platform = process.platform;
		if (platform === "win32") {
			// On Windows, kill all node.exe except current process
			const command = `for /f "tokens=2" %a in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST ^| find "PID:"') do @if not %a==${process.pid} taskkill /F /PID %a`;
			const { stdout, stderr } = await execAsync(command);
			return { success: true, output: stdout || stderr };
		} else {
			// On Unix, kill all node processes except current
			const command = `ps aux | grep node | grep -v ${process.pid} | grep -v grep | awk '{print $2}' | xargs kill -9`;
			const { stdout, stderr } = await execAsync(command);
			return { success: true, output: stdout || stderr };
		}
	} catch (error) {
		return { success: false, output: error.message };
	}
};

// Main execution
const main = async () => {
	console.log("⚠️  FORCE KILL - This will terminate ALL Java processes\n");
	
	if (!CONFIG.forceKill) {
		const answer = await prompt("Are you sure you want to kill ALL Java processes? (yes/no): ");
		
		if (answer.toLowerCase() !== "yes") {
			console.log("❌ Cancelled. Use 'npm run kill' for normal shutdown.");
			process.exit(0);
		}
	}
	
	console.log("\n🛑 Force killing all Java processes...\n");
	
	// Kill all Java processes
	const javaResult = await killAllJava();
	if (javaResult.success) {
		console.log("✅ All Java processes terminated");
	} else {
		console.log("⚠️  Error killing Java processes:", javaResult.output);
	}
	
	// Clean up PID file
	try {
		await fs.unlink(CONFIG.pidFile);
		console.log("🧹 Cleaned up PID file");
	} catch (error) {
		// Ignore if file doesn't exist
	}
	
	console.log(`\n${"=".repeat(60)}`);
	console.log("✅ Force kill complete");
	console.log(`${"=".repeat(60)}\n`);
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});

