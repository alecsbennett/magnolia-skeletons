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
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
    
    if (!postgresPublicIp || !keyPairName) {
      console.error('❌ Could not get PostgreSQL instance info from Terraform');
      process.exit(1);
    }
    
    const awsConfig = loadAwsConfig();
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    console.log('🔍 Checking PostgreSQL Configuration\n');
    console.log(`PostgreSQL IP: ${postgresPublicIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${postgresPublicIp}`;
    
    // Check PostgreSQL listening address
    console.log('\n1️⃣  PostgreSQL listen_addresses:');
    try {
      const listenAddr = execSync(
        `${sshBase} "sudo grep '^listen_addresses' /var/lib/pgsql/data/postgresql.conf || sudo grep '^#listen_addresses' /var/lib/pgsql/data/postgresql.conf"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(listenAddr);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check pg_hba.conf
    console.log('\n2️⃣  pg_hba.conf (last 10 lines):');
    try {
      const pgHba = execSync(
        `${sshBase} "sudo tail -10 /var/lib/pgsql/data/pg_hba.conf"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(pgHba);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check if PostgreSQL is listening on port 5432
    console.log('\n3️⃣  PostgreSQL Port Listen Check:');
    try {
      const portCheck = execSync(
        `${sshBase} "sudo netstat -tlnp 2>/dev/null | grep :5432 || sudo ss -tlnp 2>/dev/null | grep :5432 || echo 'Port 5432 not listening'"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(portCheck);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
    // Check PostgreSQL logs for connection attempts
    console.log('\n4️⃣  PostgreSQL Logs (last 20 lines):');
    try {
      const logs = execSync(
        `${sshBase} "sudo tail -20 /var/lib/pgsql/data/log/*.log 2>/dev/null | tail -20 || sudo journalctl -u postgresql -n 20 --no-pager"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      console.log(logs);
    } catch (e) {
      console.log(`   Error: ${e.message}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

