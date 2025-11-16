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
const projectRoot = join(__dirname, '..', '..', '..');
const webappDir = join(projectRoot, 'magnolia', 'magnolia-webapp');
const warFile = join(webappDir, 'target', 'magnolia-webapp-1.0-SNAPSHOT.war');

// Helper: parse boolean-like env vars
function envFlag(name, defaultValue = false) {
  const val = process.env[name];
  if (val == null) return defaultValue;
  const v = String(val).toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

const FLAGS = {
  skipBuild: envFlag('DEPLOY_SKIP_BUILD', false),
};

(async () => {
  try {
    console.log('🐱 Setting up Tomcat/Magnolia infrastructure...\n');

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
    const instanceIp = outputs.instance_public_ip?.value;
    const postgresIp = outputs.postgres_private_ip?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];

    if (!instanceIp || !postgresIp) {
      console.error('❌ Error: Could not get instance IPs from Terraform output');
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
    let magnoliaProfile = 'development';
    let postgresDbName = 'jackrabbit-author';
    let postgresDbUser = 'magnolia';
    let postgresDbPassword = awsConfig.postgresPassword || process.env.POSTGRES_PASSWORD;

    if (existsSync(tfvarsPath)) {
      const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
      const profileMatch = tfvarsContent.match(/magnolia_profile\s*=\s*["']?(\w+)["']?/);
      if (profileMatch) magnoliaProfile = profileMatch[1];

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

    console.log(`   Instance IP: ${instanceIp}`);
    console.log(`   PostgreSQL IP: ${postgresIp}`);
    console.log(`   Magnolia Profile: ${magnoliaProfile}\n`);

    // Build WAR file if needed
    if (!FLAGS.skipBuild) {
      console.log('🔨 Building Magnolia WAR file...');
      execSync('mvn clean install -Pauthor', {
        cwd: join(projectRoot, 'magnolia'),
        stdio: 'inherit'
      });
    }

    if (!existsSync(warFile)) {
      console.error(`❌ Error: WAR file not found at ${warFile}`);
      process.exit(1);
    }

    console.log(`   WAR file: ${warFile}\n`);

    // Generate Ansible inventory
    const inventoryContent = `[magnolia]
magnolia_host ansible_host=${instanceIp} ansible_user=ec2-user ansible_ssh_private_key_file=${sshKeyPathForAnsible}
`;

    const inventoryPath = join(ansibleDir, 'inventory.ini');
    writeFileSync(inventoryPath, inventoryContent);

    // Create Ansible variables file
    let warFilePathForAnsible = warFile;
    if (ansibleInfo.useWSL && isWindows) {
      warFilePathForAnsible = convertToWSLPath(warFile);
    }
    
    const varsContent = `---
postgres_db_name: ${postgresDbName}
postgres_db_user: ${postgresDbUser}
postgres_db_password: ${postgresDbPassword}
magnolia_profile: ${magnoliaProfile}
magnolia_war_path: ${warFilePathForAnsible}
postgres_ip: ${postgresIp}
`;

    const varsPath = join(ansibleDir, 'vars.yml');
    writeFileSync(varsPath, varsContent);

    // Check if Tomcat setup is needed
    console.log('🔍 Checking if Tomcat setup is needed...');
    let needsSetup = false;
    try {
      const checkResult = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 ec2-user@${instanceIp} "test -f /opt/tomcat/.installation-complete || echo 'needs-setup'"`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
      );
      if (checkResult.includes('needs-setup')) {
        needsSetup = true;
      }
    } catch (e) {
      needsSetup = true;
    }

    if (needsSetup) {
      console.log('🔧 Running Tomcat infrastructure setup...\n');
      execAnsibleCommand('ansible-playbook -i inventory.ini -e @vars.yml playbooks/infrastructure.yml --limit magnolia', {
        cwd: ansibleDir,
        stdio: 'inherit'
      });
      console.log('\n   ✓ Tomcat infrastructure setup complete\n');
    } else {
      console.log('   ✓ Tomcat already set up\n');
    }

    // Run deployment playbook
    console.log('🚀 Deploying Magnolia application...\n');
    execAnsibleCommand('ansible-playbook -i inventory.ini -e @vars.yml playbooks/site.yml', {
      cwd: ansibleDir,
      stdio: 'inherit'
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ DEPLOYMENT COMPLETE!');
    console.log('='.repeat(60));
    console.log(`\n🌐 Access Magnolia at: http://${instanceIp}/author`);
    console.log(`\n📋 Deployment Summary:`);
    console.log(`   ┌─ Instance IP: ${instanceIp}`);
    console.log(`   ├─ Profile: ${magnoliaProfile}`);
    console.log(`   ├─ PostgreSQL: ${postgresIp}`);
    console.log(`   └─ Status: Deployed via Ansible\n`);

  } catch (error) {
    console.error('\n❌ Error during Tomcat setup:', error.message);
    process.exit(1);
  }
})();

