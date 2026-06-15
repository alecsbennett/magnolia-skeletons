import { spawn } from "child_process";
import path from "path";
import { getConfig } from "./utils.mjs";

const runMaven = (command, args, cwd, captureOutput = false) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
			shell: true,
		});
		let stdout = "";

		if (captureOutput) {
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString();
			});
		}

		child.on("exit", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(`Maven exited with code ${code}`));
			}
		});
		child.on("error", reject);
	});

const prefetchTomcat = async (config, parentDir) => {
	const tomcatVersion = await runMaven(
		config.mavenCommand,
		["help:evaluate", "-Dexpression=tomcat.version", "-q", "-DforceStdout"],
		parentDir,
		true
	);

	console.log(`📥 Resolving Tomcat ${tomcatVersion} distribution...`);
	await runMaven(
		config.mavenCommand,
		[
			"dependency:get",
			`-Dartifact=org.apache.tomcat:tomcat:${tomcatVersion}:zip`,
			"-Dtransitive=false",
			"-U",
		],
		parentDir
	);
};

const main = async () => {
	const config = await getConfig();
	const buildConfig = config.instanceMode === "both" ? config.author : config;
	
	console.log("🔨 Building parent project...");
	const parentDir = path.resolve(buildConfig.cargoWorkingDir, "..");
	console.log(`   Working directory: ${parentDir}`);
	console.log(`   Command: ${buildConfig.mavenCommand} clean install -P${buildConfig.profileConfig.profile}\n`);
	
	const buildProcess = spawn(buildConfig.mavenCommand, ["clean", "install", `-P${buildConfig.profileConfig.profile}`], {
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
		await prefetchTomcat(buildConfig, parentDir);
		console.log("\n✅ Build completed successfully\n");
		process.exit(0);
	}
};

main().catch((error) => {
	console.error("\n❌ Build failed:", error.message);
	process.exit(1);
});

