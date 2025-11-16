#!/usr/bin/env node

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from '../loadAwsConfig.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
    // Get instance info from Terraform
    const output = execSync('terraform output -json', { 
      cwd: terraformDir,
      encoding: 'utf-8'
    });
    
    const outputs = JSON.parse(output);
    const instanceIp = outputs.instance_public_ip?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
    
    if (!instanceIp || !keyPairName) {
      console.error('❌ Could not get instance info from Terraform');
      process.exit(1);
    }
    
    const awsConfig = loadAwsConfig();
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    console.log('🔍 Testing Tomcat User Creation\n');
    console.log(`Instance IP: ${instanceIp}`);
    console.log(`Key path: ${expandedKeyPath}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no ec2-user@${instanceIp}`;
    
    const tests = [
      {
        name: '1. Check if tomcat user exists',
        command: `${sshBase} "id tomcat 2>&1"`
      },
      {
        name: '2. Get tomcat user details',
        command: `${sshBase} "getent passwd tomcat 2>&1 || echo 'User not found'"`
      },
      {
        name: '3. Check /opt/tomcat ownership',
        command: `${sshBase} "sudo stat -c '%U:%G %n' /opt/tomcat 2>&1 || echo 'Directory not found'"`
      },
      {
        name: '4. Check /opt/tomcat/bin/startup.sh ownership',
        command: `${sshBase} "sudo stat -c '%U:%G %n' /opt/tomcat/bin/startup.sh 2>&1 || echo 'File not found'"`
      },
      {
        name: '5. List all users (grep for tomcat)',
        command: `${sshBase} "getent passwd | grep tomcat || echo 'No tomcat user found'"`
      },
      {
        name: '6. Check user creation in installation log',
        command: `${sshBase} "sudo grep -i 'tomcat user' /var/log/user-data-install.log 2>&1 | tail -5 || echo 'Log not found'"`
      },
      {
        name: '7. Check if useradd command ran',
        command: `${sshBase} "sudo grep -i 'useradd.*tomcat' /var/log/user-data-install.log 2>&1 | tail -3 || echo 'Not found in log'"`
      }
    ];
    
    console.log('\nRunning tests...\n');
    
    for (const test of tests) {
      try {
        console.log(`${test.name}:`);
        const result = execSync(test.command, { 
          encoding: 'utf-8', 
          timeout: 10000,
          stdio: 'pipe'
        });
        const output = result.trim();
        console.log(`   ${output}`);
        console.log();
      } catch (error) {
        const errorMsg = error.message || error.toString();
        console.log(`   ❌ Error: ${errorMsg.substring(0, 100)}`);
        console.log();
      }
    }
    
    console.log('='.repeat(70));
    console.log('\n💡 Summary:');
    console.log('   - If "id tomcat" shows user info → User exists');
    console.log('   - If ownership shows "tomcat:tomcat" → User exists and owns files');
    console.log('   - If ownership shows "root:root" → User may not exist yet');
    console.log('   - Check logs to see if user creation succeeded\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

