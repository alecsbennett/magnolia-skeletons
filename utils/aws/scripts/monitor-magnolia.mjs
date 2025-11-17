#!/usr/bin/env node

import { execSync, exec, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadAwsConfig } from './loadAwsConfig.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve path to Magnolia logo (relative to project root)
const MAGNOLIA_LOGO_PATH = resolve(__dirname, '../../exec/assets/magnolia-logo.png');

const terraformDir = join(__dirname, '..', 'terraform');

// Helper: parse boolean from terraform.tfvars
function parseTfVar(tfvarsContent, varName, defaultValue = false) {
  // Match: varName = value (with optional quotes, stops at # comment or newline)
  // Escape special regex characters in varName (though underscores don't need escaping)
  const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedVarName}\\s*=\\s*["']?([^"'\n#]+)["']?`, 'i');
  const match = tfvarsContent.match(regex);
  if (match) {
    const value = match[1].trim().toLowerCase();
    const result = value === 'true' || value === '1' || value === 'yes';
    // Debug logging (can be removed later)
    console.log(`   Parsed ${varName}: "${value}" -> ${result}`);
    return result;
  }
  console.log(`   ${varName} not found in tfvars, using default: ${defaultValue}`);
  return defaultValue;
}

// Get Terraform outputs
function getTerraformOutputs() {
  const output = execSync('terraform output -json', {
    cwd: terraformDir,
    encoding: 'utf-8',
  });
  return JSON.parse(output);
}

// Show toast notification (cross-platform)
async function showToastNotification(title, message, url = null) {
  const platform = process.platform;
  
  // Try using node-notifier if available (dynamic import for ES modules)
  // This is the preferred method as it works reliably across platforms
  try {
    const notifier = await import('node-notifier');
    const notificationOptions = {
      title: title,
      message: message,
      sound: true,
      wait: false,
      timeout: 30,
      appID: 'Magnolia AWS Deployment',
    };

    // Add icon if logo file exists
    if (existsSync(MAGNOLIA_LOGO_PATH)) {
      notificationOptions.icon = MAGNOLIA_LOGO_PATH;
    }

    // Show notification with click handler
    return new Promise((resolve, reject) => {
      notifier.default.notify(notificationOptions, (err, response, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        // Handle notification click - open browser if URL provided
        if (url && (response === 'activate' || response === 'clicked' || response === undefined)) {
          // undefined response on Windows often means the notification was clicked
          openBrowser(url).catch(() => {
            // Ignore browser open errors, notification was shown
          });
        }
        resolve();
      });
    });
  } catch (e) {
    // Fallback to platform-specific commands if node-notifier is not available
    console.log(`   ⚠️  node-notifier not available, using platform fallback...`);
  }

  // Platform-specific fallbacks (only used if node-notifier fails)
  if (platform === 'win32') {
    // Windows toast notification using PowerShell
    // Use a here-string approach to avoid quoting issues
    try {
      // Remove emojis and special chars that cause PowerShell issues
      const cleanTitle = title.replace(/[^\x20-\x7E\n]/g, '').trim() || 'Magnolia CMS Started';
      const cleanMessage = message.replace(/[^\x20-\x7E\n]/g, '').trim() || 'Server is ready';
      
      // Use a PowerShell script file approach or properly escaped command
      const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($template.CreateTextNode('${cleanTitle.replace(/'/g, "''")}')) | Out-Null
$textNodes.Item(1).AppendChild($template.CreateTextNode('${cleanMessage.replace(/'/g, "''")}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Magnolia Deployment").Show($toast)
`.trim();
      
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '`"').replace(/\$/g, '`$').replace(/\n/g, '; ')}"`, { 
        stdio: 'pipe', 
        timeout: 5000 
      });
    } catch (e) {
      console.log(`\n🔔 ${title}: ${message}\n`);
      throw e;
    }
  } else if (platform === 'darwin') {
    // macOS notification
    try {
      const escapedMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      const escapedTitle = title.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      execSync(`osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`, { stdio: 'ignore' });
    } catch (e) {
      console.log(`\n🔔 ${title}: ${message}\n`);
      throw e;
    }
  } else {
    // Linux notification
    try {
      const escapedMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      const escapedTitle = title.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      execSync(`notify-send "${escapedTitle}" "${escapedMessage}"`, { stdio: 'ignore' });
    } catch (e) {
      console.log(`\n🔔 ${title}: ${message}\n`);
      throw e;
    }
  }
}

// Open browser (cross-platform)
async function openBrowser(url) {
  const platform = process.platform;
  
  // Try using 'open' package if available (dynamic import for ES modules)
  // This is the preferred method as it works reliably across platforms
  try {
    const open = await import('open');
    await open.default(url);
    return;
  } catch (e) {
    // Fallback to platform-specific commands
  }

  // Platform-specific fallbacks
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      // Windows - use start command with empty title to avoid prompt window
      // The empty string after start prevents it from opening a new command window
      exec(`start "" "${url}"`, { 
        stdio: 'ignore',
        shell: true 
      }, (error) => {
        if (error) {
          console.log(`\n🌐 Please open your browser and navigate to: ${url}\n`);
          reject(error);
        } else {
          resolve();
        }
      });
    } else if (platform === 'darwin') {
      // macOS - use open command
      exec(`open "${url}"`, { stdio: 'ignore' }, (error) => {
        if (error) {
          console.log(`\n🌐 Please open your browser and navigate to: ${url}\n`);
          reject(error);
        } else {
          resolve();
        }
      });
    } else {
      // Linux/Unix - use xdg-open
      exec(`xdg-open "${url}"`, { stdio: 'ignore' }, (error) => {
        if (error) {
          console.log(`\n🌐 Please open your browser and navigate to: ${url}\n`);
          reject(error);
        } else {
          resolve();
        }
      });
    }
  });
}

// Monitor remote logs for startup completion
async function monitorMagnoliaStartup(options) {
  const { instanceIp, sshKeyPath, magnoliaUrl, showToast, openBrowser: shouldOpenBrowser, maxWaitTime = 600000 } = options;

  console.log('\n🔍 Monitoring Magnolia startup...');
  console.log(`   Instance: ${instanceIp}`);
  console.log(`   URL: ${magnoliaUrl}`);
  console.log(`   Max wait time: ${Math.floor(maxWaitTime / 1000)}s`);
  console.log(`   Debug - showToast: ${showToast} (type: ${typeof showToast}), shouldOpenBrowser: ${shouldOpenBrowser} (type: ${typeof shouldOpenBrowser})\n`);

  const startTime = Date.now();
  const checkInterval = 5000; // Check every 5 seconds
  let lastLogPosition = 0;

  return new Promise((resolve, reject) => {
    const checkStartup = setInterval(async () => {
      try {
        // SSH into instance and check catalina.out for startup messages
        const sshCommand = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=5 ec2-user@${instanceIp} "sudo tail -n 100 /opt/tomcat/logs/catalina.out 2>/dev/null || echo ''"`;
        
        const logOutput = execSync(sshCommand, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: 'pipe'
        });

        // Look for successful startup indicators
        const startupPatterns = [
          /Server startup in \[\d+\] milliseconds/i,
          /org\.apache\.catalina\.startup\.Catalina\.start.*Server startup/i,
          /Starting ProtocolHandler.*http-nio-8080/i,
          /INFO.*Server startup/i,
        ];

        const hasStarted = startupPatterns.some(pattern => pattern.test(logOutput));

        if (hasStarted) {
          clearInterval(checkStartup);
          console.log('✅ Magnolia has started successfully!\n');

          // Explicit boolean check to ensure values are properly evaluated
          if (showToast === true || showToast === 'true' || showToast === 1) {
            try {
              console.log('🔔 Showing notification...');
              await showToastNotification(
                '🚀 Magnolia CMS Started',
                `Server is ready!\nClick to open: ${magnoliaUrl}`,
                magnoliaUrl
              );
              console.log('   ✓ Notification sent\n');
            } catch (toastError) {
              console.log(`   ⚠️  Could not show notification: ${toastError.message}\n`);
            }
          } else {
            console.log(`   ⏭️  Toast notification disabled (showToast=${showToast})\n`);
          }

          // Explicit boolean check to ensure values are properly evaluated
          if (shouldOpenBrowser === true || shouldOpenBrowser === 'true' || shouldOpenBrowser === 1) {
            try {
              console.log(`🌐 Opening browser to ${magnoliaUrl}...\n`);
              await openBrowser(magnoliaUrl);
              console.log('   ✓ Browser opened\n');
            } catch (browserError) {
              console.log(`   ⚠️  Could not open browser: ${browserError.message}\n`);
              console.log(`   Please open manually: ${magnoliaUrl}\n`);
            }
          } else {
            console.log(`   ⏭️  Browser opening disabled (shouldOpenBrowser=${shouldOpenBrowser})\n`);
          }

          resolve(true);
          return;
        }

        // Check if we've exceeded max wait time
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          clearInterval(checkStartup);
          console.log(`\n⏱️  Monitoring timeout after ${Math.floor(maxWaitTime / 1000)}s`);
          console.log('   Magnolia may still be starting. Check logs manually if needed.\n');
          resolve(false);
          return;
        }

        // Show progress every 30 seconds
        const elapsedSeconds = Math.floor(elapsed / 1000);
        if (elapsedSeconds > 0 && elapsedSeconds % 30 === 0) {
          process.stdout.write(`   ⏳ Still waiting... (${elapsedSeconds}s elapsed)\r`);
        }
      } catch (error) {
        // SSH errors are expected during startup, continue monitoring
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          clearInterval(checkStartup);
          console.log(`\n⏱️  Monitoring timeout after ${Math.floor(maxWaitTime / 1000)}s`);
          console.log('   Could not connect to instance. Check manually if needed.\n');
          resolve(false);
          return;
        }
      }
    }, checkInterval);

    // Cleanup on process exit
    process.on('SIGINT', () => {
      clearInterval(checkStartup);
      console.log('\n\n⚠️  Monitoring interrupted by user\n');
      resolve(false);
    });
  });
}

(async () => {
  try {
    console.log('🔍 Magnolia Monitoring Script Starting...\n');
    
    // Read terraform.tfvars to get monitoring settings
    const tfvarsPath = join(terraformDir, 'terraform.tfvars');
    if (!existsSync(tfvarsPath)) {
      console.error('❌ Error: terraform.tfvars not found!');
      process.exit(1);
    }

    const tfvarsContent = readFileSync(tfvarsPath, 'utf-8');
    const monitor = parseTfVar(tfvarsContent, 'monitor', false);
    const toast = parseTfVar(tfvarsContent, 'toast', true);
    const openBrowserFlag = parseTfVar(tfvarsContent, 'open_browser', true);

    // Debug: Show what was parsed
    console.log(`   Settings: monitor=${monitor}, toast=${toast}, open_browser=${openBrowserFlag}`);
    console.log(`   Debug - monitor type: ${typeof monitor}, toast type: ${typeof toast}, openBrowserFlag type: ${typeof openBrowserFlag}\n`);

    if (!monitor) {
      console.log('⏭️  Monitoring disabled (monitor=false in terraform.tfvars)\n');
      process.exit(0);
    }

    // Get Terraform outputs
    const outputs = getTerraformOutputs();
    const instanceIp = outputs.instance_public_ip?.value;
    const magnoliaUrl = outputs.magnolia_url?.value || `http://${instanceIp}/author`;

    if (!instanceIp) {
      console.error('❌ Error: Could not get instance IP from Terraform output');
      process.exit(1);
    }

    // Get SSH key path
    const awsConfig = loadAwsConfig();
    const keyPairName = outputs.ssh_command?.value?.match(/~\/\.ssh\/([^.]+)\.pem/)?.[1];
    const keyPairPath = awsConfig.sshKeyPath || process.env.AWS_KEY_PATH ||
      (keyPairName ? `~/.ssh/${keyPairName}.pem` : null);

    if (!keyPairPath) {
      console.error('❌ Error: Could not determine SSH key path');
      process.exit(1);
    }

    const expandedKeyPath = keyPairPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE);

    if (!existsSync(expandedKeyPath)) {
      console.error(`❌ Error: SSH key not found at ${expandedKeyPath}`);
      process.exit(1);
    }

    // Start monitoring
    await monitorMagnoliaStartup({
      instanceIp,
      sshKeyPath: expandedKeyPath,
      magnoliaUrl,
      showToast: toast,
      openBrowser: openBrowserFlag,
      maxWaitTime: 600000, // 10 minutes
    });

  } catch (error) {
    console.error('\n❌ Error during monitoring:', error.message);
    process.exit(1);
  }
})();

