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
    
    console.log('🔍 Testing stat command variations\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp}`;
    
    const tests = [
      {
        name: '1. Check if /opt/tomcat exists',
        cmd: `${sshBase} "sudo test -d /opt/tomcat && echo 'exists' || echo 'not-exists'"`
      },
      {
        name: '2. stat command (current code)',
        cmd: `${sshBase} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`
      },
      {
        name: '3. stat command without error redirect',
        cmd: `${sshBase} "sudo stat -c '%U:%G' /opt/tomcat || echo 'not-found'"`
      },
      {
        name: '4. ls -ld to check ownership',
        cmd: `${sshBase} "sudo ls -ld /opt/tomcat | awk '{print \\$3\":\"\\$4}'"`
      },
      {
        name: '5. Check if stat command exists',
        cmd: `${sshBase} "which stat && stat --version 2>&1 | head -1 || echo 'stat not found'"`
      },
      {
        name: '6. Try stat with different format',
        cmd: `${sshBase} "sudo stat --format='%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`
      }
    ];
    
    for (const test of tests) {
      try {
        console.log(`\n${test.name}:`);
        const result = execSync(test.cmd, { 
          encoding: 'utf-8', 
          timeout: 10000,
          stdio: 'pipe'
        }).trim();
        console.log(`   Result: "${result}"`);
      } catch (error) {
        const errorMsg = error.message || error.toString();
        const stderr = error.stderr?.toString() || '';
        console.log(`   ❌ Error: ${errorMsg.substring(0, 100)}`);
        if (stderr) console.log(`   stderr: ${stderr.substring(0, 100)}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

