#!/usr/bin/env node

import { loadAwsConfig, setAwsEnvironment } from '../loadAwsConfig.mjs';
import { findTaggedInstances, findTaggedSecurityGroups, findTaggedVolumes } from '../resourceChecker.mjs';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

// Load AWS config
const awsConfig = loadAwsConfig();
setAwsEnvironment(awsConfig);

// Get project name
let projectName = 'magnolia-author';
try {
  const tfvarsPath = join(terraformDir, 'terraform.tfvars');
  if (existsSync(tfvarsPath)) {
    const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
    const projectMatch = tfvarsContent.match(/project_name\s*=\s*["']?([^"'\s]+)["']?/);
    if (projectMatch) {
      projectName = projectMatch[1];
    }
  }
} catch (error) {
  // Use default
}

console.log('🔍 Checking AWS for resources tagged with TerraformRepo=MagnoliaSkeletons...\n');
console.log(`Project name: ${projectName}\n`);

(async () => {
  try {
    const instances = await findTaggedInstances(awsConfig, projectName);
    const securityGroups = await findTaggedSecurityGroups(awsConfig, projectName);
    const volumes = await findTaggedVolumes(awsConfig, projectName);

    console.log('📊 Found Resources:\n');

    if (instances.length > 0) {
      console.log(`EC2 Instances (${instances.length}):`);
      instances.forEach(inst => {
        console.log(`  - ${inst.InstanceId}`);
        console.log(`    State: ${inst.State}`);
        console.log(`    Public IP: ${inst.PublicIp || 'N/A'}`);
        console.log(`    Private IP: ${inst.PrivateIp || 'N/A'}`);
      });
      console.log('');
    } else {
      console.log('EC2 Instances: None found\n');
    }

    if (securityGroups.length > 0) {
      console.log(`Security Groups (${securityGroups.length}):`);
      securityGroups.forEach(sg => {
        console.log(`  - ${sg.GroupId} (${sg.GroupName})`);
        console.log(`    Description: ${sg.Description}`);
      });
      console.log('');
    } else {
      console.log('Security Groups: None found\n');
    }

    if (volumes.length > 0) {
      console.log(`EBS Volumes (${volumes.length}):`);
      volumes.forEach(vol => {
        console.log(`  - ${vol.VolumeId}`);
        console.log(`    Size: ${vol.Size}GB`);
        console.log(`    State: ${vol.State}`);
        console.log(`    Attached to: ${vol.Attachments?.map(a => a.InstanceId).join(', ') || 'None'}`);
      });
      console.log('');
    } else {
      console.log('EBS Volumes: None found\n');
    }

    const totalResources = instances.length + securityGroups.length + volumes.length;
    console.log(`Total resources found: ${totalResources}`);

  } catch (error) {
    console.error(`\n❌ Error checking resources: ${error.message}`);
    process.exit(1);
  }
})();

