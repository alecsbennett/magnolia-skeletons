import { Option, Command } from 'commander';
import { PluginTemplate } from '@magnolia/cli-plugin-template';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import http from 'http';
import https from 'https';
import { URL } from 'url';

const requireFn = createRequire(import.meta.url);
const pkg = requireFn('../../package.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_FILE = path.resolve(__dirname, '.content-transfer-config.json');
const DEFAULT_SERVER_URL = 'http://localhost:8080';
const PRIVATE_KEY = 'team$ite';

export default class ContentTransferPlugin extends PluginTemplate {
	name = 'content-transfer';
	aliases = ['ct'];
	version = pkg.version || '1.0.0';
	description = 'Content Transfer utility for exporting and importing JCR content';
	usage = '<command> [options]';

	init(logger) {
		this.logger = logger;
		this.config = this.loadConfig();
	}

	async start(options) {
		// Parse command from process.argv
		const args = process.argv.slice(process.argv.indexOf('content-transfer') + 1);
		if (args.length === 0) {
			this.logger?.error('Please specify a command: server, configure, export, import, or health');
			this.logger?.info('Usage: mgnl content-transfer <command> [options]');
			process.exit(1);
		}

		const command = args[0];
		
		try {
			switch (command) {
				case 'server':
					await this.handleServerCommand(args.slice(1));
					break;
				case 'configure':
					await this.handleConfigureCommand(args.slice(1), options);
					break;
				case 'export':
					await this.handleExportCommand();
					break;
				case 'import':
					await this.handleImportCommand();
					break;
				case 'health':
					await this.handleHealthCommand();
					break;
				default:
					this.logger?.error(`Unknown command: ${command}`);
					this.logger?.info('Available commands: server, configure, export, import, health');
					process.exit(1);
			}
		} catch (error) {
			this.logger?.error(`Error: ${error.message}`);
			process.exit(1);
		}
	}

	/**
	 * Load configuration from file or use defaults.
	 */
	loadConfig() {
		try {
			if (fs.existsSync(CONFIG_FILE)) {
				const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
				return JSON.parse(configData);
			}
		} catch (error) {
			this.logger?.warn(`Failed to load config file: ${error.message}`);
		}
		return {
			serverUrl: DEFAULT_SERVER_URL,
			privateKey: PRIVATE_KEY
		};
	}

	/**
	 * Save configuration to file.
	 */
	saveConfig(config) {
		try {
			fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
			return true;
		} catch (error) {
			this.logger?.error(`Failed to save config file: ${error.message}`);
			return false;
		}
	}

	/**
	 * Make HTTP request to Magnolia REST API.
	 */
	async makeRequest(endpoint, method = 'GET', body = null, requireAuth = true) {
		let serverUrl = this.config.serverUrl || DEFAULT_SERVER_URL;
		
		// Ensure server URL doesn't have trailing slash
		serverUrl = serverUrl.replace(/\/$/, '');
		
		// If server URL doesn't include context path, try to detect it
		// For Magnolia author instance, typically /author
		const url = new URL(`${serverUrl}/content-transfer${endpoint}`);
		
		this.logger?.debug(`Making ${method} request to: ${url.toString()}`);
		
		const options = {
			method: method,
			headers: {}
		};

		// Only set Content-Type for non-GET requests with body
		if (body && method !== 'GET') {
			options.headers['Content-Type'] = 'application/json';
			options.headers['Content-Length'] = Buffer.byteLength(body);
		}

		// Add authentication header if required
		if (requireAuth) {
			options.headers['X-Private-Key'] = this.config.privateKey || PRIVATE_KEY;
		}

		return new Promise((resolve, reject) => {
			const client = url.protocol === 'https:' ? https : http;
			
			const req = client.request(url, options, (res) => {
				let data = '';
				
				res.on('data', (chunk) => {
					data += chunk;
				});
				
				res.on('end', () => {
					this.logger?.debug(`Response status: ${res.statusCode}, data length: ${data.length}`);
					
					// Check if we got an HTML login page (401 from Magnolia filters)
					if (res.statusCode === 401 && data.includes('<!doctype html>')) {
						reject(new Error(`HTTP ${res.statusCode}: Request intercepted by Magnolia authentication filters. The servlet may not be accessible or needs to bypass authentication filters.\nIf you're getting 404, ensure the server URL includes the context path (e.g., http://localhost:8080/author)`));
						return;
					}
					
					// Check for 404 - might indicate missing context path
					if (res.statusCode === 404) {
						let errorMsg = `HTTP ${res.statusCode}: Endpoint not found at ${url.toString()}`;
						if (!serverUrl.includes('/author') && !serverUrl.includes('/public')) {
							errorMsg += `\nTip: If Magnolia uses a context path (e.g., /author), include it in the server URL:\n  mgnl content-transfer server http://localhost:8080/author`;
						}
						reject(new Error(errorMsg));
						return;
					}
					
					try {
						const jsonData = data ? JSON.parse(data) : {};
						if (res.statusCode >= 200 && res.statusCode < 300) {
							resolve({ statusCode: res.statusCode, data: jsonData });
						} else {
							reject(new Error(`HTTP ${res.statusCode}: ${jsonData.message || data || 'Unknown error'}`));
						}
					} catch (e) {
						this.logger?.debug(`Response is not JSON: ${data.substring(0, 100)}`);
						if (res.statusCode >= 200 && res.statusCode < 300) {
							resolve({ statusCode: res.statusCode, data: data });
						} else {
							reject(new Error(`HTTP ${res.statusCode}: ${data || 'Unknown error'}`));
						}
					}
				});
			});

			req.on('error', (error) => {
				this.logger?.error(`Request error: ${error.message}`);
				if (error.code === 'ECONNREFUSED') {
					let errorMsg = `Cannot connect to server at ${serverUrl}. Is Magnolia running?`;
					// Check if URL might be missing context path
					if (!serverUrl.includes('/author') && !serverUrl.includes('/public') && !serverUrl.match(/:\d+\/[^\/]/)) {
						errorMsg += `\nNote: If Magnolia uses a context path (e.g., /author), include it in the server URL:\n  mgnl content-transfer server http://localhost:8080/author`;
					}
					reject(new Error(errorMsg));
				} else {
					reject(new Error(`Request failed: ${error.message}`));
				}
			});

			req.setTimeout(300000, () => { // 5 minute timeout
				req.destroy();
				reject(new Error('Request timeout - the operation may still be running on the server'));
			});

			// Only write body for non-GET requests
			if (body && method !== 'GET') {
				req.write(body);
			}

			req.end();
		});
	}

	/**
	 * Handle server command.
	 */
	async handleServerCommand(args) {
		const url = args[0];
		if (url) {
			this.config.serverUrl = url;
			if (this.saveConfig(this.config)) {
				this.logger?.info(`Server URL set to: ${url}`);
			} else {
				this.logger?.error('Failed to save server URL');
				process.exit(1);
			}
		} else {
			const currentUrl = this.config.serverUrl || DEFAULT_SERVER_URL;
			this.logger?.info(`Current server URL: ${currentUrl}`);
		}
	}

	/**
	 * Handle configure command.
	 */
	async handleConfigureCommand(args, options) {
		this.logger?.info(`Connecting to server: ${this.config.serverUrl || DEFAULT_SERVER_URL}`);
		
		// First check if REST endpoint is available
		this.logger?.info('Checking REST endpoint availability...');
		const health = await this.checkHealth();
		
		if (!health.available) {
			this.logger?.error('');
			this.logger?.error('❌ Content Transfer REST endpoint is not available!');
			this.logger?.error('');
			this.logger?.error('The REST endpoint is not accessible. This usually means:');
			this.logger?.error('1. The content-transfer module is not loaded in Magnolia');
			this.logger?.error('2. The REST endpoint was not registered properly');
			this.logger?.error('3. Magnolia needs to be restarted after deploying the module');
			this.logger?.error('4. The module JAR is not in Magnolia\'s WEB-INF/lib directory');
			this.logger?.error('');
			this.logger?.error('Please check:');
			this.logger?.error(`- Is Magnolia running at ${this.config.serverUrl || DEFAULT_SERVER_URL}?`);
			this.logger?.error('- Is the content-transfer module deployed?');
			this.logger?.error('- Check Magnolia logs for REST endpoint registration messages');
			this.logger?.error('- Verify the module JAR is in WEB-INF/lib');
			this.logger?.error('');
			this.logger?.error(`Health check error: ${health.error}`);
			process.exit(1);
		}
		
		this.logger?.info(`✓ REST endpoint is available (status: ${health.status})`);
		
		let configData;
		
		if (options.stdin || args.includes('--stdin') || args.includes('-i')) {
			// Read from stdin
			configData = await this.readStdin();
		} else if (args.length > 0 && !args[0].startsWith('-')) {
			// Read from file
			const configFile = args[0];
			const configPath = path.resolve(configFile);
			if (!fs.existsSync(configPath)) {
				this.logger?.error(`Configuration file not found: ${configPath}`);
				process.exit(1);
			}
			configData = fs.readFileSync(configPath, 'utf8');
		} else {
			this.logger?.error('Please provide a configuration file or use --stdin');
			process.exit(1);
		}

		// Validate JSON
		try {
			JSON.parse(configData);
		} catch (e) {
			this.logger?.error(`Invalid JSON: ${e.message}`);
			process.exit(1);
		}

		this.logger?.info('Sending configuration to server...');
		try {
			// Encode config as base64 and pass as query parameter
			const configBase64 = Buffer.from(configData, 'utf8').toString('base64');
			const response = await this.makeRequest(`/configure?config=${encodeURIComponent(configBase64)}`, 'GET');
			this.logger?.info(`Configuration sent successfully (HTTP ${response.statusCode})`);
			if (response.data.message) {
				this.logger?.info(`Server response: ${response.data.message}`);
			}
		} catch (error) {
			this.logger?.error(`Failed to configure: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Check if the servlet is available by calling the health endpoint.
	 */
	async checkHealth() {
		try {
			const response = await this.makeRequest('/health', 'GET', null, false); // No auth for health
			return {
				available: true,
				status: response.data.status,
				details: response.data
			};
		} catch (error) {
			return {
				available: false,
				error: error.message
			};
		}
	}

	/**
	 * Handle export command.
	 */
	async handleExportCommand() {
		this.logger?.info('Starting export operation...');
		this.logger?.info(`Connecting to server: ${this.config.serverUrl || DEFAULT_SERVER_URL}`);
		
		// First check if REST endpoint is available
		this.logger?.info('Checking REST endpoint availability...');
		const health = await this.checkHealth();
		
		if (!health.available) {
			this.logger?.error('');
			this.logger?.error('❌ Content Transfer REST endpoint is not available!');
			this.logger?.error('');
			this.logger?.error('The REST endpoint is not accessible. This usually means:');
			this.logger?.error('1. The content-transfer module is not loaded in Magnolia');
			this.logger?.error('2. The REST endpoint was not registered properly');
			this.logger?.error('3. Magnolia needs to be restarted after deploying the module');
			this.logger?.error('4. The module JAR is not in Magnolia\'s WEB-INF/lib directory');
			this.logger?.error('');
			this.logger?.error('Please check:');
			this.logger?.error(`- Is Magnolia running at ${this.config.serverUrl || DEFAULT_SERVER_URL}?`);
			this.logger?.error('- Is the content-transfer module deployed?');
			this.logger?.error('- Check Magnolia logs for REST endpoint registration messages');
			this.logger?.error('- Verify the module JAR is in WEB-INF/lib');
			this.logger?.error('');
			this.logger?.error(`Health check error: ${health.error}`);
			process.exit(1);
		}
		
		this.logger?.info(`✓ REST endpoint is available (status: ${health.status})`);
		if (health.details) {
			this.logger?.debug(`Servlet details: ${JSON.stringify(health.details, null, 2)}`);
		}
		
		try {
			const response = await this.makeRequest('/export', 'GET');
			this.logger?.info(`Export completed successfully (HTTP ${response.statusCode})`);
			if (response.data) {
				if (response.data.message) {
					this.logger?.info(`Server response: ${response.data.message}`);
				}
				if (response.data.error) {
					this.logger?.warn(`Server reported error: ${response.data.message || 'Unknown error'}`);
				}
				// Log full response in debug mode
				this.logger?.debug(`Full response: ${JSON.stringify(response.data, null, 2)}`);
			}
		} catch (error) {
			if (error.message.includes('404') || error.message.includes('Not Found')) {
				this.logger?.error(`Export failed: ${error.message}`);
				this.logger?.error('');
				this.logger?.error('The export endpoint returned 404. This usually means:');
				this.logger?.error('1. The servlet is registered but the endpoint path is incorrect');
				this.logger?.error('2. Check Magnolia logs for errors');
			} else {
				this.logger?.error(`Export failed: ${error.message}`);
			}
			throw error;
		}
	}

	/**
	 * Handle import command.
	 */
	async handleImportCommand() {
		this.logger?.info('Starting import operation...');
		this.logger?.info(`Connecting to server: ${this.config.serverUrl || DEFAULT_SERVER_URL}`);
		
		// First check if REST endpoint is available
		this.logger?.info('Checking REST endpoint availability...');
		const health = await this.checkHealth();
		
		if (!health.available) {
			this.logger?.error('');
			this.logger?.error('❌ Content Transfer REST endpoint is not available!');
			this.logger?.error('');
			this.logger?.error('The REST endpoint is not accessible. This usually means:');
			this.logger?.error('1. The content-transfer module is not loaded in Magnolia');
			this.logger?.error('2. The REST endpoint was not registered properly');
			this.logger?.error('3. Magnolia needs to be restarted after deploying the module');
			this.logger?.error('4. The module JAR is not in Magnolia\'s WEB-INF/lib directory');
			this.logger?.error('');
			this.logger?.error('Please check:');
			this.logger?.error(`- Is Magnolia running at ${this.config.serverUrl || DEFAULT_SERVER_URL}?`);
			this.logger?.error('- Is the content-transfer module deployed?');
			this.logger?.error('- Check Magnolia logs for REST endpoint registration messages');
			this.logger?.error('- Verify the module JAR is in WEB-INF/lib');
			this.logger?.error('');
			this.logger?.error(`Health check error: ${health.error}`);
			process.exit(1);
		}
		
		this.logger?.info(`✓ REST endpoint is available (status: ${health.status})`);
		
		try {
			const response = await this.makeRequest('/import', 'GET');
			this.logger?.info('Import completed successfully');
			if (response.data.message) {
				this.logger?.info(response.data.message);
			}
		} catch (error) {
			this.logger?.error(`Import failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Handle health command - check if servlet is available.
	 */
	async handleHealthCommand() {
		this.logger?.info(`Checking servlet health at: ${this.config.serverUrl || DEFAULT_SERVER_URL}`);
		this.logger?.info('Making health check request...');
		
		const health = await this.checkHealth();
		
		if (health.available) {
			this.logger?.info('');
			this.logger?.info('✓ Content Transfer servlet is available!');
			this.logger?.info(`  Status: ${health.status}`);
			if (health.details) {
				this.logger?.info(`  Service: ${health.details.service || 'N/A'}`);
				this.logger?.info(`  Servlet: ${health.details.servlet || 'N/A'}`);
				this.logger?.info(`  Configured: ${health.details.configured ? 'Yes' : 'No'}`);
				this.logger?.info(`  Export Service: ${health.details.exportService ? 'Available' : 'Not Available'}`);
				this.logger?.info(`  Import Service: ${health.details.importService ? 'Available' : 'Not Available'}`);
			}
			this.logger?.info('');
		} else {
			this.logger?.error('');
			this.logger?.error('❌ Content Transfer REST endpoint is not available!');
			this.logger?.error('');
			this.logger?.error('The REST endpoint is not accessible. This usually means:');
			this.logger?.error('1. The content-transfer module is not loaded in Magnolia');
			this.logger?.error('2. The REST endpoint was not registered properly');
			this.logger?.error('3. Magnolia needs to be restarted after deploying the module');
			this.logger?.error('4. The module JAR is not in Magnolia\'s WEB-INF/lib directory');
			this.logger?.error('');
			this.logger?.error('Please check:');
			this.logger?.error(`- Is Magnolia running at ${this.config.serverUrl || DEFAULT_SERVER_URL}?`);
			this.logger?.error('- Is the content-transfer module deployed?');
			this.logger?.error('- Check Magnolia logs for REST endpoint registration messages');
			this.logger?.error('- Verify the module JAR is in WEB-INF/lib');
			this.logger?.error('');
			this.logger?.error(`Health check error: ${health.error}`);
			this.logger?.error('');
			process.exit(1);
		}
	}

	/**
	 * Read data from stdin.
	 */
	readStdin() {
		return new Promise((resolve, reject) => {
			let data = '';
			process.stdin.setEncoding('utf8');
			
			process.stdin.on('data', (chunk) => {
				data += chunk;
			});
			
			process.stdin.on('end', () => {
				resolve(data);
			});
			
			process.stdin.on('error', (error) => {
				reject(error);
			});
		});
	}
}

