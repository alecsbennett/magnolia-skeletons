import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import loadConfig from "./loadConfig.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const main = async () => {
	try {
		const baseConfig = await loadConfig();
		
		if (!baseConfig.maildev.enabled) {
			console.log("⏭️ MailDev is disabled in configuration");
			process.exit(0);
		}
		
		const CONFIG = {
			maildevPidFile: baseConfig.pids.maildev,
			maildevSmtpPort: baseConfig.ports.maildev.smtp,
			maildevUiPort: baseConfig.ports.maildev.ui,
			maildevUrl: baseConfig.maildev.url
		};
		
		console.log("📧 Starting MailDev server...");
		console.log(`   SMTP port: ${CONFIG.maildevSmtpPort}`);
		console.log(`   Web UI port: ${CONFIG.maildevUiPort}`);
		console.log(`   Web UI URL: ${CONFIG.maildevUrl}\n`);

		// Spawn MailDev as a detached child process so it runs in background
		const maildevRunnerScript = path.join(__dirname, "scripts", "maildev-runner.mjs");
		
		const maildevProcess = spawn("node", [maildevRunnerScript], {
			detached: true,
			stdio: "inherit",
			shell: true,
		});

		maildevProcess.unref(); // Allow parent to exit

		// Wait a moment for MailDev to start
		await new Promise(resolve => setTimeout(resolve, 2000));

		console.log(`📝 MailDev started in background (PID: ${maildevProcess.pid})\n`);
		console.log(`${"=".repeat(60)}`);
		console.log(`🎉 MAILDEV SERVER IS STARTING!`);
		console.log(`🔗 SMTP: localhost:${CONFIG.maildevSmtpPort}`);
		console.log(`🔗 UI: ${CONFIG.maildevUrl}`);
		console.log(`${"=".repeat(60)}\n`);

		process.exit(0);

	} catch (error) {
		console.error("❌ Error starting MailDev:", error.message);
		process.exit(1);
	}
};

main();
