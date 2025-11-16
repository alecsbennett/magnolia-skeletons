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
    const postgresPublicIp = outputs.postgres_public_ip?.value;
    const postgresPrivateIp = outputs.postgres_private_ip?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
    
    const awsConfig = loadAwsConfig();
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    const instanceIp = postgresPublicIp || postgresPrivateIp;
    
    console.log('🔍 Checking PostgreSQL Cloud-init Logs\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    // Check cloud-init status
    console.log('\n1️⃣  Cloud-init Status:');
    try {
      const status = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo cloud-init status 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(status);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check cloud-init output log
    console.log('\n2️⃣  Cloud-init Output Log (last 50 lines):');
    try {
      const log = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo tail -50 /var/log/cloud-init-output.log 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(log);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check cloud-init error log
    console.log('\n3️⃣  Cloud-init Error Log:');
    try {
      const errorLog = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo cat /var/log/cloud-init.log 2>&1 | grep -i error | tail -20"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(errorLog || '   No errors found in cloud-init.log');
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check if PostgreSQL is installed
    console.log('\n4️⃣  PostgreSQL Installation Check:');
    try {
      const installed = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "rpm -qa | grep postgresql || echo 'Not installed'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(installed);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check PostgreSQL data directory
    console.log('\n5️⃣  PostgreSQL Data Directory:');
    try {
      const dataDir = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo ls -la /var/lib/pgsql/data 2>&1 | head -10 || echo 'Directory not found'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(dataDir);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check EBS volume
    console.log('\n6️⃣  EBS Volume Check:');
    try {
      const volumes = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "lsblk && echo '---' && df -h"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(volumes);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

