#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from '../loadAwsConfig.mjs';
import { getInstallationStatus } from '../instanceReadiness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
    console.log('🔍 Testing readiness check functions...\n');
    
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
    
    console.log(`Instance IP: ${instanceIp}`);
    console.log(`Key path: ${expandedKeyPath}\n`);
    console.log('='.repeat(70));
    
    // Test the actual checkServicesReady function logic
    console.log('\n1️⃣  Testing checkServicesReady logic:');
    const checkCommand = `
      sudo -u tomcat test -f /opt/tomcat/bin/startup.sh && \
      test -f /etc/systemd/system/tomcat.service && \
      sudo -u tomcat test -f /opt/tomcat/.installation-complete && \
      sudo -u tomcat test -d /opt/magnolia && \
      java -version > /dev/null 2>&1 && \
      sudo -u tomcat test -d /opt/tomcat/conf && \
      sudo -u tomcat test -d /opt/tomcat/webapps
    `;
    
    try {
      execSync(
        `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${checkCommand}"`,
        { stdio: 'inherit', timeout: 5000 }
      );
      console.log('✅ checkServicesReady: PASSED');
    } catch (e) {
      console.log('❌ checkServicesReady: FAILED');
      console.log(`   Error: ${e.message}`);
      
      // Test each part individually
      console.log('\n   Testing each check individually:');
      const checks = [
        { name: 'startup.sh', cmd: `sudo -u tomcat test -f /opt/tomcat/bin/startup.sh` },
        { name: 'systemd service', cmd: `test -f /etc/systemd/system/tomcat.service` },
        { name: 'installation marker', cmd: `sudo -u tomcat test -f /opt/tomcat/.installation-complete` },
        { name: 'magnolia dir', cmd: `sudo -u tomcat test -d /opt/magnolia` },
        { name: 'java', cmd: `java -version > /dev/null 2>&1` },
        { name: 'tomcat conf', cmd: `sudo -u tomcat test -d /opt/tomcat/conf` },
        { name: 'tomcat webapps', cmd: `sudo -u tomcat test -d /opt/tomcat/webapps` },
      ];
      
      for (const check of checks) {
        try {
          execSync(
            `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${check.cmd}"`,
            { stdio: 'ignore', timeout: 5000 }
          );
          console.log(`   ✅ ${check.name}: PASSED`);
        } catch (e) {
          console.log(`   ❌ ${check.name}: FAILED`);
        }
      }
    }
    
    // Test getInstallationStatus
    console.log('\n2️⃣  Testing getInstallationStatus:');
    try {
      const status = getInstallationStatus(instanceIp, expandedKeyPath, false);
      console.log('✅ getInstallationStatus: SUCCESS');
      console.log('\n   Results:');
      console.log(`   - tomcatStartup: ${status.checks?.tomcatStartup ? '✓' : '✗'}`);
      console.log(`   - systemdService: ${status.checks?.systemdService ? '✓' : '✗'}`);
      console.log(`   - installationMarker: ${status.checks?.installationMarker ? '✓' : '✗'}`);
      console.log(`   - magnoliaDirs: ${status.checks?.magnoliaDirs ? '✓' : '✗'}`);
      console.log(`   - javaAvailable: ${status.checks?.javaAvailable ? '✓' : '✗'}`);
      console.log(`   - tomcatDirs: ${status.checks?.tomcatDirs ? '✓' : '✗'}`);
      console.log(`   - cloudInitStatus: ${status.cloudInitStatus || 'unknown'}`);
    } catch (e) {
      console.log('❌ getInstallationStatus: FAILED');
      console.log(`   Error: ${e.message}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

