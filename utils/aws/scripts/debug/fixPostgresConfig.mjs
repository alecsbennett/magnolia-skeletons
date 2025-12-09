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
    
    if (!postgresPublicIp || !postgresPrivateIp || !keyPairName) {
      console.error('❌ Could not get PostgreSQL instance info from Terraform');
      process.exit(1);
    }
    
    const awsConfig = loadAwsConfig();
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    console.log('🔧 Fixing PostgreSQL Configuration\n');
    console.log(`PostgreSQL IP: ${postgresPublicIp}`);
    console.log(`PostgreSQL Private IP: ${postgresPrivateIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${postgresPublicIp}`;
    
    const fixScript = `
#!/bin/bash
set -e

# Configure PostgreSQL to listen on all interfaces
echo "Configuring PostgreSQL to listen on all interfaces..."
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /var/lib/pgsql/data/postgresql.conf
sudo sed -i "s/^listen_addresses = 'localhost'/listen_addresses = '*'/" /var/lib/pgsql/data/postgresql.conf

# Add pg_hba.conf entry to allow connections from Magnolia instance
echo "Configuring pg_hba.conf..."
if ! sudo grep -q "host.*jackrabbit.*magnolia.*172.31" /var/lib/pgsql/data/pg_hba.conf; then
  echo "host    jackrabbit    magnolia    172.31.0.0/16    md5" | sudo tee -a /var/lib/pgsql/data/pg_hba.conf
fi

# Also allow from any IP for testing (can be restricted later)
if ! sudo grep -q "host.*jackrabbit.*magnolia.*0.0.0.0" /var/lib/pgsql/data/pg_hba.conf; then
  echo "host    jackrabbit    magnolia    0.0.0.0/0    md5" | sudo tee -a /var/lib/pgsql/data/pg_hba.conf
fi

# Restart PostgreSQL
echo "Restarting PostgreSQL..."
sudo systemctl restart postgresql

# Wait a moment for restart
sleep 2

# Verify PostgreSQL is listening
echo "Verifying PostgreSQL is listening..."
sudo netstat -tlnp | grep :5432 || sudo ss -tlnp | grep :5432

echo "PostgreSQL configuration updated successfully"
`;
    
    const scriptBase64 = Buffer.from(fixScript).toString('base64');
    
    console.log('\n📝 Applying PostgreSQL configuration fixes...\n');
    execSync(
      `${sshBase} "echo '${scriptBase64}' | base64 -d > /tmp/fix-postgres.sh && chmod +x /tmp/fix-postgres.sh && sudo /tmp/fix-postgres.sh"`,
      { stdio: 'inherit', timeout: 30000 }
    );
    
    console.log('\n✅ PostgreSQL configuration fixed!');
    console.log('\n📋 Next steps:');
    console.log('   1. Re-run the deploy script to update Magnolia config: npm run aws:deploy');
    console.log('   2. Restart Tomcat to pick up the changes');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

