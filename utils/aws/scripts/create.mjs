#!/usr/bin/env node

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { loadAwsConfig, setAwsEnvironment } from './loadAwsConfig.mjs';
import { ensureKeyPair } from './keyPairManager.mjs';
import { findTaggedInstances, findTaggedSecurityGroups, findTaggedVolumes } from './resourceChecker.mjs';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const terraformDir = join(__dirname, '..', 'terraform');
const projectRoot = join(__dirname, '..', '..', '..');

// Helper function to get public IP
function getPublicIP() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.ipify.org',
      port: 443,
      path: '/',
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data.trim());
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout getting public IP'));
    });

    req.end();
  });
}

// Parse CIDR from terraform.tfvars
function parseCidr(tfvarsContent, varName) {
  // Match varName = "value" but NOT commented lines (lines starting with # or whitespace followed by #)
  // Use multiline mode and match from start of line (or after whitespace) but not if line starts with #
  const lines = tfvarsContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip commented lines
    if (trimmed.startsWith('#')) {
      continue;
    }
    // Match varName = "value" or varName = 'value' or varName = value
    const regex = new RegExp(`^\\s*${varName}\\s*=\\s*["']?([^"'\n#]+)["']?`);
    const match = trimmed.match(regex);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

// Handle CIDR auto-detection and formatting
async function processCidr(tfvarsContent, varName, displayName) {
  let cidr = parseCidr(tfvarsContent, varName);
  const autoVars = {};
  
  // Handle IP detection/restriction
  if (cidr && (cidr.toLowerCase() === 'auto' || cidr.toLowerCase() === 'auto-detect')) {
    console.log(`🌐 Auto-detecting public IP address for ${displayName}...`);
    try {
      const publicIp = await getPublicIP();
      cidr = `${publicIp}/32`;
      console.log(`   ✓ Detected public IP: ${publicIp}`);
      console.log(`   ✓ ${displayName} access will be restricted to: ${cidr}\n`);
      
      // Store for -var flag override (not modifying terraform.tfvars)
      autoVars[varName] = cidr;
    } catch (error) {
      console.error(`   ⚠️  Warning: Could not auto-detect IP: ${error.message}`);
      console.error(`   Continuing with default access\n`);
      cidr = null;
    }
  } else if (cidr) {
    // Ensure CIDR format (add /32 if no CIDR notation)
    if (!cidr.includes('/')) {
      cidr = `${cidr}/32`;
    }
    console.log(`🔒 ${displayName} access will be restricted to: ${cidr}\n`);
    // Note: Value is already in terraform.tfvars, no override needed
  }
  
  return { cidr, autoVars };
}

(async () => {
  // Load and set AWS credentials
  console.log('🔐 Loading AWS credentials...\n');
  const awsConfig = loadAwsConfig();
  setAwsEnvironment(awsConfig);

  // Change to terraform directory
  process.chdir(terraformDir);

  console.log('🚀 Creating AWS infrastructure for Magnolia...\n');

  // Check if terraform.tfvars exists
  const tfvarsPath = join(terraformDir, 'terraform.tfvars');
  if (!existsSync(tfvarsPath)) {
    console.error('❌ Error: terraform.tfvars not found!');
    console.error(`   Please copy terraform.tfvars.example to terraform.tfvars and configure it.`);
    console.error(`   Location: ${terraformDir}/terraform.tfvars`);
    process.exit(1);
  }

  // Read terraform.tfvars (read-only, won't modify it)
  const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
  
  // Process CIDR values and set environment variables for validate, build -var flags for plan/apply
  // Using TF_VAR_* for validate (which doesn't accept -var flags), and -var flags for plan/apply
  let terraformVars = [];

  // Process SSH CIDR
  const sshResult = await processCidr(tfvarsContent, 'allowed_ssh_cidr', 'SSH');
  if (sshResult.autoVars.allowed_ssh_cidr) {
    process.env.TF_VAR_allowed_ssh_cidr = sshResult.autoVars.allowed_ssh_cidr;
    terraformVars.push('-var', `allowed_ssh_cidr=${sshResult.autoVars.allowed_ssh_cidr}`);
  }
  if (!sshResult.cidr) {
    console.log('   ℹ️  SSH access using default (allowing access from anywhere - 0.0.0.0/0)\n');
  }
  
  // Process HTTP CIDR
  const httpResult = await processCidr(tfvarsContent, 'allowed_http_cidr', 'HTTP/HTTPS');
  if (httpResult.autoVars.allowed_http_cidr) {
    process.env.TF_VAR_allowed_http_cidr = httpResult.autoVars.allowed_http_cidr;
    terraformVars.push('-var', `allowed_http_cidr=${httpResult.autoVars.allowed_http_cidr}`);
  }
  if (!httpResult.cidr) {
    console.log('   ℹ️  No HTTP access restriction configured (allowing access from anywhere)\n');
  }
  
  if (terraformVars.length > 0) {
    console.log('   ℹ️  Using TF_VAR_* environment variables and -var flags to override "auto" values with detected IPs\n');
  }

  // Get project name for resource checking (read from original tfvars)
  // Use parseCidr for consistency with clean.mjs (handles commented lines properly)
  let projectName = 'magnolia-author';
  try {
    const projectValue = parseCidr(tfvarsContent, 'project_name');
    if (projectValue) {
      projectName = projectValue;
    }
  } catch (error) {
    // Use default
  }

  // Parse terraform.tfvars to get key_pair_name
  // Use parseCidr for consistency (handles commented lines properly)
  let keyPairName = null;
  try {
    const keyPairValue = parseCidr(tfvarsContent, 'key_pair_name');
    if (keyPairValue) {
      keyPairName = keyPairValue;
    }
  } catch (error) {
    console.warn(`⚠️  Warning: Could not parse terraform.tfvars: ${error.message}`);
  }

  // Ensure SSH key pair exists (with user prompt if needed)
  if (keyPairName) {
    try {
      await ensureKeyPair(keyPairName, awsConfig);
    } catch (error) {
      console.error(`\n❌ Error managing SSH key pair: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.warn('⚠️  Warning: key_pair_name not found in terraform.tfvars');
    console.warn('   Skipping SSH key pair check. Make sure the key pair exists in AWS.');
  }

  // Check for existing resources
  console.log('🔍 Checking for existing infrastructure...\n');
  const existingInstances = await findTaggedInstances(awsConfig, projectName);
  const existingSecurityGroups = await findTaggedSecurityGroups(awsConfig, projectName);
  const existingVolumes = await findTaggedVolumes(awsConfig, projectName);
  
  // Filter out terminated instances
  const activeInstances = existingInstances.filter(
    inst => inst.State !== 'terminated' && inst.State !== 'shutting-down'
  );
  
  // Filter out available volumes (attached volumes will be handled by Terraform)
  const availableVolumes = existingVolumes.filter(
    vol => vol.State === 'available' && (!vol.Attachments || vol.Attachments.length === 0)
  );

  if (activeInstances.length > 0 || existingSecurityGroups.length > 0 || availableVolumes.length > 0) {
    console.log('⚠️  WARNING: Found existing infrastructure resources!\n');
    
    if (activeInstances.length > 0) {
      console.log(`   Active EC2 Instances (${activeInstances.length}):`);
      activeInstances.forEach(inst => {
        console.log(`     - ${inst.InstanceId} (${inst.State}) - ${inst.Name || 'unnamed'}`);
        if (inst.PublicIp) {
          console.log(`       Public IP: ${inst.PublicIp}`);
        }
      });
      console.log('');
    }
    
    if (existingSecurityGroups.length > 0) {
      console.log(`   Security Groups (${existingSecurityGroups.length}):`);
      existingSecurityGroups.forEach(sg => {
        console.log(`     - ${sg.GroupId} (${sg.GroupName})`);
      });
      console.log('');
    }
    
    if (availableVolumes.length > 0) {
      console.log(`   Available EBS Volumes (${availableVolumes.length}):`);
      availableVolumes.forEach(vol => {
        console.log(`     - ${vol.VolumeId} (${vol.Size}GB) - ${vol.Name || 'unnamed'}`);
      });
      console.log('');
    }
    
    console.log('   Creating new infrastructure may cause conflicts or duplicate resources.');
    console.log('   Consider running "npm run aws:clean" first to remove existing resources.\n');
    
    // Prompt user
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise((resolve) => {
      rl.question('   Do you want to continue anyway? (y/n): ', (ans) => {
        rl.close();
        resolve(ans.toLowerCase().trim());
      });
    });
    
    if (answer !== 'y' && answer !== 'yes') {
      console.log('\n❌ Aborting. Please clean up existing resources first: npm run aws:clean\n');
      process.exit(0);
    }
    
    console.log('\n   Proceeding with infrastructure creation...\n');
  } else {
    console.log('✅ No existing active infrastructure found. Proceeding with creation...\n');
  }

  try {
    // Initialize Terraform
    console.log('📦 Initializing Terraform...');
    execSync('terraform init', { stdio: 'inherit' });

    // Build terraform command args helper
    const buildTerraformArgs = (baseArgs) => {
      return terraformVars.length > 0 ? [...baseArgs, ...terraformVars] : baseArgs;
    };

    // Validate configuration
    // Note: terraform validate doesn't accept -var flags, so we use TF_VAR_* environment variables
    console.log('\n✅ Validating Terraform configuration...');
    const validateResult = spawnSync('terraform', ['validate'], { 
      stdio: 'inherit',
      cwd: terraformDir,
      env: process.env
    });
    if (validateResult.error || validateResult.status !== 0) {
      throw new Error(`terraform validate failed`);
    }

    // Plan changes
    console.log('\n📋 Planning infrastructure changes...');
    const planArgs = buildTerraformArgs(['terraform', 'plan']);
    const planResult = spawnSync(planArgs[0], planArgs.slice(1), { 
      stdio: 'inherit',
      cwd: terraformDir
    });
    if (planResult.error || planResult.status !== 0) {
      throw new Error(`terraform plan failed`);
    }

    // Apply changes
    console.log('\n🔨 Applying infrastructure changes...');
    console.log('   This will create EC2 instance, security groups, and other resources.');
    console.log('   This may take a few minutes...\n');
    
    const applyArgs = buildTerraformArgs(['terraform', 'apply', '-auto-approve']);
    const applyResult = spawnSync(applyArgs[0], applyArgs.slice(1), { 
      stdio: 'inherit',
      cwd: terraformDir
    });
    if (applyResult.error || applyResult.status !== 0) {
      throw new Error(`terraform apply failed`);
    }

    // Show outputs
    console.log('\n📊 Infrastructure outputs:');
    execSync('terraform output', { stdio: 'inherit' });

    console.log('\n✅ Infrastructure created successfully!');
    console.log('\nNext steps:');
    console.log('   1. Wait a few minutes for the instance to finish initialization');
    console.log('   2. Run: npm run aws:deploy');
    console.log('   3. Access Magnolia at the URL shown above\n');

  } catch (error) {
    console.error('\n❌ Error during Terraform execution:', error.message);
    process.exit(1);
  }
})();
