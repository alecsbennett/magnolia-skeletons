import maildev from "maildev";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import loadConfig from "../loadConfig.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const main = async () => {
	try {
		const baseConfig = await loadConfig();
		
		const CONFIG = {
			maildevPidFile: baseConfig.pids.maildev,
			maildevSmtpPort: baseConfig.ports.maildev.smtp,
			maildevUiPort: baseConfig.ports.maildev.ui,
			maildevUrl: baseConfig.maildev.url
		};
		
		const maildevServer = maildev({
			smtp: CONFIG.maildevSmtpPort,
			web: CONFIG.maildevUiPort,
			hideExtensions: false,
			hideAppName: false,
			disableWeb: false,
			outgoingHost: null,
			outgoingPort: null,
			outgoingUser: null,
			outgoingPass: null,
			autoRelay: false,
			silent: false,
			verbose: true
		});
		
		maildevServer.listen((err) => {
			if (err) {
				console.error("❌ Error starting MailDev:", err.message);
				process.exit(1);
			} else {
				console.log("✅ MailDev server started successfully");
				console.log(`   View emails at: ${CONFIG.maildevUrl}`);
				
				const maildevData = {
					maildevPid: process.pid,
					timestamp: new Date().toISOString(),
				};
				fs.writeFile(CONFIG.maildevPidFile, JSON.stringify(maildevData, null, 2))
					.then(() => console.log(`💾 Process ID saved`))
					.catch(err => console.error("Error saving PID:", err));
				
				process.on("SIGINT", () => {
					console.log("\n👋 Shutting down MailDev server...");
					process.exit(0);
				});
				process.on("SIGTERM", () => {
					console.log("\n👋 Shutting down MailDev server...");
					process.exit(0);
				});
			}
		});
		
		// Keep running
		await new Promise(() => {});
		
	} catch (error) {
		console.error("❌ Error starting MailDev:", error.message);
		process.exit(1);
	}
};

main();

