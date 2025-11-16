#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from '../loadAwsConfig.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
    // Get instance info from Terraform
    console.log('🔍 Getting instance information from Terraform...\n');
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
    
    console.log(`Instance IP: ${instanceIp}`);
    console.log(`Key path: ${expandedKeyPath}\n`);
    console.log('='.repeat(70));
    console.log('TESTING DIFFERENT METHODS TO CHECK FILE EXISTENCE');
    console.log('='.repeat(70));
    console.log();
    
    const testFile = '/opt/tomcat/bin/startup.sh';
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp}`;
    
    const tests = [
      {
        name: '1. Direct test (as ec2-user)',
        command: `${sshBase} "test -f ${testFile} && echo 'EXISTS' || echo 'NOT_FOUND'"`
      },
      {
        name: '2. sudo test (as root)',
        command: `${sshBase} "sudo test -f ${testFile} && echo 'EXISTS' || echo 'NOT_FOUND'"`
      },
      {
        name: '3. sudo -u tomcat test (as tomcat user)',
        command: `${sshBase} "sudo -u tomcat test -f ${testFile} && echo 'EXISTS' || echo 'NOT_FOUND'"`
      },
      {
        name: '4. ls -la (as ec2-user)',
        command: `${sshBase} "ls -la ${testFile} 2>&1"`
      },
      {
        name: '5. sudo ls -la (as root)',
        command: `${sshBase} "sudo ls -la ${testFile} 2>&1"`
      },
      {
        name: '6. sudo -u tomcat ls -la (as tomcat user)',
        command: `${sshBase} "sudo -u tomcat ls -la ${testFile} 2>&1"`
      },
      {
        name: '7. Check directory permissions',
        command: `${sshBase} "sudo ls -ld /opt/tomcat /opt/tomcat/bin 2>&1"`
      },
      {
        name: '8. Check file ownership',
        command: `${sshBase} "sudo stat -c '%U:%G %a %n' ${testFile} 2>&1"`
      },
      {
        name: '9. Check if tomcat user can access',
        command: `${sshBase} "sudo -u tomcat sh -c 'cd /opt/tomcat/bin && test -f startup.sh && echo EXISTS || echo NOT_FOUND'"`
      },
      {
        name: '10. Check with [ -f ] syntax',
        command: `${sshBase} "sudo -u tomcat [ -f ${testFile} ] && echo 'EXISTS' || echo 'NOT_FOUND'"`
      }
    ];
    
    const results = [];
    
    for (const test of tests) {
      try {
        console.log(`\n${test.name}:`);
        console.log(`Command: ${test.command.substring(0, 100)}...`);
        const result = execSync(test.command, { 
          encoding: 'utf-8', 
          timeout: 10000,
          stdio: 'pipe'
        });
        const output = result.trim();
        console.log(`✅ SUCCESS: ${output}`);
        results.push({ test: test.name, success: true, output });
      } catch (error) {
        const errorMsg = error.message || error.toString();
        console.log(`❌ FAILED: ${errorMsg.substring(0, 100)}`);
        results.push({ test: test.name, success: false, error: errorMsg });
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log();
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful tests: ${successful.length}`);
    successful.forEach(r => {
      console.log(`   - ${r.test}`);
      if (r.output) console.log(`     Output: ${r.output.substring(0, 60)}`);
    });
    
    console.log(`\n❌ Failed tests: ${failed.length}`);
    failed.forEach(r => {
      console.log(`   - ${r.test}`);
      if (r.error) console.log(`     Error: ${r.error.substring(0, 60)}`);
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('RECOMMENDATION');
    console.log('='.repeat(70));
    
    if (successful.length > 0) {
      const bestMethod = successful.find(r => 
        r.test.includes('sudo -u tomcat') || 
        r.test.includes('tomcat user')
      ) || successful[0];
      console.log(`\n✅ Best working method: ${bestMethod.test}`);
      console.log(`   Use this in the readiness checks!`);
    } else {
      console.log('\n⚠️  No methods worked! Check SSH connectivity and permissions.');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

