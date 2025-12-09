#!/usr/bin/env node

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findAnsibleGalaxyCommand, isWSLAvailable, execAnsibleCommand } from './ansibleHelper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ansibleDir = join(__dirname, '..', 'ansible');
const requirementsFile = join(ansibleDir, 'requirements.yml');

console.log('📦 Installing Ansible collections...\n');

// Check if requirements file exists
if (!existsSync(requirementsFile)) {
  console.error(`❌ Error: Requirements file not found at ${requirementsFile}`);
  process.exit(1);
}

// Find ansible-galaxy command (automatically uses WSL on Windows if available)
const ansibleInfo = findAnsibleGalaxyCommand();

if (!ansibleInfo) {
  console.error('❌ Error: ansible-galaxy is not installed!');
  console.error('\n   Please install Ansible first:');
  console.error('   - macOS:     brew install ansible');
  console.error('   - Linux:     pip3 install ansible or sudo apt-get install ansible');
  console.error('   - Windows:   Use WSL (recommended):');
  console.error('                1. Install WSL: wsl --install');
  console.error('                2. In WSL: sudo apt-get update && sudo apt-get install ansible');
  console.error('   - Windows:   Alternative: pip install ansible');
  console.error('\n   After installation, verify with: ansible-galaxy --version');
  if (isWSLAvailable()) {
    console.error('   Note: WSL is available but Ansible is not installed in WSL.');
    console.error('   Install Ansible in WSL: sudo apt-get install ansible');
  }
  process.exit(1);
}

console.log(`   Using: ${ansibleInfo.method}\n`);

try {
  // Install collections using the helper (handles WSL automatically)
  console.log('   Installing collections from requirements.yml...\n');
  execAnsibleCommand(`ansible-galaxy collection install -r requirements.yml`, {
    cwd: ansibleDir,
    stdio: 'inherit'
  });
  
  console.log('\n✅ Ansible collections installed successfully!');
  
} catch (error) {
  console.error('\n❌ Error installing Ansible collections');
  console.error('   Check the output above for details');
  process.exit(1);
}

