#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from './loadAwsConfig.mjs';
import { findAnsiblePlaybookCommand, execAnsibleCommand, convertToWSLPath, isWindows } from './ansibleHelper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const terraformDir = join(__dirname, '..', 'terraform');
const ansibleDir = join(__dirname, '..', 'ansible');

(async () => {
  try {
    console.log('🐘 Setting up PostgreSQL infrastructure...\n');

    // Check if Terraform state exists
    const terraformState = join(terraformDir, 'terraform.tfstate');
    if (!existsSync(terraformState)) {
      console.error('❌ Error: Terraform state not found!');
      console.error('   Please run: npm run aws:create');
      process.exit(1);
    }

    // Check if Ansible is installed
    const ansibleInfo = findAnsiblePlaybookCommand();
    if (!ansibleInfo) {
      console.error('❌ Error: Ansible is not installed!');
      process.exit(1);
    }

    // Get instance information from Terraform
    const output = execSync('terraform output -json', {
      cwd: terraformDir,
      encoding: 'utf-8'
    });

    const outputs = JSON.parse(output);
    const postgresIp = outputs.postgres_private_ip?.value;
    const postgresPublicIp = outputs.postgres_public_ip?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];

    if (!postgresIp) {
      console.error('❌ Error: Could not get PostgreSQL IP from Terraform output');
      process.exit(1);
    }

    // Get SSH key path
    const awsConfig = loadAwsConfig();
    const keyPairPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH ||
      (keyPairName ? `~/.ssh/${keyPairName}.pem` : null);

    if (!keyPairPath) {
      console.error('❌ Error: Could not determine SSH key path');
      process.exit(1);
    }

    const expandedKeyPath = keyPairPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);

    if (!existsSync(expandedKeyPath)) {
      console.error(`❌ Error: SSH key not found at ${expandedKeyPath}`);
      process.exit(1);
    }

    // Prepare SSH key for WSL if needed
    let sshKeyPathForAnsible = expandedKeyPath;
    if (ansibleInfo.useWSL && isWindows) {
      console.log('🔧 Preparing SSH key for WSL...');
      try {
        const wslUser = execSync('wsl whoami', { encoding: 'utf-8', shell: true }).trim();
        const wslKeyPath = `/home/${wslUser}/.ssh/${keyPairName || 'deploy-key'}.pem`;
        
        execSync(`wsl bash -c "mkdir -p ~/.ssh && cp '${convertToWSLPath(expandedKeyPath)}' '${wslKeyPath}' && chmod 600 '${wslKeyPath}'"`, {
          stdio: 'ignore',
          shell: true
        });
        
        sshKeyPathForAnsible = wslKeyPath;
        console.log(`   ✓ SSH key ready\n`);
      } catch (e) {
        sshKeyPathForAnsible = convertToWSLPath(expandedKeyPath);
      }
    }

    // Get Terraform variables
    const tfvarsPath = join(terraformDir, 'terraform.tfvars');
    let postgresDbName = 'jackrabbit-author';
    let postgresDbUser = 'magnolia';
    let postgresDbPassword = awsConfig.postgresPassword || process.env.POSTGRES_PASSWORD;

    if (existsSync(tfvarsPath)) {
      const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
      const dbNameMatch = tfvarsContent.match(/postgres_db_name\s*=\s*["']?([^"'\s]+)["']?/);
      if (dbNameMatch) postgresDbName = dbNameMatch[1];

      const dbUserMatch = tfvarsContent.match(/postgres_db_user\s*=\s*["']?([^"'\s]+)["']?/);
      if (dbUserMatch) postgresDbUser = dbUserMatch[1];
    }

    if (!postgresDbPassword) {
      console.error('❌ Error: PostgreSQL password not configured');
      console.error('   Please set it in aws-credentials.properties or POSTGRES_PASSWORD env var');
      process.exit(1);
    }

    console.log(`   PostgreSQL IP: ${postgresPublicIp || postgresIp}`);
    console.log(`   Database: ${postgresDbName}`);
    console.log(`   User: ${postgresDbUser}\n`);

    // Generate Ansible inventory
    const inventoryContent = `[postgres]
postgres_host ansible_host=${postgresPublicIp || postgresIp} ansible_user=ec2-user ansible_ssh_private_key_file=${sshKeyPathForAnsible}
`;

    const inventoryPath = join(ansibleDir, 'inventory.ini');
    writeFileSync(inventoryPath, inventoryContent);

    // Get Magnolia instance private IP for PostgreSQL access restriction
    const magnoliaInstanceIp = outputs.instance_private_ip?.value;
    if (!magnoliaInstanceIp) {
      console.error('❌ Error: Could not get Magnolia instance private IP from Terraform output');
      process.exit(1);
    }

    // Create Ansible variables file
    const varsContent = `---
postgres_db_name: ${postgresDbName}
postgres_db_user: ${postgresDbUser}
postgres_db_password: ${postgresDbPassword}
magnolia_instance_ip: ${magnoliaInstanceIp}
`;

    const varsPath = join(ansibleDir, 'vars.yml');
    writeFileSync(varsPath, varsContent);

    // Check if PostgreSQL setup is needed
    console.log('🔍 Checking if PostgreSQL setup is needed...');
    let needsSetup = false;
    try {
      const checkResult = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 ec2-user@${postgresPublicIp || postgresIp} "test -f /var/lib/pgsql/.postgres-setup-complete || echo 'needs-setup'"`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
      );
      if (checkResult.includes('needs-setup')) {
        needsSetup = true;
      }
    } catch (e) {
      needsSetup = true;
    }

    if (needsSetup) {
      console.log('🔧 Running PostgreSQL infrastructure setup...\n');
      execAnsibleCommand('ansible-playbook -i inventory.ini -e @vars.yml playbooks/postgres-infrastructure.yml', {
        cwd: ansibleDir,
        stdio: 'inherit'
      });
      console.log('\n   ✓ PostgreSQL infrastructure setup complete\n');
    } else {
      console.log('   ✓ PostgreSQL already set up\n');
    }

  } catch (error) {
    console.error('\n❌ Error during PostgreSQL setup:', error.message);
    process.exit(1);
  }
})();

