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
    
    console.log('🔍 Checking Magnolia/Tomcat Logs\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp}`;
    
    // Check Tomcat service status
    console.log('\n1️⃣  Tomcat Service Status:');
    try {
      const status = execSync(
        `${sshBase} "sudo systemctl status tomcat --no-pager -l 2>&1 | head -30"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(status);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check if Tomcat is listening on port 8080
    console.log('\n2️⃣  Tomcat Port Check:');
    try {
      const portCheck = execSync(
        `${sshBase} "sudo netstat -tlnp 2>/dev/null | grep :8080 || sudo ss -tlnp 2>/dev/null | grep :8080 || echo 'Port 8080 not listening'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(portCheck);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check catalina.out (main Tomcat log)
    console.log('\n3️⃣  Catalina.out Log (last 50 lines):');
    try {
      const catalinaLog = execSync(
        `${sshBase} "sudo tail -50 /opt/tomcat/logs/catalina.out 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(catalinaLog);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check for errors in catalina.out
    console.log('\n4️⃣  Errors in Catalina.out:');
    try {
      const errors = execSync(
        `${sshBase} "sudo grep -i 'error\\|exception\\|failed\\|fatal' /opt/tomcat/logs/catalina.out 2>&1 | tail -30"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      if (errors.trim()) {
        console.log(errors);
      } else {
        console.log('   No errors found');
      }
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check Magnolia webapp directory
    console.log('\n5️⃣  Magnolia Webapp Directory:');
    try {
      const webappCheck = execSync(
        `${sshBase} "sudo ls -la /opt/tomcat/webapps/author/ 2>&1 | head -20"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(webappCheck);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check WEB-INF/web.xml exists
    console.log('\n6️⃣  WEB-INF/web.xml Check:');
    try {
      const webXmlCheck = execSync(
        `${sshBase} "sudo test -f /opt/tomcat/webapps/author/WEB-INF/web.xml && echo 'EXISTS' || echo 'MISSING'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(`   web.xml: ${webXmlCheck.trim()}`);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check localhost log (Magnolia-specific)
    console.log('\n7️⃣  Localhost Log (Magnolia startup):');
    try {
      const localhostLog = execSync(
        `${sshBase} "sudo tail -50 /opt/tomcat/logs/localhost.*.log 2>&1 | tail -50"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(localhostLog);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check manager log
    console.log('\n8️⃣  Manager Log:');
    try {
      const managerLog = execSync(
        `${sshBase} "sudo tail -30 /opt/tomcat/logs/manager.*.log 2>&1 | tail -30"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      if (managerLog.trim()) {
        console.log(managerLog);
      } else {
        console.log('   No manager log found');
      }
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check Java process
    console.log('\n9️⃣  Java Process Check:');
    try {
      const javaProcess = execSync(
        `${sshBase} "ps aux | grep java | grep -v grep || echo 'No Java process found'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(javaProcess);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check if Magnolia is accessible
    console.log('\n🔟  HTTP Response Check:');
    try {
      const httpCheck = execSync(
        `${sshBase} "curl -s -o /dev/null -w 'HTTP Status: %{http_code}\\nTime: %{time_total}s\\n' http://localhost:8080/author 2>&1 || echo 'curl failed'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(httpCheck);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

