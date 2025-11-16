#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EC2Client } from '@aws-sdk/client-ec2';
import { fromIni } from '@aws-sdk/credential-providers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const awsDir = join(__dirname, '..');
const credentialsFile = join(awsDir, 'aws-credentials.properties');
const exampleFile = join(awsDir, 'aws-credentials.properties.example');

/**
 * Parse properties file
 */
function parseProperties(content) {
  const props = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Skip comments and empty lines
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Parse key=value
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    
    const key = trimmed.substring(0, equalIndex).trim();
    const value = trimmed.substring(equalIndex + 1).trim();
    
    props[key] = value;
  }
  
  return props;
}

/**
 * Load AWS credentials from properties file
 */
export function loadAwsConfig() {
  let props = {};
  
  // Check if credentials file exists
  if (!existsSync(credentialsFile)) {
    console.error('❌ Error: AWS credentials file not found!');
    console.error(`   Please copy ${exampleFile} to ${credentialsFile} and configure it.`);
    console.error(`   Location: ${credentialsFile}`);
    process.exit(1);
  }
  
  try {
    const content = readFileSync(credentialsFile, 'utf-8');
    props = parseProperties(content);
  } catch (error) {
    console.error(`❌ Error reading AWS credentials file: ${error.message}`);
    process.exit(1);
  }
  
  // Get credentials with environment variable override support
  const getProperty = (key, defaultValue = undefined) => {
    // Check environment variable first (uppercase with dots replaced by underscores)
    const envKey = key.replace(/\./g, '_').toUpperCase();
    if (process.env[envKey] !== undefined) {
      return process.env[envKey];
    }
    // Return property value or default
    return props[key] !== undefined ? props[key] : defaultValue;
  };
  
  const config = {
    accessKeyId: getProperty('aws.access.key.id'),
    secretAccessKey: getProperty('aws.secret.access.key'),
    region: getProperty('aws.region', 'us-east-1'),
    profile: getProperty('aws.profile'),
    sshKeyPath: getProperty('aws.ssh.key.path'),
    postgresPassword: getProperty('postgres.password'),
  };
  
  // Validate required credentials
  if (config.profile) {
    // Using AWS profile, credentials will come from ~/.aws/credentials
    console.log(`✓ Using AWS profile: ${config.profile}`);
  } else {
    // Using access key/secret
    if (!config.accessKeyId || config.accessKeyId === 'YOUR_AWS_ACCESS_KEY_ID') {
      console.error('❌ Error: aws.access.key.id not configured in aws-credentials.properties');
      process.exit(1);
    }
    if (!config.secretAccessKey || config.secretAccessKey === 'YOUR_AWS_SECRET_ACCESS_KEY') {
      console.error('❌ Error: aws.secret.access.key not configured in aws-credentials.properties');
      process.exit(1);
    }
    console.log(`✓ AWS credentials loaded from ${credentialsFile}`);
  }
  
  return config;
}

/**
 * Set AWS credentials as environment variables (for Terraform/AWS CLI)
 */
export function setAwsEnvironment(config) {
  if (config.profile) {
    // Using AWS profile
    process.env.AWS_PROFILE = config.profile;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  } else {
    // Using access key/secret
    process.env.AWS_ACCESS_KEY_ID = config.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = config.secretAccessKey;
    delete process.env.AWS_PROFILE;
  }
  
  process.env.AWS_DEFAULT_REGION = config.region;
  process.env.AWS_REGION = config.region;
  
  return config;
}

/**
 * Create AWS SDK client with credentials from config
 * Supports both access key/secret and profile-based authentication
 */
export function createAwsClient(serviceClient, config) {
  const clientConfig = {
    region: config.region,
  };
  
  if (config.profile) {
    // Use AWS profile from ~/.aws/credentials
    clientConfig.credentials = fromIni({ profile: config.profile });
  } else {
    // Use access key and secret directly
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }
  
  return new serviceClient(clientConfig);
}

/**
 * Create EC2 client with credentials from config
 */
export function createEc2Client(config) {
  return createAwsClient(EC2Client, config);
}

