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
    
    console.log('🔄 Restarting Tomcat\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp}`;
    
    console.log('Stopping Tomcat...');
    execSync(`${sshBase} "sudo systemctl stop tomcat"`, { stdio: 'inherit', timeout: 30000 });
    
    console.log('\nWaiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Starting Tomcat...');
    execSync(`${sshBase} "sudo systemctl start tomcat"`, { stdio: 'inherit', timeout: 30000 });
    
    console.log('\n✅ Tomcat restarted!');
    console.log('\n📋 Checking status...');
    execSync(`${sshBase} "sudo systemctl status tomcat --no-pager -l | head -15"`, { stdio: 'inherit', timeout: 10000 });
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

