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
    const postgresPassword = awsConfig.postgresPassword || process.env.POSTGRES_PASSWORD || 'teamsite123';
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    console.log('🔍 Verifying PostgreSQL User\n');
    console.log(`PostgreSQL IP: ${postgresPublicIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${postgresPublicIp}`;
    
    const verifyScript = `
#!/bin/bash
set -e

echo "Checking if magnolia user exists..."
sudo -u postgres psql -c "\\du magnolia" || echo "User magnolia not found"

echo ""
echo "Checking if jackrabbit database exists..."
sudo -u postgres psql -c "\\l jackrabbit" || echo "Database jackrabbit not found"

echo ""
echo "Creating/fixing magnolia user..."
sudo -u postgres psql <<PSQL
DO \\$\\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'magnolia') THEN
    CREATE USER magnolia WITH PASSWORD '${postgresPassword}';
    RAISE NOTICE 'User magnolia created';
  ELSE
    ALTER USER magnolia WITH PASSWORD '${postgresPassword}';
    RAISE NOTICE 'User magnolia password updated';
  END IF;
END
\\$\\$;

-- Ensure database exists
SELECT 'CREATE DATABASE jackrabbit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'jackrabbit')\\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE jackrabbit TO magnolia;
ALTER DATABASE jackrabbit OWNER TO magnolia;

\\c jackrabbit
GRANT ALL ON SCHEMA public TO magnolia;
PSQL

echo ""
echo "Testing connection as magnolia user..."
PGPASSWORD='${postgresPassword}' psql -h localhost -U magnolia -d jackrabbit -c "SELECT version();" || echo "Connection test failed"

echo ""
echo "✅ PostgreSQL user verification complete"
`;
    
    const scriptBase64 = Buffer.from(verifyScript).toString('base64');
    
    console.log('\n📝 Verifying PostgreSQL user...\n');
    execSync(
      `${sshBase} "echo '${scriptBase64}' | base64 -d > /tmp/verify-postgres-user.sh && chmod +x /tmp/verify-postgres-user.sh && sudo /tmp/verify-postgres-user.sh"`,
      { stdio: 'inherit', timeout: 30000 }
    );
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

