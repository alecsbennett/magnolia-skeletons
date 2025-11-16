#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { DescribeKeyPairsCommand, CreateKeyPairCommand } from '@aws-sdk/client-ec2';
import { createEc2Client } from './loadAwsConfig.mjs';

/**
 * Prompt user for yes/no confirmation
 */
function promptUser(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

/**
 * Check if key pair exists in AWS
 */
async function keyPairExists(keyPairName, ec2Client) {
  try {
    const command = new DescribeKeyPairsCommand({
      KeyNames: [keyPairName],
    });
    await ec2Client.send(command);
    return true;
  } catch (error) {
    // If error is InvalidKeyPair.NotFound, the key doesn't exist (expected)
    if (error.name === 'InvalidKeyPair.NotFound' || error.Code === 'InvalidKeyPair.NotFound') {
      return false;
    }
    // Other errors (permissions, network, etc.) should be thrown
    throw error;
  }
}

/**
 * Check if private key file exists locally
 */
function privateKeyExists(keyPairName) {
  const sshDir = join(homedir(), '.ssh');
  const keyPath = join(sshDir, `${keyPairName}.pem`);
  return existsSync(keyPath);
}

/**
 * Create SSH key pair in AWS and save private key locally
 */
async function createKeyPair(keyPairName, ec2Client, region) {
  console.log(`\n🔑 Creating SSH key pair: ${keyPairName}`);
  console.log(`   Region: ${region}`);
  
  try {
    // Create key pair in AWS using SDK
    const command = new CreateKeyPairCommand({
      KeyName: keyPairName,
    });
    
    const response = await ec2Client.send(command);
    
    if (!response.KeyMaterial) {
      throw new Error('Key pair created but no private key material returned');
    }
    
    const privateKey = response.KeyMaterial;
    
    // Ensure ~/.ssh directory exists
    const sshDir = join(homedir(), '.ssh');
    if (!existsSync(sshDir)) {
      mkdirSync(sshDir, { mode: 0o700 });
    }
    
    // Save private key to ~/.ssh/{keyPairName}.pem
    const keyPath = join(sshDir, `${keyPairName}.pem`);
    writeFileSync(keyPath, privateKey, { mode: 0o400 });
    
    // Set proper permissions (may fail on Windows, which is okay)
    try {
      execSync(`chmod 400 "${keyPath}"`, { stdio: 'ignore' });
    } catch (e) {
      // Ignore chmod errors on Windows
    }
    
    console.log(`✅ Key pair created successfully!`);
    console.log(`   Private key saved to: ${keyPath}`);
    console.log(`   Key permissions set to 400 (read-only for owner)`);
    
    return keyPath;
  } catch (error) {
    if (error.name === 'InvalidKeyPair.Duplicate' || error.Code === 'InvalidKeyPair.Duplicate') {
      throw new Error(`Key pair '${keyPairName}' already exists in AWS.`);
    }
    console.error(`❌ Error creating key pair: ${error.message}`);
    throw error;
  }
}

/**
 * Manage SSH key pair - check existence and create if needed with user prompt
 */
export async function ensureKeyPair(keyPairName, awsConfig) {
  if (!keyPairName) {
    console.error('❌ Error: key_pair_name not specified in terraform.tfvars');
    process.exit(1);
  }

  // Create EC2 client
  const ec2Client = createEc2Client(awsConfig);

  try {
    const existsInAws = await keyPairExists(keyPairName, ec2Client);
    const existsLocally = privateKeyExists(keyPairName);

    if (existsInAws && existsLocally) {
      console.log(`✅ SSH key pair '${keyPairName}' exists in AWS and locally`);
      return;
    }

    if (existsInAws && !existsLocally) {
      console.warn(`⚠️  Warning: Key pair '${keyPairName}' exists in AWS but private key not found locally.`);
      console.warn(`   Expected location: ~/.ssh/${keyPairName}.pem`);
      console.warn(`   You may need to download the private key from AWS or use an existing key file.`);
      
      const answer = await promptUser(`\n   Do you want to continue anyway? (y/n): `);
      if (answer !== 'y' && answer !== 'yes') {
        console.log('   Aborting...');
        process.exit(1);
      }
      return;
    }

    if (!existsInAws) {
      console.log(`\n🔍 SSH key pair '${keyPairName}' not found in AWS`);
      
      if (existsLocally) {
        console.warn(`   Warning: Private key file exists locally at ~/.ssh/${keyPairName}.pem`);
        console.warn(`   But the key pair doesn't exist in AWS.`);
        const answer = await promptUser(`\n   Do you want to create a new key pair in AWS? (y/n): `);
        if (answer !== 'y' && answer !== 'yes') {
          console.log('   Aborting...');
          process.exit(1);
        }
      } else {
        const answer = await promptUser(`   Do you want to create it now? (y/n): `);
        if (answer !== 'y' && answer !== 'yes') {
          console.log('   Aborting...');
          console.log('   Please create the key pair manually or update key_pair_name in terraform.tfvars');
          process.exit(1);
        }
      }

      await createKeyPair(keyPairName, ec2Client, awsConfig.region);
    }
  } catch (error) {
    // Re-throw if it's a known "not found" error (handled above)
    if (error.name === 'InvalidKeyPair.NotFound' || error.Code === 'InvalidKeyPair.NotFound') {
      // This shouldn't happen here since we check existsInAws first, but handle it gracefully
      console.log(`\n🔍 SSH key pair '${keyPairName}' not found in AWS`);
      const answer = await promptUser(`   Do you want to create it now? (y/n): `);
      if (answer === 'y' || answer === 'yes') {
        await createKeyPair(keyPairName, ec2Client, awsConfig.region);
      } else {
        console.log('   Aborting...');
        process.exit(1);
      }
      return;
    }
    // For other errors, log and throw
    console.error(`\n❌ Error managing SSH key pair: ${error.message}`);
    throw error;
  }
}

