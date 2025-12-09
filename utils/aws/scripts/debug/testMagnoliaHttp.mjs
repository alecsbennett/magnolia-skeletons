#!/usr/bin/env node

import http from 'http';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const terraformDir = join(__dirname, '..', '..', 'terraform');

function getTerraformOutputs() {
  const output = execSync('terraform output -json', {
    cwd: terraformDir,
    encoding: 'utf-8',
  });
  return JSON.parse(output);
}

function httpGet(name, options) {
  return new Promise((resolve) => {
    const req = http.request(
      options,
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          console.log(`\n=== ${name} ===`);
          console.log(`URL: http://${options.host}:${options.port}${options.path}`);
          console.log(`Status: ${res.statusCode}`);
          console.log('Headers:', res.headers);
          console.log('Body (first 400 chars):');
          console.log(body.slice(0, 400) || '<empty>');
          resolve({ ok: true, status: res.statusCode });
        });
      }
    );

    req.on('error', (err) => {
      console.log(`\n=== ${name} ===`);
      console.log(`URL: http://${options.host}:${options.port}${options.path}`);
      console.log('Error:', err.message);
      resolve({ ok: false, error: err });
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error('Request timed out'));
    });

    req.end();
  });
}

(async () => {
  try {
    console.log('🔍 Testing Magnolia HTTP access...\n');

    const outputs = getTerraformOutputs();
    const instanceIp = outputs.instance_public_ip?.value;
    const magnoliaUrl = outputs.magnolia_url?.value;

    if (!instanceIp) {
      console.error('❌ instance_public_ip not found in Terraform outputs');
      process.exit(1);
    }

    console.log(`Instance IP: ${instanceIp}`);
    if (magnoliaUrl) {
      console.log(`Terraform Magnolia URL: ${magnoliaUrl}`);
    }

    // Derive path from magnolia_url if available, default to /author/
    let path = '/author/';
    if (magnoliaUrl) {
      try {
        const u = new URL(magnoliaUrl);
        path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
      } catch {
        // ignore parse errors, use default
      }
    }

    // Test port 80 (with iptables redirect)
    await httpGet('Port 80 (expected public access via iptables)', {
      host: instanceIp,
      port: 80,
      path,
      method: 'GET',
    });

    // Test port 8080 directly (bypassing iptables)
    await httpGet('Port 8080 (direct Tomcat)', {
      host: instanceIp,
      port: 8080,
      path,
      method: 'GET',
    });

    console.log('\n✅ HTTP tests complete. Use results above to diagnose connectivity vs Tomcat/Magnolia issues.');
  } catch (err) {
    console.error('\n❌ Error running testMagnoliaHttp.mjs:', err.message);
    process.exit(1);
  }
})();


