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
    
    console.log('🔍 Testing EXACT Code Path from Status Check (attempt 3)\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    // This is the EXACT code from the status check section (lines 440-465)
    const attempts = 3; // Simulating attempt 3
    
    if (attempts % 3 === 0) {
      console.log('\n✅ This matches the status check code path (attempt % 3 === 0)\n');
      
      try {
        // EXACT code from line 441-445
        const cloudInitResult = execSync(
          `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo cloud-init status 2>/dev/null || echo 'not-found'"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const cloudInitStatus = cloudInitResult.trim();
        console.log(`1. Cloud-init status: "${cloudInitStatus}"`);
        
        // EXACT code from line 447-462
        let useTomcatUser = false;
        let ownershipResult = '';
        try {
          ownershipResult = execSync(
            `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          console.log(`2. Ownership check result: "${ownershipResult}"`);
          if (ownershipResult === 'tomcat:tomcat') {
            useTomcatUser = true;
            console.log('   ✅ Detected tomcat:tomcat ownership');
          } else {
            console.log(`   ⚠️  Ownership is "${ownershipResult}" - not tomcat:tomcat`);
          }
        } catch (e) {
          ownershipResult = `error: ${e.message.substring(0, 30)}`;
          console.log(`   ❌ Ownership check exception: ${e.message}`);
          useTomcatUser = false;
        }
        const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
        console.log(`3. Sudo prefix determined: "${sudoPrefix}"`);
        
        // EXACT code from line 464-473
        let markerCheck = 'missing';
        try {
          markerCheck = execSync(
            `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/.installation-complete && echo 'present' || echo 'missing'"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          console.log(`4. Marker check result: "${markerCheck}"`);
        } catch (e) {
          markerCheck = 'missing';
          console.log(`   ❌ Marker check exception: ${e.message}`);
        }
        
        // EXACT code from line 475-548
        let tomcatInstalled = 'unknown';
        let tomcatDetails = '';
        let debugInfo = `[ownership:${ownershipResult}, sudo:${sudoPrefix}]`;
        console.log(`5. Debug info: ${debugInfo}`);
        
        try {
          let startupCheck = 'startup-no';
          let serviceCheck = 'service-no';
          let dirCheck = 'dir-no';
          let startupError = '';
          let serviceError = '';
          let dirError = '';
          
          console.log('\n6. Running individual checks...');
          
          try {
            startupCheck = execSync(
              `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh && echo 'startup-yes' || echo 'startup-no'"`,
              { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
            ).trim();
            console.log(`   startup.sh: "${startupCheck}"`);
          } catch (e) {
            startupCheck = 'startup-no';
            startupError = e.message.substring(0, 50);
            console.log(`   startup.sh: ERROR - ${startupError}`);
          }
          
          try {
            serviceCheck = execSync(
              `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "test -f /etc/systemd/system/tomcat.service && echo 'service-yes' || echo 'service-no'"`,
              { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
            ).trim();
            console.log(`   service: "${serviceCheck}"`);
          } catch (e) {
            serviceCheck = 'service-no';
            serviceError = e.message.substring(0, 50);
            console.log(`   service: ERROR - ${serviceError}`);
          }
          
          try {
            dirCheck = execSync(
              `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -d /opt/tomcat && echo 'dir-yes' || echo 'dir-no'"`,
              { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
            ).trim();
            console.log(`   dir: "${dirCheck}"`);
          } catch (e) {
            dirCheck = 'dir-no';
            dirError = e.message.substring(0, 50);
            console.log(`   dir: ERROR - ${dirError}`);
          }
          
          const hasStartup = startupCheck === 'startup-yes';
          const hasService = serviceCheck === 'service-yes';
          const hasDir = dirCheck === 'dir-yes';
          
          if (hasStartup && hasService && hasDir) {
            tomcatInstalled = '✓ Installed';
            tomcatDetails = ' (startup.sh, service, dir all present)';
          } else {
            tomcatInstalled = '✗ Partially installed';
            const missing = [];
            if (!hasStartup) {
              missing.push(`startup.sh(${startupCheck}${startupError ? ':' + startupError : ''})`);
            }
            if (!hasService) {
              missing.push(`service(${serviceCheck}${serviceError ? ':' + serviceError : ''})`);
            }
            if (!hasDir) {
              missing.push(`dir(${dirCheck}${dirError ? ':' + dirError : ''})`);
            }
            tomcatDetails = ` (missing: ${missing.join(', ')}) ${debugInfo}`;
          }
        } catch (e) {
          tomcatInstalled = `? Check failed: ${e.message.substring(0, 40)}`;
          tomcatDetails = ` ${debugInfo}`;
        }
        
        console.log('\n' + '='.repeat(70));
        console.log('FINAL OUTPUT (matches deploy script):');
        console.log('='.repeat(70));
        console.log(`       📊 Status check (attempt ${attempts}):`);
        console.log(`          Cloud-init: ${cloudInitStatus}`);
        console.log(`          Installation marker: ${markerCheck === 'present' ? '✓ Present' : '✗ Missing'}`);
        console.log(`          Tomcat installed: ${tomcatInstalled}${tomcatDetails}`);
        
      } catch (e) {
        console.log(`\n❌ Outer try-catch error: ${e.message}`);
      }
    } else {
      console.log('This code path would not execute (attempt % 3 !== 0)');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

