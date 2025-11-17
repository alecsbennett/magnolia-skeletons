#!/usr/bin/env node

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper: parse boolean-like env vars
function envFlag(name, defaultValue = false) {
  const val = process.env[name];
  if (val == null) return defaultValue;
  const v = String(val).toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

const FLAGS = {
  skipPostgres: envFlag('DEPLOY_SKIP_POSTGRES', false),
  skipTomcat: envFlag('DEPLOY_SKIP_TOMCAT', false),
};

// Helper: parse boolean from terraform.tfvars
function parseTfVar(tfvarsContent, varName, defaultValue = false) {
  // Match: varName = value (with optional quotes, stops at # comment or newline)
  const regex = new RegExp(`${varName}\\s*=\\s*["']?([^"'\n#]+)["']?`);
  const match = tfvarsContent.match(regex);
  if (match) {
    const value = match[1].trim().toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
  }
  return defaultValue;
}

console.log('📦 Deploying Magnolia to AWS with Ansible...\n');

if (FLAGS.skipPostgres && FLAGS.skipTomcat) {
  console.error('❌ Error: Cannot skip both PostgreSQL and Tomcat setup!');
  process.exit(1);
}

const postgresScript = join(__dirname, 'deploy-postgres.mjs');
const tomcatScript = join(__dirname, 'deploy-tomcat.mjs');

// Function to run a script and return a promise
function runScript(scriptPath, name) {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting ${name}...\n`);
    const proc = spawn('node', [scriptPath], {
      stdio: 'inherit',
      shell: false
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${name} completed successfully\n`);
        resolve();
      } else {
        console.error(`\n❌ ${name} failed with exit code ${code}\n`);
        reject(new Error(`${name} failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      console.error(`\n❌ Error running ${name}:`, err.message);
      reject(err);
    });
  });
}

(async () => {
  try {
    const tasks = [];

    // Add PostgreSQL task if not skipped
    if (!FLAGS.skipPostgres) {
      tasks.push(runScript(postgresScript, 'PostgreSQL Setup'));
    } else {
      console.log('⏭️  Skipping PostgreSQL setup (DEPLOY_SKIP_POSTGRES=true)\n');
    }

    // Add Tomcat task if not skipped
    if (!FLAGS.skipTomcat) {
      tasks.push(runScript(tomcatScript, 'Tomcat/Magnolia Setup'));
    } else {
      console.log('⏭️  Skipping Tomcat setup (DEPLOY_SKIP_TOMCAT=true)\n');
    }

    // Run tasks in parallel
    if (tasks.length > 1) {
      console.log('🔄 Running setup tasks in parallel...\n');
      await Promise.all(tasks);
    } else {
      // Run single task sequentially
      await tasks[0];
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL DEPLOYMENTS COMPLETE!');
    console.log('='.repeat(60) + '\n');

    // Check if monitoring is enabled
    const terraformDir = join(__dirname, '..', 'terraform');
    const tfvarsPath = join(terraformDir, 'terraform.tfvars');
    
    if (existsSync(tfvarsPath)) {
      const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
      const monitor = parseTfVar(tfvarsContent, 'monitor', false);
      
      console.log(`\n🔍 Monitoring check: monitor=${monitor}\n`);
      
      if (monitor) {
        const monitorScript = join(__dirname, 'monitor-magnolia.mjs');
        console.log('🔍 Starting Magnolia startup monitoring...\n');
        
        // Run monitoring script in foreground and wait for completion
        await new Promise((resolve, reject) => {
          const monitorProc = spawn('node', [monitorScript], {
            stdio: 'inherit',
            shell: false
          });

          monitorProc.on('close', (code) => {
            if (code === 0) {
              console.log('\n✅ Monitoring completed\n');
              resolve();
            } else {
              console.log(`\n⚠️  Monitoring exited with code ${code}\n`);
              resolve(); // Don't fail deployment if monitoring has issues
            }
          });

          monitorProc.on('error', (err) => {
            console.error(`\n⚠️  Error running monitoring: ${err.message}\n`);
            resolve(); // Don't fail deployment if monitoring fails to start
          });
        });
      } else {
        console.log('   ⏭️  Monitoring disabled (monitor=false in terraform.tfvars)\n');
      }
    } else {
      console.log('   ⚠️  terraform.tfvars not found, skipping monitoring\n');
    }

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
})();
