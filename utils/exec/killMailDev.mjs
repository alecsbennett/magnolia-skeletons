import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
    maildevPidFile: path.resolve(__dirname, ".maildev.pid"),
    maildevSmtpPort: 1025,
    maildevUiPort: 1080
};

// Load PID from file
const loadPid = async () => {
    try {
        const data = await fs.readFile(CONFIG.maildevPidFile, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
};

// Check if port is in use
const isPortInUse = async (port) => {
    try {
        const platform = process.platform;
        let command;
        
        if (platform === "win32") {
            command = `netstat -ano | findstr :${port}`;
        } else {
            command = `lsof -i :${port} -t`;
        }
        
        const { stdout } = await execAsync(command);
        return stdout.trim().length > 0;
    } catch (error) {
        return false;
    }
};

// Get PIDs from port
const getPidsFromPort = async (port) => {
    try {
        const platform = process.platform;
        let command;
        
        if (platform === "win32") {
            command = `netstat -ano | findstr :${port}`;
        } else {
            command = `lsof -i :${port} -t`;
        }
        
        const { stdout } = await execAsync(command);
        if (platform === "win32") {
            // Parse Windows netstat output
            const pids = new Set();
            stdout.split("\n").forEach((line) => {
                const match = line.trim().match(/\s+(\d+)$/);
                if (match) pids.add(match[1]);
            });
            return Array.from(pids);
        } else {
            return stdout.trim().split("\n").filter(Boolean);
        }
    } catch (error) {
        return [];
    }
};

// Kill process by PID
const killProcess = async (pid) => {
    try {
        const platform = process.platform;
        const command = platform === "win32" ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
        await execAsync(command);
        return true;
    } catch (error) {
        return false;
    }
};

// Main execution
const main = async () => {
    console.log("🛑 Stopping MailDev server...");
    
    let killed = false;
    
    // Try to kill from PID file first
    const pidData = await loadPid();
    if (pidData && pidData.maildevPid) {
        const result = await killProcess(pidData.maildevPid);
        console.log(`   ${result ? "✅" : "⚠️"} MailDev process (${pidData.maildevPid})`);
        killed = result;
    } else {
        console.log("   ⚠️ No PID file found");
    }
    
    // Kill any processes on the SMTP port
    const smtpPortPids = await getPidsFromPort(CONFIG.maildevSmtpPort);
    for (const pid of smtpPortPids) {
        const result = await killProcess(pid);
        console.log(`   ${result ? "✅" : "⚠️"} Process on SMTP port ${CONFIG.maildevSmtpPort} (${pid})`);
        killed = true;
    }
    
    // Kill any processes on the UI port
    const uiPortPids = await getPidsFromPort(CONFIG.maildevUiPort);
    for (const pid of uiPortPids) {
        const result = await killProcess(pid);
        console.log(`   ${result ? "✅" : "⚠️"} Process on UI port ${CONFIG.maildevUiPort} (${pid})`);
        killed = true;
    }
    
    // Clean up PID file
    try {
        await fs.unlink(CONFIG.maildevPidFile);
        console.log("   ✅ Cleaned up PID file");
    } catch (error) {
        // Ignore if file doesn't exist
    }
    
    if (killed) {
        console.log("✅ MailDev server stopped");
    } else {
        console.log("⚠️ No running MailDev server found");
    }
};

main();
