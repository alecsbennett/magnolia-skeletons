#!/usr/bin/env node

import { EC2Client } from '@aws-sdk/client-ec2';
import { DescribeInstancesCommand, DescribeSecurityGroupsCommand, DescribeVolumesCommand, DescribeKeyPairsCommand } from '@aws-sdk/client-ec2';
import { createEc2Client } from './loadAwsConfig.mjs';

/**
 * Find all EC2 instances with our tags or name pattern
 */
export async function findTaggedInstances(awsConfig, projectName) {
  const ec2Client = createEc2Client(awsConfig);
  const instances = [];
  
  try {
    const command = new DescribeInstancesCommand({});
    const response = await ec2Client.send(command);
    
    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        // Check if instance has our tags
        const tags = instance.Tags || [];
        const hasManagedByTag = tags.some(t => t.Key === 'ManagedBy' && t.Value === 'Terraform');
        const hasProjectTag = tags.some(t => t.Key === 'Project' && t.Value === projectName);
        const hasRepoTag = tags.some(t => t.Key === 'TerraformRepo' && t.Value === 'MagnoliaSkeletons');
        const nameTag = tags.find(t => t.Key === 'Name');
        const matchesNamePattern = nameTag && (
          nameTag.Value === projectName || 
          nameTag.Value === `${projectName}-postgres` ||
          nameTag.Value?.includes(projectName)
        );
        
        if ((hasManagedByTag && (hasProjectTag || hasRepoTag)) || matchesNamePattern) {
          instances.push({
            InstanceId: instance.InstanceId,
            State: instance.State?.Name,
            Tags: tags,
            PublicIp: instance.PublicIpAddress,
            PrivateIp: instance.PrivateIpAddress,
            Name: nameTag?.Value,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error finding instances: ${error.message}`);
  }
  
  return instances;
}

/**
 * Find all security groups with our tags or name pattern
 */
export async function findTaggedSecurityGroups(awsConfig, projectName) {
  const ec2Client = createEc2Client(awsConfig);
  const securityGroups = [];
  
  try {
    const command = new DescribeSecurityGroupsCommand({});
    const response = await ec2Client.send(command);
    
    for (const sg of response.SecurityGroups || []) {
      const tags = sg.Tags || [];
      const hasManagedByTag = tags.some(t => t.Key === 'ManagedBy' && t.Value === 'Terraform');
      const hasProjectTag = tags.some(t => t.Key === 'Project' && t.Value === projectName);
      const hasRepoTag = tags.some(t => t.Key === 'TerraformRepo' && t.Value === 'MagnoliaSkeletons');
      const nameTag = tags.find(t => t.Key === 'Name');
      const matchesNamePattern = sg.GroupName && (
        sg.GroupName === `${projectName}-sg` ||
        sg.GroupName === `${projectName}-postgres-sg` ||
        sg.GroupName?.includes(projectName)
      );
      
      if ((hasManagedByTag && (hasProjectTag || hasRepoTag)) || matchesNamePattern) {
        securityGroups.push({
          GroupId: sg.GroupId,
          GroupName: sg.GroupName,
          Description: sg.Description,
          Tags: tags,
        });
      }
    }
  } catch (error) {
    console.error(`Error finding security groups: ${error.message}`);
  }
  
  return securityGroups;
}

/**
 * Find all EBS volumes with our tags or name pattern
 */
export async function findTaggedVolumes(awsConfig, projectName) {
  const ec2Client = createEc2Client(awsConfig);
  const volumes = [];
  
  try {
    const command = new DescribeVolumesCommand({});
    const response = await ec2Client.send(command);
    
    for (const volume of response.Volumes || []) {
      const tags = volume.Tags || [];
      const hasManagedByTag = tags.some(t => t.Key === 'ManagedBy' && t.Value === 'Terraform');
      const hasProjectTag = tags.some(t => t.Key === 'Project' && t.Value === projectName);
      const hasRepoTag = tags.some(t => t.Key === 'TerraformRepo' && t.Value === 'MagnoliaSkeletons');
      const nameTag = tags.find(t => t.Key === 'Name');
      const matchesNamePattern = nameTag && (
        nameTag.Value === `${projectName}-postgres-data` ||
        nameTag.Value === `${projectName}-root-volume` ||
        nameTag.Value === `${projectName}-postgres-root-volume` ||
        nameTag.Value?.includes(projectName)
      );
      
      if ((hasManagedByTag && (hasProjectTag || hasRepoTag)) || matchesNamePattern) {
        volumes.push({
          VolumeId: volume.VolumeId,
          Size: volume.Size,
          State: volume.State,
          Attachments: volume.Attachments,
          Tags: tags,
          Name: nameTag?.Value,
        });
      }
    }
  } catch (error) {
    console.error(`Error finding volumes: ${error.message}`);
  }
  
  return volumes;
}

/**
 * Check for orphaned resources (resources with our tags but not in Terraform state)
 */
export async function checkForOrphanedResources(awsConfig, projectName, terraformResources) {
  console.log('\n🔍 Checking for orphaned resources in AWS...\n');
  
  const instances = await findTaggedInstances(awsConfig, projectName);
  const securityGroups = await findTaggedSecurityGroups(awsConfig, projectName);
  const volumes = await findTaggedVolumes(awsConfig, projectName);
  
  const orphaned = {
    instances: [],
    securityGroups: [],
    volumes: [],
  };
  
  // Check instances
  for (const instance of instances) {
    if (!terraformResources.instances.includes(instance.InstanceId)) {
      orphaned.instances.push(instance);
    }
  }
  
  // Check security groups
  for (const sg of securityGroups) {
    if (!terraformResources.securityGroups.includes(sg.GroupId)) {
      orphaned.securityGroups.push(sg);
    }
  }
  
  // Check volumes
  for (const volume of volumes) {
    if (!terraformResources.volumes.includes(volume.VolumeId)) {
      orphaned.volumes.push(volume);
    }
  }
  
  return {
    all: { instances, securityGroups, volumes },
    orphaned,
  };
}

