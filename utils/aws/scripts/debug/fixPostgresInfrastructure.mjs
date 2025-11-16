#!/usr/bin/env node

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from '../loadAwsConfig.mjs';
import { execAnsibleCommand } from '../ansibleHelper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ansibleDir = join(__dirname, '..', '..', 'ansible');
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
    console.log('🔧 Running PostgreSQL infrastructure setup...\n');
    
    // Run infrastructure setup for PostgreSQL only
    execAnsibleCommand('ansible-playbook -i inventory.ini -e @vars.yml playbooks/postgres-infrastructure.yml', {
      cwd: ansibleDir,
      stdio: 'inherit'
    });
    
    console.log('\n✅ PostgreSQL infrastructure setup complete!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

