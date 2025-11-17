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
    console.log('🔧 Fixing iptables rules for port 80 access...\n');

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

    if (!instanceIp) {
      console.error('❌ Error: Could not get instance IP from Terraform output');
      process.exit(1);
    }

    // Get SSH key path
    const awsConfig = loadAwsConfig();
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
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

    console.log(`   Instance IP: ${instanceIp}\n`);

    // Generate Ansible inventory
    const inventoryContent = `[magnolia]
magnolia_host ansible_host=${instanceIp} ansible_user=ec2-user ansible_ssh_private_key_file=${sshKeyPathForAnsible}
`;

    const inventoryPath = join(ansibleDir, 'inventory.ini');
    writeFileSync(inventoryPath, inventoryContent);

    // Get tomcat_port from group_vars
    let tomcatPort = 8080;
    const groupVarsPath = join(ansibleDir, 'group_vars', 'all.yml');
    if (existsSync(groupVarsPath)) {
      const groupVarsContent = readFileSync(groupVarsPath, 'utf-8');
      const portMatch = groupVarsContent.match(/^tomcat_port:\s*(\d+)/m);
      if (portMatch) {
        tomcatPort = parseInt(portMatch[1], 10);
      }
    }

    // Create Ansible variables file
    const varsContent = `---
tomcat_port: ${tomcatPort}
`;

    const varsPath = join(ansibleDir, 'vars.yml');
    writeFileSync(varsPath, varsContent);

    // Run the fix-iptables playbook
    console.log('🚀 Running iptables fix playbook...\n');
    
    const playbookPath = join(ansibleDir, 'playbooks', 'fix-iptables.yml');
    const playbookPathForAnsible = ansibleInfo.useWSL && isWindows 
      ? convertToWSLPath(playbookPath)
      : playbookPath;

    execAnsibleCommand(
      `ansible-playbook -i inventory.ini playbooks/fix-iptables.yml`,
      {
        cwd: ansibleDir,
        stdio: 'inherit'
      }
    );

    console.log('\n✅ iptables rules have been fixed!');
    console.log(`🌐 You should now be able to access Magnolia at: http://${instanceIp}/author`);

  } catch (error) {
    console.error('\n❌ Error fixing iptables:', error.message);
    process.exit(1);
  }
})();

