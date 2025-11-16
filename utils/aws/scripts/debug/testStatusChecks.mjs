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
    
    console.log('🔍 Testing Status Checks (Same as deploy script)\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp}`;
    
    // Step 1: Check ownership (same as the code)
    console.log('\n1️⃣  Checking ownership to determine sudo prefix...');
    let useTomcatUser = false;
    let ownershipResult = '';
    try {
      ownershipResult = execSync(
        `${sshBase} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      console.log(`   Ownership result: "${ownershipResult}"`);
      if (ownershipResult === 'tomcat:tomcat') {
        useTomcatUser = true;
        console.log('   ✅ Using: sudo -u tomcat');
      } else {
        console.log('   ⚠️  Using: sudo (root)');
      }
    } catch (e) {
      console.log(`   ❌ Ownership check failed: ${e.message}`);
      useTomcatUser = false;
    }
    
    const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
    console.log(`   Final sudo prefix: "${sudoPrefix}"\n`);
    
    // Step 2: Test each check individually with verbose output
    console.log('2️⃣  Testing individual checks with the determined sudo prefix:\n');
    
    const checks = [
      {
        name: 'startup.sh',
        command: `${sshBase} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh && echo 'startup-yes' || echo 'startup-no'"`
      },
      {
        name: 'systemd service',
        command: `${sshBase} "test -f /etc/systemd/system/tomcat.service && echo 'service-yes' || echo 'service-no'"`
      },
      {
        name: '/opt/tomcat directory',
        command: `${sshBase} "${sudoPrefix} test -d /opt/tomcat && echo 'dir-yes' || echo 'dir-no'"`
      }
    ];
    
    const results = {};
    
    for (const check of checks) {
      try {
        console.log(`   Testing: ${check.name}`);
        console.log(`   Command: ${check.command.substring(0, 80)}...`);
        const result = execSync(check.command, { 
          encoding: 'utf-8', 
          timeout: 10000,
          stdio: 'pipe'
        }).trim();
        console.log(`   ✅ Result: "${result}"`);
        results[check.name] = result;
        console.log();
      } catch (error) {
        const errorMsg = error.message || error.toString();
        const stderr = error.stderr?.toString() || '';
        console.log(`   ❌ FAILED: ${errorMsg.substring(0, 100)}`);
        if (stderr) {
          console.log(`   Stderr: ${stderr.substring(0, 100)}`);
        }
        results[check.name] = 'ERROR';
        console.log();
      }
    }
    
    // Step 3: Show what the code would determine
    console.log('3️⃣  What the code would determine:\n');
    const hasStartup = results['startup.sh'] === 'startup-yes';
    const hasService = results['systemd service'] === 'service-yes';
    const hasDir = results['/opt/tomcat directory'] === 'dir-yes';
    
    console.log(`   startup.sh: ${hasStartup ? '✓' : '✗'} (${results['startup.sh']})`);
    console.log(`   service: ${hasService ? '✓' : '✗'} (${results['systemd service']})`);
    console.log(`   dir: ${hasDir ? '✓' : '✗'} (${results['/opt/tomcat directory']})`);
    
    if (hasStartup && hasService && hasDir) {
      console.log('\n   ✅ Status: ✓ Installed (all present)');
    } else {
      const missing = [];
      if (!hasStartup) missing.push('startup.sh');
      if (!hasService) missing.push('service');
      if (!hasDir) missing.push('dir');
      console.log(`\n   ❌ Status: ✗ Partially installed (missing: ${missing.join(', ')})`);
    }
    
    // Step 4: Debug - try alternative checks
    console.log('\n4️⃣  Debug: Trying alternative checks...\n');
    
    console.log('   Alternative 1: Direct ls check');
    try {
      const lsResult = execSync(
        `${sshBase} "${sudoPrefix} ls -la /opt/tomcat/bin/startup.sh 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim();
      console.log(`   Result: ${lsResult.substring(0, 80)}`);
    } catch (e) {
      console.log(`   Error: ${e.message.substring(0, 80)}`);
    }
    
    console.log('\n   Alternative 2: Test as root');
    try {
      const rootResult = execSync(
        `${sshBase} "sudo test -f /opt/tomcat/bin/startup.sh && echo 'yes' || echo 'no'"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim();
      console.log(`   Result: "${rootResult}"`);
    } catch (e) {
      console.log(`   Error: ${e.message.substring(0, 80)}`);
    }
    
    console.log('\n   Alternative 3: Test as tomcat user');
    try {
      const tomcatResult = execSync(
        `${sshBase} "sudo -u tomcat test -f /opt/tomcat/bin/startup.sh && echo 'yes' || echo 'no'"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim();
      console.log(`   Result: "${tomcatResult}"`);
    } catch (e) {
      console.log(`   Error: ${e.message.substring(0, 80)}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

