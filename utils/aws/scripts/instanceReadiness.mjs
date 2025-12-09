#!/usr/bin/env node

import { execSync } from 'child_process';
import { EC2Client } from '@aws-sdk/client-ec2';
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { createEc2Client } from './loadAwsConfig.mjs';

/**
 * Check EC2 instance status via AWS SDK
 */
async function checkInstanceStatus(instanceId, ec2Client) {
  try {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });
    
    const response = await ec2Client.send(command);
    const instance = response.Reservations?.[0]?.Instances?.[0];
    
    if (!instance) {
      return { exists: false, state: null };
    }
    
    return {
      exists: true,
      state: instance.State?.Name, // pending, running, stopping, stopped, shutting-down, terminated
      stateCode: instance.State?.Code,
    };
  } catch (error) {
    if (error.name === 'InvalidInstanceID.NotFound') {
      return { exists: false, state: null };
    }
    throw error;
  }
}

/**
 * Check SSH connectivity to instance
 */
function checkSSHConnectivity(instanceIp, keyPath) {
  try {
    execSync(
      `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "echo 'ready'"`,
      { stdio: 'ignore', timeout: 5000 }
    );
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if cloud-init/user-data script has completed
 * Returns object with status details for better debugging
 */
function checkUserDataComplete(instanceIp, keyPath) {
  try {
    // Check cloud-init status (Amazon Linux 2023 uses cloud-init)
    const result = execSync(
      `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo cloud-init status 2>/dev/null || echo 'not-found'"`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    
    const status = result.trim();
    // cloud-init status returns: status: done, status: running, etc.
    const cloudInitDone = status.includes('done') || status.includes('complete');
    
    if (cloudInitDone) {
      // Check if installation marker exists
      try {
        // Determine if tomcat user exists by checking file ownership
        let useTomcatUser = false;
        try {
          const ownershipCheck = execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
            { encoding: 'utf-8', timeout: 5000 }
          ).trim();
          if (ownershipCheck === 'tomcat:tomcat') {
            useTomcatUser = true;
          }
        } catch (e) {
          useTomcatUser = false;
        }
        const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
        
        const markerCheck = execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/.installation-complete && echo 'exists' || echo 'missing'"`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        
        if (markerCheck === 'exists') {
          return true;
        }
        
        // If cloud-init is done but marker is missing, check if Tomcat is actually installed
        // This handles the case where the marker wasn't created but installation succeeded
        try {
          // Determine if tomcat user exists by checking file ownership
          let useTomcatUser = false;
          try {
            const ownershipCheck = execSync(
              `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
              { encoding: 'utf-8', timeout: 5000 }
            ).trim();
            if (ownershipCheck === 'tomcat:tomcat') {
              useTomcatUser = true;
            }
          } catch (e) {
            useTomcatUser = false;
          }
          const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
          
          const startupCheck = execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh && echo 'startup-yes' || echo 'startup-no'"`,
            { encoding: 'utf-8', timeout: 10000 }
          ).trim();
          
          const serviceCheck = execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "test -f /etc/systemd/system/tomcat.service && echo 'service-yes' || echo 'service-no'"`,
            { encoding: 'utf-8', timeout: 10000 }
          ).trim();
          
          const dirCheck = execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "sudo -u tomcat test -d /opt/tomcat && echo 'dir-yes' || echo 'dir-no'"`,
            { encoding: 'utf-8', timeout: 10000 }
          ).trim();
          
          if (startupCheck === 'startup-yes' && serviceCheck === 'service-yes' && dirCheck === 'dir-yes') {
            // Tomcat is fully installed but marker is missing - try to create it
            try {
              execSync(
                `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo touch /opt/tomcat/.installation-complete && sudo chown tomcat:tomcat /opt/tomcat/.installation-complete && echo 'INSTALLATION_COMPLETE=$(date)' | sudo tee /opt/tomcat/.installation-complete > /dev/null"`,
                { stdio: 'ignore', timeout: 10000 }
              );
            } catch (e) {
              // If we can't create marker, that's okay - we'll proceed anyway
            }
            // Tomcat is installed - consider it complete even if marker creation failed
            return true;
          }
        } catch (e) {
          // Can't verify Tomcat, so wait for marker
        }
        
        // Cloud-init done but marker missing and can't verify Tomcat - might still be installing
        return false;
      } catch (e) {
        // Can't check marker - assume not ready
        return false;
      }
    }
    
    return false;
  } catch (e) {
    // SSH or command execution failed
    return false;
  }
}

/**
 * Check if required services are running (for Magnolia instance)
 */
function checkServicesReady(instanceIp, keyPath, isPostgres = false) {
  try {
    if (isPostgres) {
      // Check PostgreSQL service
      execSync(
        `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo systemctl is-active --quiet postgresql"`,
        { stdio: 'ignore', timeout: 5000 }
      );
      return true;
    } else {
      // Comprehensive Tomcat installation check
      // Check each component individually to avoid timeout issues with long combined commands
      // Determine if tomcat user exists by checking file ownership - if files are owned by tomcat:tomcat, user exists
      try {
        // Check if /opt/tomcat exists and get its ownership to determine if tomcat user exists
        let useTomcatUser = false;
        try {
          const ownershipCheck = execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
            { encoding: 'utf-8', timeout: 5000 }
          ).trim();
          // If directory exists and is owned by tomcat:tomcat, user exists
          if (ownershipCheck === 'tomcat:tomcat') {
            useTomcatUser = true;
          }
        } catch (e) {
          // Directory doesn't exist or can't check, assume user doesn't exist yet
          useTomcatUser = false;
        }
        
        const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
        
        // Check startup script
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        // Check systemd service
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "test -f /etc/systemd/system/tomcat.service"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        // Check installation marker
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/.installation-complete"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        // Check Magnolia directories
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -d /opt/magnolia"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        // Check Java
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "java -version > /dev/null 2>&1"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        // Check Tomcat directories
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -d /opt/tomcat/conf && ${sudoPrefix} test -d /opt/tomcat/webapps"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        return true;
      } catch (e) {
        return false;
      }
    }
  } catch (e) {
    return false;
  }
}

/**
 * Get detailed installation status for debugging
 */
export function getInstallationStatus(instanceIp, keyPath, isPostgres = false) {
  try {
    if (isPostgres) {
      const status = execSync(
        `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo systemctl status postgresql --no-pager -l 2>&1 | head -20 || echo 'Service not found'"`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return status.trim();
    } else {
      const checks = {
        tomcatStartup: false,
        systemdService: false,
        installationMarker: false,
        magnoliaDirs: false,
        javaAvailable: false,
        tomcatDirs: false,
      };
      
      // Determine if tomcat user exists by checking file ownership
      let useTomcatUser = false;
      try {
        const ownershipCheck = execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        // If directory exists and is owned by tomcat:tomcat, user exists
        if (ownershipCheck === 'tomcat:tomcat') {
          useTomcatUser = true;
        }
      } catch (e) {
        useTomcatUser = false;
      }
      
      const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
      
      try {
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        checks.tomcatStartup = true;
      } catch (e) {}
      
      try {
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "test -f /etc/systemd/system/tomcat.service"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        checks.systemdService = true;
      } catch (e) {}
      
      try {
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/.installation-complete"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        checks.installationMarker = true;
      } catch (e) {}
      
      try {
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -d /opt/magnolia"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        checks.magnoliaDirs = true;
      } catch (e) {}
      
      try {
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "java -version > /dev/null 2>&1"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        checks.javaAvailable = true;
      } catch (e) {}
      
      try {
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -d /opt/tomcat/conf && ${sudoPrefix} test -d /opt/tomcat/webapps"`,
          { stdio: 'ignore', timeout: 5000 }
        );
        checks.tomcatDirs = true;
      } catch (e) {}
      
      // Get cloud-init status
      let cloudInitStatus = 'unknown';
      try {
        const cloudInit = execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo cloud-init status 2>/dev/null || echo 'not-found'"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        cloudInitStatus = cloudInit.trim();
      } catch (e) {}
      
      // Get last few lines of installation log
      let installLog = '';
      try {
        const log = execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo tail -20 /var/log/user-data-install.log 2>/dev/null || sudo tail -20 /var/log/cloud-init-output.log 2>/dev/null || echo 'No log found'"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        installLog = log.trim();
      } catch (e) {}
      
      return {
        checks,
        cloudInitStatus,
        installLog,
      };
    }
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Comprehensive instance readiness check
 * Checks: EC2 state, SSH connectivity, user-data completion, and services
 */
export async function waitForInstanceReady(instanceId, instanceIp, keyPath, awsConfig, options = {}) {
  const {
    maxWaitMinutes = 15,
    checkIntervalSeconds = 10,
    instanceType = 'magnolia', // 'magnolia' or 'postgres'
    skipServiceCheck = false,
  } = options;

  const ec2Client = createEc2Client(awsConfig);
  const maxAttempts = Math.floor((maxWaitMinutes * 60) / checkIntervalSeconds);
  let attempts = 0;
  const startTime = Date.now();

  const checks = {
    ec2Running: false,
    sshReady: false,
    userDataComplete: false,
    servicesReady: false,
  };

  // Track check start times for progress indication
  const checkStartTimes = {
    ec2Running: null,
    sshReady: null,
    userDataComplete: null,
    servicesReady: null,
  };

  while (attempts < maxAttempts) {
    attempts++;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    
    // Check 1: EC2 instance state
    if (!checks.ec2Running) {
      if (checkStartTimes.ec2Running === null) {
        checkStartTimes.ec2Running = Date.now();
        console.log(`\n   1️⃣  Checking EC2 instance state...`);
      }
      try {
        const status = await checkInstanceStatus(instanceId, ec2Client);
        if (status.exists && status.state === 'running') {
          checks.ec2Running = true;
          const checkTime = Math.floor((Date.now() - checkStartTimes.ec2Running) / 1000);
          console.log(`       ✓ EC2 instance is running (${checkTime}s)`);
        } else if (status.exists && status.state === 'pending') {
          process.stdout.write(`       ⏳ EC2 instance is ${status.state}... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
        } else if (status.exists && status.state !== 'running') {
          throw new Error(`Instance is in ${status.state} state, cannot proceed`);
        } else {
          process.stdout.write(`       ⏳ EC2 instance not found yet... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
        }
      } catch (error) {
        if (error.message.includes('state')) {
          throw error;
        }
        process.stdout.write(`       ⏳ Checking EC2 state... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
      }
    }

    // Check 2: SSH connectivity (only if EC2 is running)
    if (checks.ec2Running && !checks.sshReady) {
      if (checkStartTimes.sshReady === null) {
        checkStartTimes.sshReady = Date.now();
        console.log(`\n   2️⃣  Checking SSH connectivity...`);
      }
      if (checkSSHConnectivity(instanceIp, keyPath)) {
        checks.sshReady = true;
        const checkTime = Math.floor((Date.now() - checkStartTimes.sshReady) / 1000);
        console.log(`       ✓ SSH connectivity established (${checkTime}s)`);
      } else {
        process.stdout.write(`       ⏳ Waiting for SSH service... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
      }
    }

    // Check 3: User-data script completion (only if SSH is ready)
    if (checks.sshReady && !checks.userDataComplete) {
      if (checkStartTimes.userDataComplete === null) {
        checkStartTimes.userDataComplete = Date.now();
        console.log(`\n   3️⃣  Checking cloud-init and installation status...`);
      }

      // For PostgreSQL instances we only care that cloud-init has finished;
      // Tomcat-related markers and directories are irrelevant there.
      if (instanceType === 'postgres') {
        try {
          const cloudInitResult = execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo cloud-init status 2>/dev/null || echo 'not-found'"`,
            { encoding: 'utf-8', timeout: 5000 }
          );
          const cloudInitStatus = cloudInitResult.trim();

          if (attempts % 3 === 0) {
            console.log(`       📊 Status check (attempt ${attempts}):`);
            console.log(`          Cloud-init: ${cloudInitStatus}`);
            
            // If cloud-init shows error, check if PostgreSQL is installed and can be recovered
            if (cloudInitStatus.includes('error')) {
              console.log(`          ⚠️  Cloud-init shows error, checking PostgreSQL installation...`);
              try {
                // Check if PostgreSQL is installed
                const pgInstalled = execSync(
                  `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "rpm -q postgresql15-server > /dev/null 2>&1 && echo 'installed' || echo 'not-installed'"`,
                  { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
                ).trim();
                
                if (pgInstalled === 'installed') {
                  console.log(`          ℹ️  PostgreSQL is installed but initialization may have failed`);
                  // Check if data directory exists and is initialized
                  const dataDirCheck = execSync(
                    `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo test -f /var/lib/pgsql/data/postgresql.conf && echo 'initialized' || echo 'not-initialized'"`,
                    { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
                  ).trim();
                  
                  if (dataDirCheck === 'not-initialized') {
                    console.log(`          💡 Attempting to initialize PostgreSQL manually...`);
                    try {
                      // Try to initialize PostgreSQL
                      const initResult = execSync(
                        `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=30 ec2-user@${instanceIp} "sudo postgresql-setup --initdb 2>&1"`,
                        { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }
                      );
                      console.log(`          ✓ PostgreSQL initialization attempted`);
                      // Try to start PostgreSQL
                      execSync(
                        `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo systemctl enable postgresql && sudo systemctl start postgresql 2>&1"`,
                        { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
                      );
                    } catch (initError) {
                      console.log(`          ⚠️  Manual initialization failed: ${initError.message.substring(0, 60)}`);
                    }
                  } else {
                    console.log(`          ℹ️  PostgreSQL data directory exists, checking service...`);
                  }
                }
              } catch (e) {
                // Ignore recovery check errors
              }
            }
          }

          // Consider cloud-init complete if:
          // 1. Status shows done/complete, OR
          // 2. Status shows error but PostgreSQL is installed and service can start
          let cloudInitDone = cloudInitStatus.includes('done') || cloudInitStatus.includes('complete');
          
          if (!cloudInitDone && cloudInitStatus.includes('error')) {
            // Check if PostgreSQL service can start (indicates installation succeeded despite cloud-init error)
            try {
              const serviceCheck = execSync(
                `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo systemctl is-active postgresql > /dev/null 2>&1 && echo 'active' || echo 'inactive'"`,
                { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
              ).trim();
              
              if (serviceCheck === 'active') {
                cloudInitDone = true;
                console.log(`          ✓ PostgreSQL service is active despite cloud-init error - considering ready`);
              }
            } catch (e) {
              // Service check failed, continue waiting
            }
          }

          if (cloudInitDone) {
            checks.userDataComplete = true;
            const checkTime = Math.floor((Date.now() - checkStartTimes.userDataComplete) / 1000);
            console.log(`       ✓ Cloud-init completed for PostgreSQL instance (${checkTime}s)`);
          } else {
            process.stdout.write(
              `       ⏳ Waiting for PostgreSQL initialization... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`
            );
          }
        } catch (e) {
          process.stdout.write(
            `       ⏳ Waiting for PostgreSQL initialization... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`
          );
        }
      } else {
        // Magnolia / Tomcat path (full detailed status)
        // Every 3 attempts, show detailed status
        if (attempts % 3 === 0) {
          try {
            const cloudInitResult = execSync(
              `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo cloud-init status 2>/dev/null || echo 'not-found'"`,
              { encoding: 'utf-8', timeout: 5000 }
            );
            const cloudInitStatus = cloudInitResult.trim();
            
            // Determine if tomcat user exists by checking file ownership (shared for marker and status checks)
            // Use a more robust check: try stat, if it fails, fall back to checking if files exist with tomcat ownership
            let useTomcatUser = false;
            let ownershipResult = '';
            
            try {
              // Try stat command first
              const statRawResult = execSync(
                `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo stat -c '%U:%G' /opt/tomcat 2>/dev/null || echo 'not-found'"`,
                { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
              );
              ownershipResult = statRawResult.trim();
              
              // If stat returned 'not-found', directory might not exist yet - check if it exists
              if (ownershipResult === 'not-found') {
                // Debug: log that we're entering fallback logic
                console.log(`      [DEBUG] stat returned 'not-found', checking if directory exists...`);
                
                try {
                  const dirCheck = execSync(
                    `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo test -d /opt/tomcat && echo 'exists' || echo 'not-exists'"`,
                    { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
                  ).trim();
                  
                  console.log(`      [DEBUG] Directory check result: "${dirCheck}"`);
                  
                  if (dirCheck === 'not-exists') {
                    ownershipResult = 'dir-not-exists';
                    console.log(`      [DEBUG] Directory does not exist yet`);
                  } else {
                    // Directory exists but stat failed - try alternative method using ls
                    console.log(`      [DEBUG] Directory exists but stat failed, trying ls fallback...`);
                    try {
                      const lsOutput = execSync(
                        `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo ls -ld /opt/tomcat 2>/dev/null || echo 'ls-failed'"`,
                        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
                      ).trim();
                      
                      console.log(`      [DEBUG] ls output: "${lsOutput.substring(0, 80)}"`);
                      
                      if (lsOutput && lsOutput !== 'ls-failed') {
                        // Parse owner:group from ls -ld output (format: drwxr-xr-x. 9 tomcat tomcat ...)
                        const parts = lsOutput.split(/\s+/);
                        console.log(`      [DEBUG] Parsed parts: [${parts.slice(0, 5).join(', ')}...]`);
                        
                        if (parts.length >= 4 && parts[2] === 'tomcat' && parts[3] === 'tomcat') {
                          ownershipResult = 'tomcat:tomcat';
                          console.log(`      [DEBUG] ✅ Successfully detected tomcat:tomcat via ls fallback!`);
                        } else if (parts.length >= 4) {
                          ownershipResult = `${parts[2]}:${parts[3]}`;
                          console.log(`      [DEBUG] Detected ownership: ${ownershipResult}`);
                        } else {
                          ownershipResult = `stat-failed:${lsOutput.substring(0, 30)}`;
                          console.log(`      [DEBUG] ⚠️  Could not parse ownership from ls output`);
                        }
                      } else {
                        ownershipResult = 'stat-and-ls-failed';
                        console.log(`      [DEBUG] ❌ ls command also failed`);
                      }
                    } catch (e) {
                      ownershipResult = 'stat-and-ls-failed';
                      console.log(`      [DEBUG] ❌ ls fallback exception: ${e.message.substring(0, 50)}`);
                    }
                  }
                } catch (e) {
                  ownershipResult = 'dir-check-failed';
                  console.log(`      [DEBUG] ❌ Directory check exception: ${e.message.substring(0, 50)}`);
                }
              }
              
              // Check if ownership indicates tomcat user
              if (ownershipResult === 'tomcat:tomcat') {
                useTomcatUser = true;
              }
            } catch (e) {
              ownershipResult = `error: ${e.message.substring(0, 30)}`;
              useTomcatUser = false;
            }
            
            const sudoPrefix = useTomcatUser ? 'sudo -u tomcat' : 'sudo';
            
            // Check installation marker
            let markerCheck = 'missing';
            try {
              markerCheck = execSync(
                `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/.installation-complete && echo 'present' || echo 'missing'"`,
                { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
              ).trim();
            } catch (e) {
              markerCheck = 'missing';
            }
            
            // Also check if Tomcat is actually installed (even if marker is missing)
            // Reuse the ownership check and sudoPrefix from above
            let tomcatInstalled = 'unknown';
            let tomcatDetails = '';
            let debugInfo = `[ownership:${ownershipResult}, sudo:${sudoPrefix}]`;
            try {
              // Check each component individually with proper error handling
              let startupCheck = 'startup-no';
              let serviceCheck = 'service-no';
              let dirCheck = 'dir-no';
              let startupError = '';
              let serviceError = '';
              let dirError = '';
              
              try {
                startupCheck = execSync(
                  `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -f /opt/tomcat/bin/startup.sh && echo 'startup-yes' || echo 'startup-no'"`,
                  { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
                ).trim();
              } catch (e) {
                startupCheck = 'startup-no';
                startupError = e.message.substring(0, 50);
              }
              
              try {
                serviceCheck = execSync(
                  `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "test -f /etc/systemd/system/tomcat.service && echo 'service-yes' || echo 'service-no'"`,
                  { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
                ).trim();
              } catch (e) {
                serviceCheck = 'service-no';
                serviceError = e.message.substring(0, 50);
              }
              
              try {
                dirCheck = execSync(
                  `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "${sudoPrefix} test -d /opt/tomcat && echo 'dir-yes' || echo 'dir-no'"`,
                  { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
                ).trim();
              } catch (e) {
                dirCheck = 'dir-no';
                dirError = e.message.substring(0, 50);
              }
              
              const hasStartup = startupCheck === 'startup-yes';
              const hasService = serviceCheck === 'service-yes';
              const hasDir = dirCheck === 'dir-yes';
              
              if (hasStartup && hasService && hasDir) {
                tomcatInstalled = '✓ Installed';
                tomcatDetails = ' (startup.sh, service, dir all present)';
              } else {
                tomcatInstalled = '✗ Partially installed';
                const missing = [];
                if (!hasStartup) {
                  missing.push(`startup.sh(${startupCheck}${startupError ? ':' + startupError : ''})`);
                }
                if (!hasService) {
                  missing.push(`service(${serviceCheck}${serviceError ? ':' + serviceError : ''})`);
                }
                if (!hasDir) {
                  missing.push(`dir(${dirCheck}${dirError ? ':' + dirError : ''})`);
                }
                tomcatDetails = ` (missing: ${missing.join(', ')}) ${debugInfo}`;
              }
            } catch (e) {
              tomcatInstalled = `? Check failed: ${e.message.substring(0, 40)}`;
              tomcatDetails = ` ${debugInfo}`;
            }
            
            console.log(`       📊 Status check (attempt ${attempts}):`);
            console.log(`          Cloud-init: ${cloudInitStatus}`);
            console.log(`          Installation marker: ${markerCheck === 'present' ? '✓ Present' : '✗ Missing'}`);
            console.log(`          Tomcat installed: ${tomcatInstalled}${tomcatDetails}`);
            
            // If cloud-init is done and Tomcat is installed but marker is missing, try to create it
            if (cloudInitStatus.includes('done') && tomcatInstalled.includes('✓') && markerCheck === 'missing') {
              console.log(`          ⚠️  Cloud-init done and Tomcat installed, but marker missing!`);
              console.log(`          💡 Attempting to create missing marker file...`);
              try {
                const createMarker = execSync(
                  `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ec2-user@${instanceIp} "sudo touch /opt/tomcat/.installation-complete && sudo chown tomcat:tomcat /opt/tomcat/.installation-complete && echo 'INSTALLATION_COMPLETE=$(date)' | sudo tee /opt/tomcat/.installation-complete > /dev/null && echo 'created' || echo 'failed'"`,
                  { encoding: 'utf-8', timeout: 10000 }
                ).trim();
                
                if (createMarker === 'created') {
                  console.log(`          ✓ Marker file created successfully!`);
                  // Re-check marker
                  const newMarkerCheck = execSync(
                    `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ec2-user@${instanceIp} "test -f /opt/tomcat/.installation-complete && echo 'present' || echo 'missing'"`,
                    { encoding: 'utf-8', timeout: 10000 }
                  ).trim();
                  if (newMarkerCheck === 'present') {
                    console.log(`          ✓ Marker verified - proceeding!`);
                  }
                } else {
                  console.log(`          ✗ Failed to create marker: ${createMarker}`);
                }
              } catch (e) {
                console.log(`          ✗ Error creating marker: ${e.message.substring(0, 50)}`);
              }
            }
            
            // Show recent log activity if available
            try {
              const logCheck = execSync(
                `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes ec2-user@${instanceIp} "sudo tail -3 /var/log/user-data-install.log 2>/dev/null | tail -1 || echo ''"`,
                { encoding: 'utf-8', timeout: 5000 }
              ).trim();
              if (logCheck) {
                console.log(`          Last log: ${logCheck.substring(0, 60)}...`);
              }
            } catch (e) {
              // Ignore log check errors
            }
          } catch (e) {
            // If we can't get status, just continue
          }
        }
        
        if (checkUserDataComplete(instanceIp, keyPath)) {
          checks.userDataComplete = true;
          const checkTime = Math.floor((Date.now() - checkStartTimes.userDataComplete) / 1000);
          console.log(`       ✓ Cloud-init completed and installation marker found (${checkTime}s)`);
        } else {
          process.stdout.write(`       ⏳ Waiting for initialization to complete... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
        }
      }
    }

    // Check 4: Services ready (only if user-data is complete)
    if (checks.userDataComplete && !skipServiceCheck && !checks.servicesReady) {
      if (checkStartTimes.servicesReady === null) {
        checkStartTimes.servicesReady = Date.now();
        if (instanceType === 'magnolia') {
          console.log(`\n   4️⃣  Verifying Tomcat installation and services...`);
          console.log(`       Checking: startup.sh, systemd service, installation marker, Java, directories`);
        } else {
          console.log(`\n   4️⃣  Verifying PostgreSQL service...`);
        }
      }
      
      // Every 2 attempts, show what's missing
      if (attempts % 2 === 0 && instanceType === 'magnolia') {
        try {
          const status = getInstallationStatus(instanceIp, keyPath, false);
          if (status && typeof status === 'object' && !status.error) {
            const missing = [];
            if (!status.checks.tomcatStartup) missing.push('startup.sh');
            if (!status.checks.systemdService) missing.push('systemd service');
            if (!status.checks.installationMarker) missing.push('installation marker');
            if (!status.checks.magnoliaDirs) missing.push('magnolia dirs');
            if (!status.checks.javaAvailable) missing.push('Java');
            if (!status.checks.tomcatDirs) missing.push('tomcat dirs');
            
            if (missing.length > 0) {
              console.log(`       ⚠️  Still missing: ${missing.join(', ')}`);
            }
          }
        } catch (e) {
          // Ignore errors getting status
        }
      }
      
      if (checkServicesReady(instanceIp, keyPath, instanceType === 'postgres')) {
        checks.servicesReady = true;
        const checkTime = Math.floor((Date.now() - checkStartTimes.servicesReady) / 1000);
        if (instanceType === 'magnolia') {
          console.log(`       ✓ All Tomcat components verified (${checkTime}s)`);
        } else {
          console.log(`       ✓ PostgreSQL service is running (${checkTime}s)`);
        }
      } else {
        if (instanceType === 'magnolia') {
          process.stdout.write(`       ⏳ Verifying Tomcat installation... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
        } else {
          process.stdout.write(`       ⏳ Waiting for PostgreSQL service... [${elapsedStr}] (attempt ${attempts}/${maxAttempts})\r`);
        }
      }
    }

    // All checks passed
    if (checks.ec2Running && checks.sshReady && checks.userDataComplete && (skipServiceCheck || checks.servicesReady)) {
      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      console.log(`\n   ✅ All readiness checks passed! (Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s)`);
      console.log(`\n   Summary:`);
      console.log(`   ┌─ EC2 Instance: ✓ Running`);
      console.log(`   ├─ SSH Connectivity: ✓ Ready`);
      console.log(`   ├─ Cloud-init: ✓ Complete`);
      console.log(`   └─ Services: ✓ Ready`);
      console.log('');
      return true;
    }

    // Wait before next check
    if (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, checkIntervalSeconds * 1000));
    }
  }

  // Timeout - show what checks passed and detailed status
  console.log(`\n\n⚠️  Timeout waiting for instance to be ready`);
  console.log(`   Total wait time: ${Math.floor((Date.now() - startTime) / 60)}m ${Math.floor((Date.now() - startTime) % 60)}s`);
  console.log(`   Total attempts: ${attempts}/${maxAttempts}`);
  console.log(`\n   Check Results:`);
  console.log(`   ┌─ EC2 Running: ${checks.ec2Running ? '✓' : '✗'}`);
  console.log(`   ├─ SSH Ready: ${checks.sshReady ? '✓' : '✗'}`);
  console.log(`   ├─ User-data Complete: ${checks.userDataComplete ? '✓' : '✗'}`);
  if (!skipServiceCheck) {
    console.log(`   └─ Services Ready: ${checks.servicesReady ? '✓' : '✗'}`);
  } else {
    console.log(`   └─ Services Ready: (skipped)`);
  }
  
  // Show detailed installation status if SSH is ready
  if (checks.sshReady) {
    console.log(`\n   📊 Current Installation Status:`);
    try {
      const status = getInstallationStatus(instanceIp, keyPath, instanceType === 'postgres');
      if (instanceType === 'magnolia' && status && typeof status === 'object' && !status.error) {
        console.log(`   ┌─ Cloud-init: ${status.cloudInitStatus}`);
        console.log(`   ├─ Tomcat startup.sh: ${status.checks.tomcatStartup ? '✓ Present' : '✗ Missing'}`);
        console.log(`   ├─ Systemd service: ${status.checks.systemdService ? '✓ Present' : '✗ Missing'}`);
        console.log(`   ├─ Installation marker: ${status.checks.installationMarker ? '✓ Present' : '✗ Missing'}`);
        console.log(`   ├─ Magnolia directories: ${status.checks.magnoliaDirs ? '✓ Present' : '✗ Missing'}`);
        console.log(`   ├─ Java available: ${status.checks.javaAvailable ? '✓ Available' : '✗ Not available'}`);
        console.log(`   └─ Tomcat directories: ${status.checks.tomcatDirs ? '✓ Present' : '✗ Missing'}`);
        
        if (status.installLog) {
          console.log(`\n   📝 Recent Installation Log (last 10 lines):`);
          const logLines = status.installLog.split('\n').filter(l => l.trim()).slice(-10);
          logLines.forEach(line => console.log(`      ${line}`));
        }
      } else if (instanceType === 'postgres' && status) {
        console.log(`   PostgreSQL Status:`);
        console.log(`   ${status.substring(0, 200)}...`);
      }
    } catch (e) {
      console.log(`   ⚠️  Could not retrieve detailed status: ${e.message}`);
    }
  }
  
  console.log(`\n   💡 Troubleshooting:`);
  if (!checks.sshReady) {
    console.log(`   - SSH is not ready. Check security groups and instance state.`);
  } else if (!checks.userDataComplete) {
    console.log(`   - Cloud-init may still be running. Check logs:`);
    console.log(`     ssh -i "${keyPath}" ec2-user@${instanceIp}`);
    console.log(`     sudo tail -50 /var/log/cloud-init-output.log`);
    console.log(`     sudo tail -50 /var/log/user-data-install.log`);
  } else if (!checks.servicesReady) {
    console.log(`   - Installation may have failed. Check logs:`);
    console.log(`     ssh -i "${keyPath}" ec2-user@${instanceIp}`);
    console.log(`     sudo tail -50 /var/log/user-data-install.log`);
    console.log(`     sudo cloud-init status`);
  }
  
  return false;
}

