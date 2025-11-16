#!/usr/bin/env node

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { loadAwsConfig, setAwsEnvironment } from '../loadAwsConfig.mjs';
import { waitForInstanceReady } from '../instanceReadiness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

(async () => {
  try {
    const awsConfig = loadAwsConfig();
    setAwsEnvironment(awsConfig);

    const output = execSync('terraform output -json', {
      cwd: terraformDir,
      encoding: 'utf-8',
    });

    const outputs = JSON.parse(output);
    const instanceIp = outputs.instance_public_ip?.value;
    const instanceId = outputs.instance_id?.value;
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];

    if (!instanceIp || !instanceId || !keyPairName) {
      console.error('❌ Could not get instance info from Terraform outputs');
      process.exit(1);
    }

    const awsKeyPath =
      awsConfig.sshKeyPath || process.env.AWS_KEY_PATH || `~/.ssh/${keyPairName}.pem`;
    const expandedKeyPath = awsKeyPath.replace(
      /^~/,
      process.env.HOME || process.env.USERPROFILE || '~'
    );

    console.log('🔍 Running waitForInstanceReady for Magnolia instance only\n');
    console.log(`Instance ID: ${instanceId}`);
    console.log(`Instance IP: ${instanceIp}`);
    console.log(`Key path   : ${expandedKeyPath}\n`);

    const ok = await waitForInstanceReady(instanceId, instanceIp, expandedKeyPath, awsConfig, {
      maxWaitMinutes: 5,
      checkIntervalSeconds: 10,
      instanceType: 'magnolia',
      skipServiceCheck: false,
    });

    console.log('\n========================================');
    console.log(`waitForInstanceReady result: ${ok ? '✅ READY' : '❌ NOT READY'}`);
    console.log('========================================');
  } catch (err) {
    console.error('\n❌ Error running testWaitMagnolia.mjs:', err.message);
    if (err.stderr) {
      console.error('stderr:', err.stderr.toString());
    }
    process.exit(1);
  }
})();


