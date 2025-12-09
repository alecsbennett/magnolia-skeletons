/**
 * Test script for Magnolia toast notifications
 * Run with: node testToast.cjs
 * 
 * Note: This is a CommonJS version of the script (not ES module)
 * to avoid import/require compatibility issues.
 */

const notifier = require('node-notifier');
const { exec } = require('child_process');

// Configuration - feel free to modify these for testing
const CONFIG = {
  serverUrl: "http://localhost:8080/author/",
  title: "🚀 Server Loaded",
  id: "Magnolia Server Loader",
  message: "Server is ready at http://localhost:8080/author/",
  timeout: 30, // seconds
  sound: true,
  wait: true,
};

// Show notification
function showNotification() {
  console.log("📣 Showing test notification...");
  console.log(`   Title: "${CONFIG.title}"`);
  console.log(`   Message: "${CONFIG.message}"`);
  console.log(`   URL: ${CONFIG.serverUrl}`);
  
  // Set up notification event handlers BEFORE showing the notification
  notifier.on("click", () => {
    console.log("🖱️  Notification clicked, opening browser...");
    openBrowser();
  });
  
  notifier.on("activate", () => {
    console.log("🖱️  Notification activated, opening browser...");
    openBrowser();
  });
  
  notifier.on("buttonClicked", (obj, metadata) => {
    console.log(`🖱️  Notification button clicked: ${metadata.activationType}`);
    openBrowser();
  });
  
  notifier.on("timeout", () => {
    console.log("⏱️  Notification timed out");
  });
  
  notifier.on("dismissed", () => {
    console.log("❌ Notification dismissed");
  });

  // Now show the notification
  notifier.notify({
    title: CONFIG.title,
    message: CONFIG.message,
    sound: CONFIG.sound,
    wait: CONFIG.wait,
    timeout: CONFIG.timeout,
    appID: CONFIG.id
  }, (err, response, metadata) => {
    // Handle notification response via callback (more reliable on Windows)
    // On Windows, clicking often results in undefined response but callback is still called
    if (!err) {
      if (response === 'activate' || response === 'clicked' || response === undefined) {
        // undefined response on Windows often means the notification was clicked
        console.log("🖱️  Notification clicked/activated via callback, opening browser...");
        openBrowser();
      } else if (response === 'timeout') {
        console.log("⏱️  Notification timed out via callback");
      }
    }
  });
}

// Open browser
function openBrowser() {
  const platform = process.platform;
  const url = CONFIG.serverUrl;
  
  try {
    console.log(`🌐 Opening browser to ${url}...`);
    
    if (platform === "win32") {
        // Windows - use rundll32 approach (more reliable than start command)
        exec(`start "" "${url}"`, (error2) => {
            if (error2) {
              console.error(`❌ Fallback also failed: ${error2.message}`);
            } else {
              console.log("✅ Browser opened successfully with fallback method");
            }
        });
    } else if (platform === "darwin") {
      // macOS - use open command
      exec(`open "${url}"`, (error) => {
        if (error) {
          console.error(`❌ Error opening browser: ${error.message}`);
        } else {
          console.log("✅ Browser opened successfully");
        }
      });
    } else {
      // Linux/Unix - try xdg-open
      exec(`xdg-open "${url}"`, (error) => {
        if (error) {
          console.error(`❌ Error opening browser: ${error.message}`);
        } else {
          console.log("✅ Browser opened successfully");
        }
      });
    }
  } catch (error) {
    console.error(`❌ Failed to open browser: ${error.message}`);
  }
}

// Main execution
console.log("🧪 Toast Notification Test");
console.log("=========================");
showNotification();
console.log("\n⚠️  This script will exit after 60 seconds if you don't interact with the notification");

// Keep the process running for a while to allow for notification interaction
setTimeout(() => {
  console.log("\n⏱️  Test timeout reached. Exiting...");
  process.exit(0);
}, 60000); // Exit after 60 seconds
