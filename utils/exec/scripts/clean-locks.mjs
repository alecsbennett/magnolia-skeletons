import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { getConfig } from "./utils.mjs";

const execAsync = promisify(exec);

const findLockFiles = async (directory, pattern) => {
	const results = [];
	try {
		const files = await fs.readdir(directory);
		for (const file of files) {
			const filePath = path.join(directory, file);
			try {
				const stat = await fs.lstat(filePath);
				if (stat.isDirectory()) {
					const subDirResults = await findLockFiles(filePath, pattern);
					results.push(...subDirResults);
				} else if (file.match(pattern.replace("*", ".*"))) {
					results.push(filePath);
				}
			} catch (error) {
				// Ignore errors accessing files
			}
		}
	} catch (error) {
		// Ignore errors
	}
	return results;
};

const main = async () => {
	const config = await getConfig();
	
	if (!config.clearJcrLocks && process.env.CLEAR_JCR_LOCKS !== "true") {
		console.log("⏭️ Skipping JCR lock clearing (disabled in config)");
		process.exit(0);
	}
	
	try {
		console.log("🔒 Clearing JCR lock files...");
		
		const lockPatterns = ["*.lock", "*.lck", "repository.lock", "workspace.lock", "workspace.xml.lock", "version.lock"];
		let locksFound = 0;
		
		try {
			await fs.access(config.reposDir);
		} catch (error) {
			console.log(`⚠️  Repository directory not found: ${config.reposDir}`);
			process.exit(0);
		}
		
		const foundLockFiles = [];
		for (const pattern of lockPatterns) {
			const files = await findLockFiles(config.reposDir, pattern);
			foundLockFiles.push(...files);
		}
		
		// Try glob as well
		try {
			const globModule = await import('glob');
			for (const pattern of lockPatterns) {
				const globPattern = path.join(config.reposDir, "**", pattern);
				try {
					const lockFiles = await globModule.glob(globPattern, { dot: true });
					for (const file of lockFiles) {
						if (!foundLockFiles.includes(file)) {
							foundLockFiles.push(file);
						}
					}
				} catch (error) {
					// Ignore
				}
			}
		} catch (error) {
			// Glob not available
		}
		
		for (const lockFile of foundLockFiles) {
			try {
				await fs.unlink(lockFile);
				console.log(`   ✅ Removed: ${path.relative(config.reposDir, lockFile)}`);
				locksFound++;
			} catch (unlinkError) {
				if (unlinkError.code === 'EPERM' && process.platform === 'win32') {
					try {
						await execAsync(`powershell -Command "Remove-Item -Path '${lockFile}' -Force"`);
						console.log(`   ✅ Removed (elevated): ${path.relative(config.reposDir, lockFile)}`);
						locksFound++;
					} catch (error) {
						// Ignore
					}
				}
			}
		}
		
		if (locksFound > 0) {
			console.log(`✅ Removed ${locksFound} JCR lock file(s)\n`);
		} else {
			console.log("✅ No JCR lock files found\n");
		}
	} catch (error) {
		console.error("⚠️  Error clearing JCR locks:", error.message);
		process.exit(1);
	}
};

main();

