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
    
    console.log('🔍 Testing EXACT Status Check Code from instanceReadiness.mjs\n');
    console.log(`Instance IP: ${instanceIp}`);
    console.log(`Key path: ${expandedKeyPath}\n`);
    console.log('='.repeat(70));
    
    // This is the EXACT code from the status check section
    const keyPath_var = expandedKeyPath;
    const instanceIp_var = instanceIp;
    
    console.log('\n1️⃣  Step 1: Check ownership (same as code)...');
    let useTomcatUser = false;
    try {
      const ownershipCheck = execSync(
        `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp_var} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      console.log(`   Ownership result: "${ownershipCheck}"`);
      if (ownershipCheck === 'tomcat:tomcat') {
        useTomcatUser = true;
        console.log('   ✅ Will use: sudo -u tomcat');
      } else {
        console.log(`   ⚠️  Will use: sudo (root) - ownership was "${ownershipCheck}"`);
      }
    } catch (e) {
      console.log(`   ❌ Ownership check failed: ${e.message}`);
      useTomcatUser = false;
    }
    
    const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
    console.log(`   Final sudoPrefix: "${sudoPrefix}"\n`);
    
    console.log('2️⃣  Step 2: Check each component (EXACT code from instanceReadiness.mjs)...\n');
    
    // Check each component individually with proper error handling (EXACT CODE)
    let startupCheck = 'startup-no';
    let serviceCheck = 'service-no';
    let dirCheck = 'dir-no';
    
    console.log('   Testing startup.sh check...');
    try {
      startupCheck = execSync(
        `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp_var} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh && echo 'startup-yes' || echo 'startup-no'"`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
      ).trim();
      console.log(`   ✅ Result: "${startupCheck}"`);
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
      console.log(`   ❌ stderr: ${e.stderr?.toString().substring(0, 200) || 'none'}`);
      startupCheck = 'startup-no';
    }
    
    console.log('\n   Testing service check...');
    try {
      serviceCheck = execSync(
        `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp_var} "test -f /etc/systemd/system/tomcat.service && echo 'service-yes' || echo 'service-no'"`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
      ).trim();
      console.log(`   ✅ Result: "${serviceCheck}"`);
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
      console.log(`   ❌ stderr: ${e.stderr?.toString().substring(0, 200) || 'none'}`);
      serviceCheck = 'service-no';
    }
    
    console.log('\n   Testing dir check...');
    try {
      dirCheck = execSync(
        `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp_var} "${sudoPrefix} test -d /opt/tomcat && echo 'dir-yes' || echo 'dir-no'"`,
        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
      ).trim();
      console.log(`   ✅ Result: "${dirCheck}"`);
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
      console.log(`   ❌ stderr: ${e.stderr?.toString().substring(0, 200) || 'none'}`);
      dirCheck = 'dir-no';
    }
    
    console.log('\n3️⃣  Step 3: Determine status (EXACT code logic)...\n');
    const hasStartup = startupCheck === 'startup-yes';
    const hasService = serviceCheck === 'service-yes';
    const hasDir = dirCheck === 'dir-yes';
    
    console.log(`   hasStartup: ${hasStartup} (from "${startupCheck}")`);
    console.log(`   hasService: ${hasService} (from "${serviceCheck}")`);
    console.log(`   hasDir: ${hasDir} (from "${dirCheck}")`);
    
    let tomcatInstalled = 'unknown';
    let tomcatDetails = '';
    
    if (hasStartup && hasService && hasDir) {
      tomcatInstalled = '✓ Installed';
      tomcatDetails = ' (startup.sh, service, dir all present)';
    } else {
      tomcatInstalled = '✗ Partially installed';
      const missing = [];
      if (!hasStartup) missing.push('startup.sh');
      if (!hasService) missing.push('service');
      if (!hasDir) missing.push('dir');
      tomcatDetails = ` (missing: ${missing.join(', ')})`;
    }
    
    console.log(`\n   Final status: ${tomcatInstalled}${tomcatDetails}`);
    
    // Debug: Try the commands manually to see what's happening
    console.log('\n4️⃣  Debug: Testing commands manually...\n');
    
    console.log('   Manual test 1: Check what sudoPrefix actually resolves to');
    try {
      const testCmd = `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no ec2-user@${instanceIp_var} "echo 'SUDO_PREFIX=${sudoPrefix}'"`;
      const testResult = execSync(testCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
      console.log(`   Result: ${testResult}`);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    console.log('\n   Manual test 2: Run the exact command that should work');
    try {
      const exactCmd = `ssh -i "${keyPath_var}" -o StrictHostKeyChecking=no ec2-user@${instanceIp_var} "sudo -u tomcat test -f /opt/tomcat/bin/startup.sh && echo 'startup-yes' || echo 'startup-no'"`;
      console.log(`   Command: ${exactCmd.substring(0, 100)}...`);
      const exactResult = execSync(exactCmd, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
      console.log(`   Result: "${exactResult}"`);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
      if (e.stderr) console.log(`   stderr: ${e.stderr.toString().substring(0, 200)}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stderr) console.error('stderr:', error.stderr.toString());
    process.exit(1);
  }
})();

