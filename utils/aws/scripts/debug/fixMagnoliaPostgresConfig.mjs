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
    
    if (!instanceIp || !postgresIp || !keyPairName) {
      console.error('❌ Could not get instance info from Terraform');
      process.exit(1);
    }
    
    const awsConfig = loadAwsConfig();
    const postgresPassword = awsConfig.postgresPassword || process.env.POSTGRES_PASSWORD;
    if (!postgresPassword) {
      console.error('❌ Error: PostgreSQL password not configured');
      process.exit(1);
    }
    
    const keyPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);
    
    console.log('🔧 Fixing Magnolia PostgreSQL Configuration\n');
    console.log(`Magnolia IP: ${instanceIp}`);
    console.log(`PostgreSQL IP: ${postgresIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp}`;
    
    // Escape password for sed
    const escapedPassword = postgresPassword.replace(/'/g, "'\\''").replace(/&/g, '\\&').replace(/\\/g, '\\\\');
    
    const fixScript = `
#!/bin/bash
set -e

REPO_CONFIG="/opt/tomcat/webapps/author/WEB-INF/config/repo-conf/jackrabbit-bundle-postgres-search.xml"

if [ ! -f "$REPO_CONFIG" ]; then
  echo "Error: Repository config file not found: $REPO_CONFIG"
  exit 1
fi

echo "Updating PostgreSQL connection configuration..."

# Update connection URL
sudo sed -i "s|jdbc:postgresql://[^:]*:[0-9]*/jackrabbit|jdbc:postgresql://${postgresIp}:5432/jackrabbit|g" "$REPO_CONFIG"

# Update user
sudo sed -i 's|<param name="user" value="[^"]*" />|<param name="user" value="magnolia" />|g' "$REPO_CONFIG"

# Update password (escape special characters)
sudo sed -i 's|<param name="password" value="[^"]*" />|<param name="password" value="${escapedPassword}" />|g' "$REPO_CONFIG"

echo "Configuration updated successfully"
echo ""
echo "Current configuration:"
sudo grep -A 3 "DataSource name=\"magnolia\"" "$REPO_CONFIG" | head -4
`;
    
    const scriptBase64 = Buffer.from(fixScript).toString('base64');
    
    console.log('\n📝 Updating Magnolia PostgreSQL configuration...\n');
    execSync(
      `${sshBase} "echo '${scriptBase64}' | base64 -d > /tmp/fix-magnolia-postgres.sh && chmod +x /tmp/fix-magnolia-postgres.sh && sudo /tmp/fix-magnolia-postgres.sh"`,
      { stdio: 'inherit', timeout: 30000 }
    );
    
    console.log('\n✅ Magnolia PostgreSQL configuration fixed!');
    console.log('\n📋 Next step: Restart Tomcat');
    console.log('   sudo systemctl restart tomcat');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

