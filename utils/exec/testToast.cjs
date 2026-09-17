/**
 * Test script for Magnolia toast notifications
 * Run with: node testToast.cjs
 * 
 * This remains CommonJS so it can be launched directly, and dynamically imports
 * the shared ES module used by the server monitor.
 */

// Configuration - feel free to modify these for testing
const CONFIG = {
  title: "🚀 Server Loaded",
  appID: "Magnolia Server Loader",
  message: "Server is ready at http://localhost:8080/author/",
  timeout: 30, // seconds
  sound: true,
  wait: false,
};

async function showNotification() {
  console.log("📣 Showing test notification...");
  console.log(`   Title: "${CONFIG.title}"`);
  console.log(`   Message: "${CONFIG.message}"`);

  const { showDesktopNotification } = await import("./scripts/notifications.mjs");
  await showDesktopNotification(CONFIG);
  console.log("✅ Test notification sent successfully");
}

console.log("🧪 Toast Notification Test");
console.log("=========================");
showNotification().catch((error) => {
  console.error(`❌ Failed to show test notification: ${error.message}`);
  process.exitCode = 1;
});
