#!/usr/bin/env node

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from '../loadAwsConfig.mjs';
import { waitForInstanceReady } from '../instanceReadiness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
    console.log('🔍 Testing PostgreSQL Instance Readiness\n');
    
    const output = execSync('terraform output -json', { 
      cwd: terraformDir,
      encoding: 'utf-8'
    });
    
    const outputs = JSON.parse(output);
    const postgresInstanceId = outputs.postgres_instance_id?.value;
    const postgresPublicIp = outputs.postgres_public_ip?.value;
    const postgresPrivateIp = outputs.postgres_private_ip?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
    
    if (!postgresInstanceId) {
      console.error('❌ Could not get PostgreSQL instance ID from Terraform');
      process.exit(1);
    }
    
    const awsConfig = loadAwsConfig();
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    const instanceIp = postgresPublicIp || postgresPrivateIp;
    
    if (!instanceIp) {
      console.error('❌ Error: PostgreSQL instance has no public or private IP accessible via SSH');
      console.error('   Cannot test readiness via SSH');
      process.exit(1);
    }
    
    console.log(`Instance ID: ${postgresInstanceId}`);
    console.log(`Instance IP: ${instanceIp} ${postgresPublicIp ? '(public)' : '(private)'}`);
    console.log(`Key path: ${expandedKeyPath}\n`);
    console.log('='.repeat(70));
    
    // First, check cloud-init status manually
    console.log('\n1️⃣  Manual Cloud-init Status Check:');
    try {
      const cloudInitResult = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo cloud-init status 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(`   Raw output: "${cloudInitResult.trim()}"`);
      
      const status = cloudInitResult.trim();
      if (status.includes('done') || status.includes('complete')) {
        console.log('   ✅ Cloud-init is complete');
      } else if (status.includes('error')) {
        console.log('   ❌ Cloud-init shows ERROR status');
        
        // Get error details
        console.log('\n   Checking cloud-init logs...');
        try {
          const errorLog = execSync(
            `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo tail -30 /var/log/cloud-init-output.log 2>&1 | tail -20"`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          console.log('   Last 20 lines of cloud-init-output.log:');
          console.log(errorLog);
        } catch (e) {
          console.log(`   Could not read cloud-init-output.log: ${e.message}`);
        }
        
        try {
          const statusLog = execSync(
            `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo cat /var/lib/cloud/data/status.json 2>&1"`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          console.log('\n   Cloud-init status.json:');
          console.log(statusLog);
        } catch (e) {
          console.log(`   Could not read status.json: ${e.message}`);
        }
      } else {
        console.log(`   ⏳ Cloud-init status: ${status}`);
      }
    } catch (e) {
      console.log(`   ❌ Error checking cloud-init: ${e.message}`);
      if (e.stderr) {
        console.log(`   stderr: ${e.stderr.toString().substring(0, 200)}`);
      }
    }
    
    // Check PostgreSQL service
    console.log('\n2️⃣  PostgreSQL Service Check:');
    try {
      const serviceStatus = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo systemctl status postgresql --no-pager -l 2>&1 | head -15"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log('   Service status:');
      console.log(serviceStatus);
      
      const isActive = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo systemctl is-active postgresql 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim();
      
      if (isActive === 'active') {
        console.log('   ✅ PostgreSQL service is active');
      } else {
        console.log(`   ⚠️  PostgreSQL service is: ${isActive}`);
      }
    } catch (e) {
      console.log(`   ❌ Error checking PostgreSQL service: ${e.message}`);
      if (e.stderr) {
        console.log(`   stderr: ${e.stderr.toString().substring(0, 200)}`);
      }
    }
    
    // Check if PostgreSQL is listening
    console.log('\n3️⃣  PostgreSQL Port Check:');
    try {
      const portCheck = execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo netstat -tlnp 2>/dev/null | grep :5432 || sudo ss -tlnp 2>/dev/null | grep :5432 || echo 'Port check failed'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log('   Port 5432 status:');
      console.log(portCheck);
    } catch (e) {
      console.log(`   ⚠️  Could not check port: ${e.message}`);
    }
    
    // Now run the actual readiness check
    console.log('\n' + '='.repeat(70));
    console.log('4️⃣  Running waitForInstanceReady for PostgreSQL...');
    console.log('='.repeat(70));
    
    const postgresReady = await waitForInstanceReady(
      postgresInstanceId,
      instanceIp,
      expandedKeyPath,
      awsConfig,
      {
        maxWaitMinutes: 5,
        checkIntervalSeconds: 5,
        instanceType: 'postgres',
        skipServiceCheck: false,
      }
    );
    
    console.log('\n' + '='.repeat(70));
    if (postgresReady) {
      console.log('✅ PostgreSQL readiness check PASSED');
    } else {
      console.log('❌ PostgreSQL readiness check FAILED');
    }
    console.log('='.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();

