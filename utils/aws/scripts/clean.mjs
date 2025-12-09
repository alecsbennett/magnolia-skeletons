#!/usr/bin/env node

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { loadAwsConfig, setAwsEnvironment, createEc2Client } from './loadAwsConfig.mjs';
import { checkForOrphanedResources } from './resourceChecker.mjs';
import { TerminateInstancesCommand, DeleteSecurityGroupCommand, DeleteVolumeCommand } from '@aws-sdk/client-ec2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const terraformDir = join(__dirname, '..', 'terraform');

// Parse CIDR from terraform.tfvars (same logic as create.mjs)
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

// Load and set AWS credentials
const awsConfig = loadAwsConfig();
setAwsEnvironment(awsConfig);

// Change to terraform directory
process.chdir(terraformDir);

console.log('🧹 Cleaning up AWS infrastructure...\n');
console.log('⚠️  WARNING: This will destroy all AWS resources created by Terraform!');
console.log('   This includes:');
console.log('   - EC2 instances (Magnolia and PostgreSQL)');
console.log('   - Security groups');
console.log('   - EBS volumes (including root volumes)');
console.log('   - Volume attachments');
console.log('   - All associated data\n');

// Check if terraform state exists
const terraformState = join(terraformDir, 'terraform.tfstate');
let terraformResources = {
  instances: [],
  securityGroups: [],
  volumes: [],
};

if (existsSync(terraformState)) {
  try {
    // Parse Terraform state to get resource IDs
    const stateContent = readFileSync(terraformState, 'utf-8');
    const state = JSON.parse(stateContent);
    
    // Extract resource IDs from state
    if (state.resources) {
      for (const resource of state.resources) {
        if (resource.type === 'aws_instance' && resource.instances) {
          for (const instance of resource.instances) {
            if (instance.attributes?.id) {
              terraformResources.instances.push(instance.attributes.id);
            }
          }
        }
        if (resource.type === 'aws_security_group' && resource.instances) {
          for (const sg of resource.instances) {
            if (sg.attributes?.id) {
              terraformResources.securityGroups.push(sg.attributes.id);
            }
          }
        }
        if (resource.type === 'aws_ebs_volume' && resource.instances) {
          for (const volume of resource.instances) {
            if (volume.attributes?.id) {
              terraformResources.volumes.push(volume.attributes.id);
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️  Warning: Could not parse Terraform state: ${error.message}`);
  }
}

// Get project name from terraform.tfvars (using parseCidr logic for consistency)
let projectName = 'magnolia-author';
try {
  const tfvarsPath = join(terraformDir, 'terraform.tfvars');
  if (existsSync(tfvarsPath)) {
    const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
    const projectCidr = parseCidr(tfvarsContent, 'project_name');
    if (projectCidr) {
      projectName = projectCidr;
    }
  }
} catch (error) {
  // Use default
}

// Prompt for confirmation
const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Type "CLEAN" to confirm: ', async (answer) => {
  rl.close();

  if (answer.trim() !== 'CLEAN') {
    console.log('\n❌ Confirmation failed. Aborting cleanup.');
    process.exit(0);
  }

  try {
    // Check for orphaned resources
    const resources = await checkForOrphanedResources(awsConfig, projectName, terraformResources);
    
    if (resources.orphaned.instances.length > 0 || 
        resources.orphaned.securityGroups.length > 0 || 
        resources.orphaned.volumes.length > 0) {
      console.log('\n⚠️  Found orphaned resources (not in Terraform state):');
      
      if (resources.orphaned.instances.length > 0) {
        console.log(`   Instances: ${resources.orphaned.instances.length}`);
        resources.orphaned.instances.forEach(inst => {
          console.log(`     - ${inst.InstanceId} (${inst.State})`);
        });
      }
      
      if (resources.orphaned.securityGroups.length > 0) {
        console.log(`   Security Groups: ${resources.orphaned.securityGroups.length}`);
        resources.orphaned.securityGroups.forEach(sg => {
          console.log(`     - ${sg.GroupId} (${sg.GroupName})`);
        });
      }
      
      if (resources.orphaned.volumes.length > 0) {
        console.log(`   Volumes: ${resources.orphaned.volumes.length}`);
        resources.orphaned.volumes.forEach(vol => {
          console.log(`     - ${vol.VolumeId} (${vol.Size}GB, ${vol.State})`);
        });
      }
      
      console.log('\n   These will be cleaned up after Terraform destroy.\n');
    } else {
      console.log('✅ No orphaned resources found.\n');
    }

    // Destroy Terraform-managed resources
    if (existsSync(terraformState)) {
      console.log('🗑️  Destroying Terraform-managed infrastructure...');
      console.log('   This may take a few minutes...\n');
      
      // Check if terraform.tfvars has "auto" values that need to be overridden
      // Use -var flags (like create.mjs) to override values before validation
      const tfvarsPath = join(terraformDir, 'terraform.tfvars');
      const terraformVars = [];
      
      if (existsSync(tfvarsPath)) {
        const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
        
        // Check for "auto" values and override them with valid values for destroy
        // Use parseCidr to properly handle commented lines (same logic as create.mjs)
        const sshCidr = parseCidr(tfvarsContent, 'allowed_ssh_cidr');
        const httpCidr = parseCidr(tfvarsContent, 'allowed_http_cidr');
        
        if (sshCidr && (sshCidr.toLowerCase() === 'auto' || sshCidr.toLowerCase() === 'auto-detect')) {
          terraformVars.push('-var', 'allowed_ssh_cidr=0.0.0.0/0');
        }
        if (httpCidr && (httpCidr.toLowerCase() === 'auto' || httpCidr.toLowerCase() === 'auto-detect')) {
          terraformVars.push('-var', 'allowed_http_cidr=0.0.0.0/0');
        }
        
        if (terraformVars.length > 0) {
          console.log('   ℹ️  Overriding "auto" values with -var flags for destroy operation\n');
        }
      }
      
      try {
        // Build destroy command with -var flags if needed
        const destroyArgs = ['destroy', '-auto-approve', ...terraformVars];
        const result = spawnSync('terraform', destroyArgs, { 
          stdio: 'inherit',
          cwd: terraformDir,
          env: process.env
        });
        
        if (result.error) {
          throw result.error;
        }
        
        if (result.status !== 0) {
          throw new Error(`terraform destroy failed with exit code ${result.status}`);
        }
        console.log('\n✅ Terraform resources destroyed successfully!');
      } catch (error) {
        throw error;
      }
    } else {
      console.log('ℹ️  No Terraform state found. Will only clean up orphaned resources.\n');
    }

    // Clean up orphaned resources
    const ec2Client = createEc2Client(awsConfig);
    
    if (resources.orphaned.instances.length > 0) {
      console.log('\n🧹 Cleaning up orphaned instances...');
      const activeInstances = resources.orphaned.instances.filter(
        inst => inst.State !== 'terminated' && inst.State !== 'shutting-down'
      );
      
      if (activeInstances.length > 0) {
        for (const instance of activeInstances) {
          try {
            const terminateCommand = new TerminateInstancesCommand({
              InstanceIds: [instance.InstanceId],
            });
            await ec2Client.send(terminateCommand);
            console.log(`   ✓ Terminated instance: ${instance.InstanceId}`);
          } catch (error) {
            console.warn(`   ⚠️  Could not terminate instance ${instance.InstanceId}: ${error.message}`);
          }
        }
      } else {
        console.log('   ℹ️  All orphaned instances are already terminated (will be automatically removed by AWS)');
      }
    }

    if (resources.orphaned.volumes.length > 0) {
      console.log('\n🧹 Cleaning up orphaned volumes...');
      const deletableVolumes = resources.orphaned.volumes.filter(
        vol => vol.State === 'available' && (!vol.Attachments || vol.Attachments.length === 0)
      );
      
      if (deletableVolumes.length > 0) {
        for (const volume of deletableVolumes) {
          try {
            const deleteCommand = new DeleteVolumeCommand({
              VolumeId: volume.VolumeId,
            });
            await ec2Client.send(deleteCommand);
            console.log(`   ✓ Deleted volume: ${volume.VolumeId} (${volume.Size}GB)`);
          } catch (error) {
            console.warn(`   ⚠️  Could not delete volume ${volume.VolumeId}: ${error.message}`);
          }
        }
      }
      
      // Report volumes that can't be deleted yet
      const attachedVolumes = resources.orphaned.volumes.filter(
        vol => vol.State !== 'available' || (vol.Attachments && vol.Attachments.length > 0)
      );
      
      if (attachedVolumes.length > 0) {
        console.log('\n   ⚠️  Some volumes are still attached or in-use:');
        for (const volume of attachedVolumes) {
          const attachmentInfo = volume.Attachments?.map(a => `instance ${a.InstanceId}`).join(', ') || 'unknown';
          console.log(`     - ${volume.VolumeId} (${volume.Size}GB, state: ${volume.State}, attached to: ${attachmentInfo})`);
        }
        console.log('   These will be cleaned up automatically when instances are terminated.');
      }
    }

    if (resources.orphaned.securityGroups.length > 0) {
      console.log('\n🧹 Cleaning up orphaned security groups...');
      for (const sg of resources.orphaned.securityGroups) {
        try {
          const deleteCommand = new DeleteSecurityGroupCommand({
            GroupId: sg.GroupId,
          });
          await ec2Client.send(deleteCommand);
          console.log(`   ✓ Deleted security group: ${sg.GroupId}`);
        } catch (error) {
          if (error.name === 'DependencyViolation') {
            console.warn(`   ⚠️  Security group ${sg.GroupId} still in use, will be cleaned up after instances terminate`);
          } else {
            console.warn(`   ⚠️  Could not delete security group ${sg.GroupId}: ${error.message}`);
          }
        }
      }
    }

    // Final summary
    console.log('\n✅ Cleanup complete!');
    console.log('\n📊 Summary:');
    console.log(`   - Terraform-managed resources: ${existsSync(terraformState) ? 'Destroyed' : 'None found'}`);
    console.log(`   - Orphaned instances cleaned: ${resources.orphaned.instances.filter(i => i.State !== 'terminated' && i.State !== 'shutting-down').length}`);
    console.log(`   - Orphaned volumes cleaned: ${resources.orphaned.volumes.filter(v => v.State === 'available' && (!v.Attachments || v.Attachments.length === 0)).length}`);
    console.log(`   - Orphaned security groups cleaned: ${resources.orphaned.securityGroups.length}`);
    console.log('\n   All AWS resources have been removed.\n');

  } catch (error) {
    console.error('\n❌ Error during cleanup:', error.message);
    process.exit(1);
  }
});

