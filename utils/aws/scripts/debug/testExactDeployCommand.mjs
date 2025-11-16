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
    
    console.log('🔍 Testing EXACT command from deploy script\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    // EXACT command from line 455 in instanceReadiness.mjs
    const keyPath_var = expandedKeyPath;
    const instanceIp_var = instanceIp;
    
    console.log('\nTesting ownership check (EXACT command from code):');
    const exactCommand = `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp_var} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`;
    console.log(`Command: ${exactCommand.substring(0, 120)}...\n`);
    
    try {
      const result = execSync(
        exactCommand,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      );
      const trimmed = result.trim();
      console.log(`✅ Result: "${trimmed}"`);
      console.log(`   Length: ${trimmed.length}`);
      console.log(`   Bytes: ${Buffer.from(trimmed).toString('hex')}`);
      
      if (trimmed === 'not-found') {
        console.log('\n⚠️  Got "not-found" - checking why...\n');
        
        // Test variations
        console.log('Testing variations:');
        
        // Test 1: Without error redirect
        try {
          const test1 = execSync(
            `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp_var} "sudo stat -c '%U:%G' /opt/tomcat || echo 'FAILED'"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          console.log(`   1. Without 2>/dev/null: "${test1}"`);
        } catch (e) {
          console.log(`   1. Without 2>/dev/null: ERROR - ${e.message.substring(0, 80)}`);
        }
        
        // Test 2: Check if directory exists
        try {
          const test2 = execSync(
            `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp_var} "sudo test -d /opt/tomcat && echo 'exists' || echo 'not-exists'"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          console.log(`   2. Directory exists check: "${test2}"`);
        } catch (e) {
          console.log(`   2. Directory exists check: ERROR - ${e.message.substring(0, 80)}`);
        }
        
        // Test 3: Try stat without sudo
        try {
          const test3 = execSync(
            `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp_var} "stat -c '%U:%G' /opt/tomcat 2>&1 || echo 'FAILED'"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          console.log(`   3. Without sudo: "${test3}"`);
        } catch (e) {
          console.log(`   3. Without sudo: ERROR - ${e.message.substring(0, 80)}`);
        }
        
        // Test 4: Check what stat actually returns
        try {
          const test4 = execSync(
            `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp_var} "sudo stat /opt/tomcat 2>&1 | head -5"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          console.log(`   4. Full stat output:\n${test4}`);
        } catch (e) {
          console.log(`   4. Full stat output: ERROR - ${e.message.substring(0, 80)}`);
        }
        
      } else if (trimmed === 'tomcat:tomcat') {
        console.log('\n✅ Ownership detected correctly!');
      }
      
    } catch (error) {
      console.log(`\n❌ Exception: ${error.message}`);
      if (error.stderr) {
        console.log(`   stderr: ${error.stderr.toString().substring(0, 200)}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

