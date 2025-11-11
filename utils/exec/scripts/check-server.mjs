import { promises as fs } from "fs";
import path from "path";
import { getConfig, loadPids, isPortInUse, killProcess, getPidsFromPort } from "./utils.mjs";

const main = async () => {
	const config = await getConfig();
	
	console.log("🔍 Checking if server is already running...");
	
	const portInUse = await isPortInUse(config.cargoPort);
	const pidData = await loadPids(config.pidFile);
	
	if (portInUse || pidData) {
		console.log("\n⚠️  Server appears to be already running!");
		
		if (pidData) {
			console.log(`   Cargo PID: ${pidData.cargoPid}`);
			if (pidData.tomcatPids && pidData.tomcatPids.length > 0) {
				console.log(`   Tomcat PIDs: ${pidData.tomcatPids.join(", ")}`);
			}
			console.log(`   Started: ${new Date(pidData.timestamp).toLocaleString()}`);
		}
		
		if (config.forceRestart || process.env.FORCE_RESTART === "true") {
			console.log("🔄 FORCE_RESTART enabled, stopping existing server...\n");
			
			// Kill tracked PIDs
			if (pidData) {
				if (pidData.cargoPid) await killProcess(pidData.cargoPid);
				for (const pid of pidData.tomcatPids || []) await killProcess(pid);
				if (pidData.maildevPid) await killProcess(pidData.maildevPid);
			}
			
			// Kill any remaining processes on ports
			const portPids = await getPidsFromPort(config.cargoPort);
			for (const pid of portPids) await killProcess(pid);
			
			const maildevPids = await getPidsFromPort(config.maildevSmtpPort);
			for (const pid of maildevPids) await killProcess(pid);
			
			// Clean up PID files
			try {
				await fs.unlink(config.pidFile);
				await fs.unlink(config.maildevPidFile);
			} catch (error) {
				// Ignore
			}
			
			await new Promise(resolve => setTimeout(resolve, 2000));
			console.log("✅ Server stopped\n");
			process.exit(0);
		} else {
			console.log("\n❌ Server is already running. Use 'npm run kill' to stop it first.");
			console.log("   Or set FORCE_RESTART=true to automatically restart.");
			process.exit(1);
		}
	} else {
		console.log("✅ No existing server found\n");
		process.exit(0);
	}
};

main().catch((error) => {
	console.error("❌ Error:", error.message);
	process.exit(1);
});

