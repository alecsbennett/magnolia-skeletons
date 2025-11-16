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
    
    console.log('🔍 Testing what happens when stat returns "not-found" but directory exists\n');
    console.log(`Instance IP: ${instanceIp}\n`);
    console.log('='.repeat(70));
    
    const sshBase = `ssh -i "${expandedKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp}`;
    
    // Simulate the exact code path from instanceReadiness.mjs
    console.log('\n1️⃣  Step 1: Run stat command (same as deploy script)...');
    let ownershipResult = '';
    try {
      const statRawResult = execSync(
        `${sshBase} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      );
      ownershipResult = statRawResult.trim();
      console.log(`   Result: "${ownershipResult}"`);
      console.log(`   Raw bytes: ${Buffer.from(statRawResult).toString('hex')}`);
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
      ownershipResult = 'error';
    }
    
    console.log(`\n2️⃣  Step 2: Check if result is "not-found"...`);
    if (ownershipResult === 'not-found') {
      console.log('   ✅ Result IS "not-found" - testing fallback logic...\n');
      
      console.log('   2a. Check if directory exists...');
      try {
        const dirCheck = execSync(
          `${sshBase} "sudo test -d /opt/tomcat && echo 'exists' || echo 'not-exists'"`,
          { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
        ).trim();
        console.log(`      Result: "${dirCheck}"`);
        
        if (dirCheck === 'not-exists') {
          console.log('      → Directory does NOT exist (expected if stat failed)');
        } else {
          console.log('      → Directory EXISTS but stat returned "not-found"!');
          console.log('      → This is the scenario we need to handle...\n');
          
          console.log('   2b. Try ls -ld fallback...');
          try {
            const lsOutput = execSync(
              `${sshBase} "sudo ls -ld /opt/tomcat 2>/dev/null || echo 'ls-failed'"`,
              { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
            ).trim();
            console.log(`      ls output: "${lsOutput}"`);
            
            if (lsOutput && lsOutput !== 'ls-failed') {
              const parts = lsOutput.split(/\s+/);
              console.log(`      Parsed parts: ${JSON.stringify(parts)}`);
              if (parts.length >= 3) {
                const detectedOwner = `${parts[2]}:${parts[3]}`;
                console.log(`      Detected ownership: "${detectedOwner}"`);
                if (parts[2] === 'tomcat' && parts[3] === 'tomcat') {
                  console.log('      ✅ Successfully detected tomcat:tomcat via ls fallback!');
                  ownershipResult = 'tomcat:tomcat';
                } else {
                  console.log(`      ⚠️  Ownership is ${detectedOwner}, not tomcat:tomcat`);
                  ownershipResult = detectedOwner;
                }
              }
            }
          } catch (e) {
            console.log(`      ❌ ls fallback failed: ${e.message}`);
          }
        }
      } catch (e) {
        console.log(`      ❌ Directory check failed: ${e.message}`);
      }
    } else {
      console.log(`   Result is "${ownershipResult}" (not "not-found")`);
      if (ownershipResult === 'tomcat:tomcat') {
        console.log('   ✅ Ownership detected correctly via stat');
      }
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`FINAL ownershipResult: "${ownershipResult}"`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();

