#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from '../loadAwsConfig.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
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
    
    console.log('🔍 Checking installation status...\n');
    console.log(`Instance IP: ${instanceIp}`);
    console.log(`Key path: ${expandedKeyPath}\n`);
    
    // Run comprehensive check
    const checkCommand = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no ec2-user@${instanceIp} << 'EOF'
echo "============================================================"
echo "INSTALLATION STATUS CHECK"
echo "============================================================"
echo ""
echo "1. Cloud-init Status:"
sudo cloud-init status 2>/dev/null || echo "  cloud-init command not found"
echo ""
echo "2. Installation Marker:"
if [ -f /opt/tomcat/.installation-complete ]; then
  echo "  ✓ Present"
  cat /opt/tomcat/.installation-complete
else
  echo "  ✗ Missing"
fi
echo ""
echo "3. Tomcat Components:"
if [ -f /opt/tomcat/bin/startup.sh ]; then
  echo "  ✓ startup.sh: Present"
else
  echo "  ✗ startup.sh: Missing"
fi
if [ -f /etc/systemd/system/tomcat.service ]; then
  echo "  ✓ systemd service: Present"
else
  echo "  ✗ systemd service: Missing"
fi
if [ -d /opt/tomcat ]; then
  echo "  ✓ /opt/tomcat directory: Present"
  echo "    Contents:"
  ls -la /opt/tomcat/ | head -10
else
  echo "  ✗ /opt/tomcat directory: Missing"
fi
echo ""
echo "4. Java:"
if java -version > /dev/null 2>&1; then
  echo "  ✓ Available"
  java -version 2>&1 | head -1
else
  echo "  ✗ Not available"
fi
echo ""
echo "5. Magnolia Directories:"
if [ -d /opt/magnolia ]; then
  echo "  ✓ Present"
else
  echo "  ✗ Missing"
fi
echo ""
echo "6. Installation Log (last 10 lines):"
sudo tail -10 /var/log/user-data-install.log 2>/dev/null || echo "  Log not found"
echo ""
echo "7. Cloud-init Output Log (last 5 lines):"
sudo tail -5 /var/log/cloud-init-output.log 2>/dev/null | tail -5 || echo "  Log not found"
EOF
`;
    
    execSync(checkCommand, { stdio: 'inherit' });
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

