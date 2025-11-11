import { spawn } from "child_process";
import path from "path";
import { getConfig } from "./utils.mjs";

const main = async () => {
	const config = await getConfig();
	
	console.log("🔨 Building parent project...");
	const parentDir = path.resolve(config.cargoWorkingDir, "..");
	console.log(`   Working directory: ${parentDir}`);
	console.log(`   Command: ${config.cargoCommand} clean install -P${config.profileConfig.profile}\n`);
	
	const buildProcess = spawn(config.cargoCommand, ["clean", "install", `-P${config.profileConfig.profile}`], {
		cwd: parentDir,
		stdio: "inherit",
		shell: true
	});
	
	const buildResult = await new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			buildProcess.kill();
			reject(new Error("Build process timed out after 15 minutes"));
		}, 900000); // 15 minutes
		
		buildProcess.on("exit", (code) => {
			clearTimeout(timeoutId);
			if (code === 0) {
				resolve(true);
			} else {
				reject(new Error(`Build failed with exit code ${code}`));
			}
		});
		
		buildProcess.on("error", (error) => {
			clearTimeout(timeoutId);
			reject(error);
		});
	});
	
	if (buildResult) {
		console.log("\n✅ Build completed successfully\n");
		process.exit(0);
	}
};

main().catch((error) => {
	console.error("\n❌ Build failed:", error.message);
	process.exit(1);
});

