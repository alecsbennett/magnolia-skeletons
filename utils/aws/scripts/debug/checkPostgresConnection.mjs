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
    const postgresIp = outputs.postgres_private_ip?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
    
    if (!instanceIp || !postgresIp) {
      console.error('❌ Could not get instance info from Terraform');
      process.exit(1);
    }
    
    const awsConfig = loadAwsConfig();
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    console.log('🔍 Checking PostgreSQL Connection from Magnolia Instance\n');
    console.log(`Magnolia IP: ${instanceIp}`);
    console.log(`PostgreSQL IP: ${postgresIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp}`;
    
    // Check if PostgreSQL is reachable
    console.log('\n1️⃣  PostgreSQL Network Connectivity:');
    try {
      const ping = execSync(
        `${sshBase} "nc -zv ${postgresIp} 5432 2>&1 || telnet ${postgresIp} 5432 < /dev/null 2>&1 | head -3 || echo 'Connection test failed'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(ping);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check PostgreSQL config file
    console.log('\n2️⃣  PostgreSQL Repository Configuration:');
    try {
      const repoConfig = execSync(
        `${sshBase} "sudo cat /opt/tomcat/webapps/author/WEB-INF/config/repo-conf/jackrabbit-bundle-postgres-search.xml 2>&1 | head -50"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log('   Repository config file:');
      console.log(repoConfig);
    } catch (e) {
      console.log(`   Error reading config: ${e.message}`);
    }
    
    // Check repositories.xml
    console.log('\n3️⃣  Repositories.xml Configuration:');
    try {
      const reposXml = execSync(
        `${sshBase} "sudo cat /opt/tomcat/webapps/author/WEB-INF/config/default/repositories.xml 2>&1"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(reposXml);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Try to connect to PostgreSQL from Magnolia instance
    console.log('\n4️⃣  Testing PostgreSQL Connection:');
    try {
      const pgTest = execSync(
        `${sshBase} "sudo yum install -y postgresql15 2>&1 | tail -5 && PGPASSWORD=teamsite123 psql -h ${postgresIp} -U magnolia -d jackrabbit -c 'SELECT version();' 2>&1 || echo 'Connection failed'"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      console.log(pgTest);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check PostgreSQL service status on PostgreSQL instance
    console.log('\n5️⃣  PostgreSQL Service Status (on PostgreSQL server):');
    const postgresPublicIp = outputs.postgres_public_ip?.value;
    if (postgresPublicIp) {
      try {
        const pgStatus = execSync(
          `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${postgresPublicIp} "sudo systemctl status postgresql --no-pager -l 2>&1 | head -20"`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        console.log(pgStatus);
      } catch (e) {
        console.log(`   Error: ${e.message}`);
      }
    } else {
      console.log('   PostgreSQL has no public IP, cannot check directly');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

