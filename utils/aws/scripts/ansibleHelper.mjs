#!/usr/bin/env node

import { execSync } from 'child_process';
import { platform } from 'os';
import { join } from 'path';

const isWindows = platform() === 'win32';

/**
 * Detects if WSL is available and working
 * @returns {boolean} True if WSL is available
 */
function isWSLAvailable() {
  if (!isWindows) return false;
  
  try {
    // Check if wsl command exists and can run
    execSync('wsl --status', { stdio: 'ignore', shell: true, timeout: 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Checks if Ansible is available in WSL
 * @returns {boolean} True if Ansible is found in WSL
 */
function isAnsibleInWSL() {
  if (!isWSLAvailable()) return false;
  
  try {
    execSync('wsl ansible --version', { stdio: 'ignore', shell: true, timeout: 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Finds Ansible command, checking Windows first, then WSL with retries
 * @returns {Object} { command: string, useWSL: boolean, method: string }
 */
function findAnsibleCommand() {
  // Try Windows commands first
  const windowsCommands = [
    { cmd: 'ansible', method: 'ansible (Windows PATH)' },
    { cmd: 'python -m ansible', method: 'python -m ansible (Windows)' },
    { cmd: 'python3 -m ansible', method: 'python3 -m ansible (Windows)' }
  ];
  
  for (const { cmd, method } of windowsCommands) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', shell: true, timeout: 5000 });
      return { command: cmd, useWSL: false, method };
    } catch (e) {
      // Try next command
    }
  }
  
  // If on Windows and WSL is available, try WSL with retries
  if (isWindows && isWSLAvailable()) {
    // Warm up WSL first
    warmupWSL();
    
    // Retry logic for WSL ansible check
    const maxRetries = 3;
    const retryDelays = [500, 1000, 2000];
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        execSync('wsl ansible --version', { stdio: 'ignore', shell: true, timeout: 10000 });
        return { command: 'ansible', useWSL: true, method: 'ansible (WSL)' };
      } catch (e) {
        if (attempt < maxRetries - 1) {
          const delay = retryDelays[attempt] || 2000;
          try {
            execSync(`powershell -Command "Start-Sleep -Milliseconds ${delay}"`, { stdio: 'ignore', shell: true });
          } catch (sleepErr) {
            const start = Date.now();
            while (Date.now() - start < delay) {}
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Finds ansible-galaxy command, checking Windows first, then WSL with retries
 * @returns {Object} { command: string, useWSL: boolean, method: string }
 */
function findAnsibleGalaxyCommand() {
  // Try Windows commands first
  const windowsCommands = [
    { cmd: 'ansible-galaxy', method: 'ansible-galaxy (Windows PATH)' },
    { cmd: 'python -m ansible.cli.galaxy', method: 'python -m ansible.cli.galaxy (Windows)' },
    { cmd: 'python3 -m ansible.cli.galaxy', method: 'python3 -m ansible.cli.galaxy (Windows)' }
  ];
  
  for (const { cmd, method } of windowsCommands) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', shell: true, timeout: 5000 });
      return { command: cmd, useWSL: false, method };
    } catch (e) {
      // Try next command
    }
  }
  
  // If on Windows and WSL is available, try WSL with retries
  if (isWindows && isWSLAvailable()) {
    // Warm up WSL first
    warmupWSL();
    
    // Retry logic for WSL ansible check
    const maxRetries = 3;
    const retryDelays = [500, 1000, 2000];
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        execSync('wsl ansible-galaxy --version', { stdio: 'ignore', shell: true, timeout: 10000 });
        return { command: 'ansible-galaxy', useWSL: true, method: 'ansible-galaxy (WSL)' };
      } catch (e) {
        if (attempt < maxRetries - 1) {
          const delay = retryDelays[attempt] || 2000;
          try {
            execSync(`powershell -Command "Start-Sleep -Milliseconds ${delay}"`, { stdio: 'ignore', shell: true });
          } catch (sleepErr) {
            const start = Date.now();
            while (Date.now() - start < delay) {}
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Warms up WSL by running a simple command to ensure it's initialized
 * @returns {boolean} True if WSL is ready
 */
function warmupWSL() {
  if (!isWindows || !isWSLAvailable()) return false;
  
  try {
    // Run a simple command to initialize WSL (this can take a moment on first run)
    execSync('wsl echo "ready"', { stdio: 'ignore', shell: true, timeout: 10000 });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Finds ansible-playbook command, checking Windows first, then WSL with retries
 * @returns {Object} { command: string, useWSL: boolean, method: string }
 */
function findAnsiblePlaybookCommand() {
  // Try Windows commands first
  const windowsCommands = [
    { cmd: 'ansible-playbook', method: 'ansible-playbook (Windows PATH)' },
    { cmd: 'python -m ansible.cli.playbook', method: 'python -m ansible.cli.playbook (Windows)' },
    { cmd: 'python3 -m ansible.cli.playbook', method: 'python3 -m ansible.cli.playbook (Windows)' }
  ];
  
  for (const { cmd, method } of windowsCommands) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', shell: true, timeout: 5000 });
      return { command: cmd, useWSL: false, method };
    } catch (e) {
      // Try next command
    }
  }
  
  // If on Windows and WSL is available, try WSL with retries
  if (isWindows && isWSLAvailable()) {
    // Warm up WSL first (important for parallel execution)
    warmupWSL();
    
    // Retry logic for WSL ansible check (handles initialization delays)
    const maxRetries = 3;
    const retryDelays = [500, 1000, 2000]; // Exponential backoff
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        execSync('wsl ansible-playbook --version', { stdio: 'ignore', shell: true, timeout: 10000 });
        return { command: 'ansible-playbook', useWSL: true, method: 'ansible-playbook (WSL)' };
      } catch (e) {
        if (attempt < maxRetries - 1) {
          // Wait before retrying (except on last attempt)
          const delay = retryDelays[attempt] || 2000;
          try {
            // Use a simple sleep via execSync
            execSync(`powershell -Command "Start-Sleep -Milliseconds ${delay}"`, { stdio: 'ignore', shell: true });
          } catch (sleepErr) {
            // Fallback: busy wait if powershell fails
            const start = Date.now();
            while (Date.now() - start < delay) {
              // Busy wait
            }
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Converts Windows path to WSL path
 * @param {string} windowsPath - Windows path (e.g., C:\Users\name\project)
 * @returns {string} WSL path (e.g., /mnt/c/Users/name/project)
 */
function convertToWSLPath(windowsPath) {
  if (!isWindows) return windowsPath;
  
  // Convert Windows path to WSL path
  // C:\path\to\dir -> /mnt/c/path/to/dir
  return windowsPath
    .replace(/^([A-Z]):/i, (match, drive) => `/mnt/${drive.toLowerCase()}`)
    .replace(/\\/g, '/');
}

/**
 * Wraps a command to use WSL if needed
 * @param {string} command - The command to wrap
 * @param {boolean} useWSL - Whether to use WSL
 * @param {string} workingDir - Working directory (will be converted to WSL path if using WSL)
 * @param {Object} envVars - Environment variables to set (for WSL)
 * @returns {string} The wrapped command
 */
function wrapCommandForWSL(command, useWSL, workingDir = null, envVars = {}) {
  if (!useWSL) {
    return command;
  }
  
  // Convert Windows path to WSL path if needed
  if (workingDir && isWindows) {
    const wslPath = convertToWSLPath(workingDir);
    // Escape single quotes in the path and command
    const escapedPath = wslPath.replace(/'/g, "'\\''");
    const escapedCommand = command.replace(/'/g, "'\\''");
    
    // Build environment variable exports
    let envExports = '';
    if (Object.keys(envVars).length > 0) {
      const envStrings = Object.entries(envVars).map(([key, value]) => {
        const escapedValue = String(value).replace(/'/g, "'\\''");
        return `${key}='${escapedValue}'`;
      });
      envExports = envStrings.join(' ') + ' ';
    }
    
    return `wsl bash -c "cd '${escapedPath}' && ${envExports}${escapedCommand}"`;
  }
  
  // If no working dir but we have env vars, still need to wrap
  if (Object.keys(envVars).length > 0) {
    const envStrings = Object.entries(envVars).map(([key, value]) => {
      const escapedValue = String(value).replace(/'/g, "'\\''");
      return `${key}='${escapedValue}'`;
    });
    return `wsl bash -c "${envStrings.join(' ')} ${command}"`;
  }
  
  return `wsl ${command}`;
}

/**
 * Executes an Ansible command with proper WSL handling
 * @param {string} command - The Ansible command to execute
 * @param {Object} options - Execution options (cwd, stdio, etc.)
 * @returns {Buffer|string} Command output
 */
function execAnsibleCommand(command, options = {}) {
  const { cwd, ...execOptions } = options;
  
  // Find the appropriate Ansible command
  let ansibleInfo;
  if (command.startsWith('ansible-playbook')) {
    ansibleInfo = findAnsiblePlaybookCommand();
  } else if (command.startsWith('ansible-galaxy')) {
    ansibleInfo = findAnsibleGalaxyCommand();
  } else {
    ansibleInfo = findAnsibleCommand();
  }
  
  if (!ansibleInfo) {
    throw new Error('Ansible not found');
  }
  
  // Replace the command prefix with the found command
  const baseCommand = ansibleInfo.command;
  let fullCommand = command;
  
  if (command.startsWith('ansible-playbook')) {
    fullCommand = command.replace(/^ansible-playbook/, baseCommand);
  } else if (command.startsWith('ansible-galaxy')) {
    fullCommand = command.replace(/^ansible-galaxy/, baseCommand);
  } else if (command.startsWith('ansible')) {
    fullCommand = command.replace(/^ansible/, baseCommand);
  }
  
  // If using WSL, convert file paths in the command from Windows to WSL format
  if (ansibleInfo.useWSL && cwd && isWindows) {
    const wslCwd = convertToWSLPath(cwd);
    // Replace Windows paths in command arguments with WSL paths
    fullCommand = fullCommand.replace(new RegExp(cwd.replace(/\\/g, '\\\\'), 'g'), wslCwd);
  }
  
  // Set ANSIBLE_CONFIG environment variable to point to ansible.cfg
  // This avoids the world-writable directory warning in WSL
  const envVars = {};
  if (cwd) {
    const ansibleCfgPath = isWindows && ansibleInfo.useWSL 
      ? convertToWSLPath(join(cwd, 'ansible.cfg'))
      : join(cwd, 'ansible.cfg');
    envVars.ANSIBLE_CONFIG = ansibleCfgPath;
  }
  
  // Suppress warnings for older Ansible versions
  envVars.ANSIBLE_HOST_KEY_CHECKING = 'False';
  envVars.ANSIBLE_DEPRECATION_WARNINGS = 'False';
  envVars.ANSIBLE_COMMAND_WARNINGS = 'False';
  // Suppress collection version warnings (for Ansible 2.10.8 compatibility)
  envVars.ANSIBLE_COLLECTIONS_PATHS = '~/.ansible/collections:/usr/share/ansible/collections';
  
  // Wrap for WSL if needed (pass env vars to be set inside WSL)
  const wrappedCommand = wrapCommandForWSL(fullCommand, ansibleInfo.useWSL, cwd, envVars);
  
  // For Windows native (not WSL), set environment variables in process.env
  if (!ansibleInfo.useWSL && Object.keys(envVars).length > 0) {
    const originalEnvs = {};
    Object.keys(envVars).forEach(key => {
      originalEnvs[key] = process.env[key];
      process.env[key] = envVars[key];
    });
    
    try {
      return execSync(wrappedCommand, {
        ...execOptions,
        shell: true,
        cwd: cwd
      });
    } finally {
      // Restore original environment variables
      Object.keys(envVars).forEach(key => {
        if (originalEnvs[key] !== undefined) {
          process.env[key] = originalEnvs[key];
        } else {
          delete process.env[key];
        }
      });
    }
  }
  
  return execSync(wrappedCommand, {
    ...execOptions,
    shell: true,
    cwd: ansibleInfo.useWSL ? undefined : cwd // Don't set cwd if using WSL (handled in wrapCommandForWSL)
  });
}

export {
  isWindows,
  isWSLAvailable,
  isAnsibleInWSL,
  findAnsibleCommand,
  findAnsibleGalaxyCommand,
  findAnsiblePlaybookCommand,
  convertToWSLPath,
  wrapCommandForWSL,
  execAnsibleCommand
};

