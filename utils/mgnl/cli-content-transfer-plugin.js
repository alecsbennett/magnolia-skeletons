import { Option, Command } from 'commander';
import { PluginTemplate } from '@magnolia/cli-plugin-template';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import readline from 'readline';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const requireFn = createRequire(import.meta.url);
const pkg = requireFn('../../package.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_FILE = path.resolve(__dirname, '.content-transfer-config.json');
const MGNL_CONFIG_FILE = path.resolve(process.cwd(), 'mgnl.config.js');
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
			this.logger?.error('Please specify a command: server, configure, configure-s3, export, import, or health');
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
				case 'configure-s3':
					await this.handleConfigureS3Command();
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
					this.logger?.info('Available commands: server, configure, configure-s3, export, import, health');
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
	 * Get the content transfer config file path from mgnl.config.js
	 */
	getConfigFilePath() {
		try {
			if (!fs.existsSync(MGNL_CONFIG_FILE)) {
				return null;
			}
			const configContent = fs.readFileSync(MGNL_CONFIG_FILE, 'utf8');
			// Try to extract contentTransferConfigPath from the config
			const match = configContent.match(/contentTransferConfigPath:\s*['"]([^'"]+)['"]/);
			if (match) {
				return match[1];
			}
			// Also check for it in an object format
			const jsonMatch = configContent.match(/contentTransferConfigPath:\s*([^\s,}]+)/);
			if (jsonMatch) {
				return jsonMatch[1].replace(/['"]/g, '');
			}
			return null;
		} catch (error) {
			this.logger?.warn(`Failed to read mgnl.config.js: ${error.message}`);
			return null;
		}
	}

	/**
	 * Save the content transfer config file path to mgnl.config.js
	 */
	saveConfigFilePath(configFilePath) {
		try {
			if (!fs.existsSync(MGNL_CONFIG_FILE)) {
				this.logger?.error(`mgnl.config.js not found at ${MGNL_CONFIG_FILE}`);
				return false;
			}
			
			let configContent = fs.readFileSync(MGNL_CONFIG_FILE, 'utf8');
			
			// Convert to absolute path if relative
			const absolutePath = path.isAbsolute(configFilePath) 
				? configFilePath 
				: path.resolve(process.cwd(), configFilePath);
			
			// Normalize path separators for Windows compatibility
			const normalizedPath = absolutePath.replace(/\\/g, '/');
			
			// Check if contentTransferConfigPath already exists
			if (configContent.includes('contentTransferConfigPath')) {
				// Replace existing value
				configContent = configContent.replace(
					/contentTransferConfigPath:\s*['"][^'"]*['"]/,
					`contentTransferConfigPath: '${normalizedPath}'`
				);
			} else {
				// Add it before the closing brace of the export default object
				// Find the last property before the closing brace
				const lastPropertyMatch = configContent.match(/(\s+)([^,}\s]+:\s*\{[^}]*\},?\s*)$/m);
				if (lastPropertyMatch) {
					// Add after the last property
					const indent = lastPropertyMatch[1];
					configContent = configContent.replace(
						/(\s+)([^,}\s]+:\s*\{[^}]*\},?\s*)$/m,
						`$1$2\n${indent}// Content Transfer configuration file path\n${indent}contentTransferConfigPath: '${normalizedPath}',`
					);
				} else {
					// Fallback: add before the closing brace
					configContent = configContent.replace(
						/(\s+)(\};?\s*)$/m,
						`$1// Content Transfer configuration file path\n$1contentTransferConfigPath: '${normalizedPath}',\n$1$2`
					);
				}
			}
			
			fs.writeFileSync(MGNL_CONFIG_FILE, configContent, 'utf8');
			return true;
		} catch (error) {
			this.logger?.error(`Failed to save config path to mgnl.config.js: ${error.message}`);
			return false;
		}
	}

	/**
	 * Read the configuration file content.
	 */
	readConfigFile(configFilePath) {
		try {
			const absolutePath = path.isAbsolute(configFilePath) 
				? configFilePath 
				: path.resolve(process.cwd(), configFilePath);
			
			if (!fs.existsSync(absolutePath)) {
				throw new Error(`Configuration file not found: ${absolutePath}`);
			}
			
			const configData = fs.readFileSync(absolutePath, 'utf8');
			// Validate JSON
			JSON.parse(configData);
			return configData;
		} catch (error) {
			throw new Error(`Failed to read configuration file: ${error.message}`);
		}
	}

	/**
	 * Make HTTP request to Magnolia REST API.
	 */
	async makeRequest(endpoint, method = 'GET', body = null, requireAuth = true, configJson = null) {
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

		// If configJson is provided, add it to the request body or as query parameter
		let requestBody = body;
		if (configJson) {
			const configBase64 = Buffer.from(configJson, 'utf8').toString('base64');
			if (method === 'GET') {
				// For GET requests, add config as query parameter
				url.searchParams.set('config', configBase64);
			} else {
				// For POST/PUT requests, include config in body
				const bodyObj = body ? JSON.parse(body) : {};
				bodyObj.config = configBase64;
				requestBody = JSON.stringify(bodyObj);
			}
		}

		// Only set Content-Type for non-GET requests with body
		if (requestBody && method !== 'GET') {
			options.headers['Content-Type'] = 'application/json';
			options.headers['Content-Length'] = Buffer.byteLength(requestBody);
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
			if (requestBody && method !== 'GET') {
				req.write(requestBody);
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
	 * Handle configure command - stores the config file path locally.
	 */
	async handleConfigureCommand(args, options) {
		let configFilePath;
		
		if (options.stdin || args.includes('--stdin') || args.includes('-i')) {
			// For stdin, we need to save to a temp file first
			const configData = await this.readStdin();
			// Validate JSON
			try {
				JSON.parse(configData);
			} catch (e) {
				this.logger?.error(`Invalid JSON: ${e.message}`);
				process.exit(1);
			}
			
			// Save to a temporary file
			const tempFile = path.resolve(process.cwd(), 'transfer-config-temp.json');
			fs.writeFileSync(tempFile, configData, 'utf8');
			configFilePath = tempFile;
			this.logger?.info(`Configuration saved to temporary file: ${configFilePath}`);
		} else if (args.length > 0 && !args[0].startsWith('-')) {
			// Read from file
			const configFile = args[0];
			const configPath = path.resolve(configFile);
			if (!fs.existsSync(configPath)) {
				this.logger?.error(`Configuration file not found: ${configPath}`);
				process.exit(1);
			}
			
			// Validate JSON
			try {
				const configData = fs.readFileSync(configPath, 'utf8');
				JSON.parse(configData);
			} catch (e) {
				this.logger?.error(`Invalid JSON: ${e.message}`);
				process.exit(1);
			}
			
			configFilePath = configPath;
		} else {
			this.logger?.error('Please provide a configuration file or use --stdin');
			process.exit(1);
		}

		// Save the config file path to mgnl.config.js
		if (this.saveConfigFilePath(configFilePath)) {
			this.logger?.info(`Configuration file path saved to mgnl.config.js: ${configFilePath}`);
			this.logger?.info('The configuration will be sent with each export/import request.');
		} else {
			this.logger?.error('Failed to save configuration file path');
			process.exit(1);
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
		
		// Get config file path from mgnl.config.js
		const configFilePath = this.getConfigFilePath();
		if (!configFilePath) {
			this.logger?.error('No configuration file path found. Please run: mgnl content-transfer configure <config-file>');
			process.exit(1);
		}
		
		// Read configuration file
		let configJson;
		try {
			configJson = this.readConfigFile(configFilePath);
			this.logger?.info(`Using configuration from: ${configFilePath}`);
		} catch (error) {
			this.logger?.error(`Failed to read configuration file: ${error.message}`);
			process.exit(1);
		}
		
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
		
		console.log('Processing export...');
		
		try {
			const response = await this.makeRequest('/export', 'GET', null, true, configJson);
			
			if (response.data) {
				// Check if documentsExported is in the response (even if 0)
				if ('documentsExported' in response.data) {
					const count = response.data.documentsExported;
					console.log(`✓ Export complete: ${count} document${count !== 1 ? 's' : ''} exported`);
				} else {
					// Fallback to message if count not available
					console.log(`✓ Export complete: ${response.data.message || 'Export completed successfully'}`);
				}
				if (response.data.error) {
					this.logger?.warn(`Server reported error: ${response.data.message || 'Unknown error'}`);
				}
				// Log full response in debug mode
				this.logger?.debug(`Full response: ${JSON.stringify(response.data, null, 2)}`);
			} else {
				console.log(`✓ Export completed successfully (HTTP ${response.statusCode})`);
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
		
		// Get config file path from mgnl.config.js
		const configFilePath = this.getConfigFilePath();
		if (!configFilePath) {
			this.logger?.error('No configuration file path found. Please run: mgnl content-transfer configure <config-file>');
			process.exit(1);
		}
		
		// Read configuration file
		let configJson;
		try {
			configJson = this.readConfigFile(configFilePath);
			this.logger?.info(`Using configuration from: ${configFilePath}`);
		} catch (error) {
			this.logger?.error(`Failed to read configuration file: ${error.message}`);
			process.exit(1);
		}
		
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
		
		console.log('Processing import...');
		
		try {
			const response = await this.makeRequest('/import', 'GET', null, true, configJson);
			
			if (response.data) {
				// Check if documentsImported is in the response (even if 0)
				if ('documentsImported' in response.data) {
					const count = response.data.documentsImported;
					console.log(`✓ Import complete: ${count} document${count !== 1 ? 's' : ''} imported`);
				} else {
					// Fallback to message if count not available
					console.log(`✓ Import complete: ${response.data.message || 'Import completed successfully'}`);
				}
			} else {
				console.log('✓ Import completed successfully');
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

	/**
	 * Prompt user for input interactively.
	 */
	promptUser(question) {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		return new Promise((resolve) => {
			rl.question(question, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		});
	}

	/**
	 * Prompt user for password input (visible with warning).
	 */
	promptPassword(question) {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		return new Promise((resolve) => {
			this.logger?.warn('Note: Password input will be visible. Press Enter when done.');
			rl.question(question, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		});
	}

	/**
	 * Validate S3 bucket name according to AWS rules.
	 */
	validateBucketName(name) {
		if (!name) {
			return { valid: false, error: 'Bucket name is required' };
		}

		// Bucket name must be 3-63 characters
		if (name.length < 3 || name.length > 63) {
			return { valid: false, error: 'Bucket name must be between 3 and 63 characters' };
		}

		// Bucket name must be lowercase
		if (name !== name.toLowerCase()) {
			return { valid: false, error: 'Bucket name must be lowercase' };
		}

		// Bucket name can contain lowercase letters, numbers, dots, and hyphens
		// Cannot start or end with a dot or hyphen
		// For names with 2+ chars: must start and end with alphanumeric
		// For single char: must be alphanumeric (but we already enforce 3-63 chars, so this won't apply)
		if (name.length >= 2 && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
			return { valid: false, error: 'Bucket name can only contain lowercase letters, numbers, dots, and hyphens. Cannot start or end with dot or hyphen.' };
		}
		if (name.length === 1 && !/^[a-z0-9]$/.test(name)) {
			return { valid: false, error: 'Bucket name can only contain lowercase letters and numbers.' };
		}

		// Cannot be formatted as an IP address
		if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
			return { valid: false, error: 'Bucket name cannot be formatted as an IP address' };
		}

		// Cannot contain consecutive dots
		if (name.includes('..')) {
			return { valid: false, error: 'Bucket name cannot contain consecutive dots' };
		}

		return { valid: true };
	}

	/**
	 * Check if S3 bucket exists.
	 */
	async checkBucketExists(bucketName, s3Client) {
		try {
			await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
			return true;
		} catch (error) {
			if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
				return false;
			}
			// Wrap error with more context
			const enhancedError = new Error(`Failed to check bucket existence: ${error.message || error.name || 'Unknown error'}`);
			enhancedError.name = error.name || 'UnknownError';
			enhancedError.$metadata = error.$metadata;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Create S3 bucket.
	 */
	async createBucket(bucketName, region, s3Client) {
		try {
			await s3Client.send(new CreateBucketCommand({ 
				Bucket: bucketName,
				// For regions other than us-east-1, specify LocationConstraint
				...(region !== 'us-east-1' && {
					CreateBucketConfiguration: {
						LocationConstraint: region
					}
				})
			}));
			return { success: true };
		} catch (error) {
			const errorName = error.name || 'UnknownError';
			const errorMessage = error.message || 'Failed to create bucket';
			const httpStatusCode = error.$metadata?.httpStatusCode;
			
			if (errorName === 'BucketAlreadyExists' || errorName === 'BucketAlreadyOwnedByYou') {
				return { success: false, error: 'Bucket already exists' };
			}
			
			// Build detailed error message
			let detailedError = errorMessage;
			if (httpStatusCode) {
				detailedError += ` (HTTP ${httpStatusCode})`;
			}
			if (error.$metadata?.requestId) {
				detailedError += ` [Request ID: ${error.$metadata.requestId}]`;
			}
			
			return { success: false, error: detailedError, errorName, httpStatusCode };
		}
	}

	/**
	 * Handle configure-s3 command - interactive S3 configuration setup.
	 */
	async handleConfigureS3Command() {
		this.logger?.info('S3 Configuration Setup');
		this.logger?.info('====================\n');

		try {
			// Prompt for AWS Access Key ID
			let accessKeyId = await this.promptUser('AWS Access Key ID: ');
			while (!accessKeyId) {
				this.logger?.error('Access Key ID is required');
				accessKeyId = await this.promptUser('AWS Access Key ID: ');
			}

			// Prompt for AWS Secret Access Key
			let secretAccessKey = await this.promptPassword('AWS Secret Access Key: ');
			while (!secretAccessKey) {
				this.logger?.error('Secret Access Key is required');
				secretAccessKey = await this.promptPassword('AWS Secret Access Key: ');
			}

			// Prompt for AWS Region
			let region = await this.promptUser('AWS Region [us-east-1]: ');
			if (!region) {
				region = 'us-east-1';
			}

			// Prompt for bucket name
			let bucketName = await this.promptUser('S3 Bucket Name: ');
			while (!bucketName) {
				this.logger?.error('Bucket name is required');
				bucketName = await this.promptUser('S3 Bucket Name: ');
			}

			// Validate bucket name
			let validation = this.validateBucketName(bucketName);
			while (!validation.valid) {
				this.logger?.error(`Invalid bucket name: ${validation.error}`);
				bucketName = await this.promptUser('S3 Bucket Name: ');
				if (bucketName) {
					validation = this.validateBucketName(bucketName);
				} else {
					validation = { valid: false, error: 'Bucket name is required' };
				}
			}

			// Prompt for destination path prefix
			const prefix = await this.promptUser('Destination path prefix (optional, press Enter to skip): ');
			const destinationPath = prefix ? `${bucketName}/${prefix}` : bucketName;

			// Prompt for bucket creation
			const createBucketAnswer = await this.promptUser('Create bucket if it doesn\'t exist? (y/n) [n]: ');
			const shouldCreateBucket = createBucketAnswer.toLowerCase() === 'y' || createBucketAnswer.toLowerCase() === 'yes';

			// Create S3 client
			const s3Client = new S3Client({
				region: region,
				credentials: {
					accessKeyId: accessKeyId,
					secretAccessKey: secretAccessKey
				}
			});

			// Check if bucket exists
			this.logger?.info('\nChecking bucket status...');
			let bucketExists = false;
			try {
				bucketExists = await this.checkBucketExists(bucketName, s3Client);
			} catch (error) {
				// If checking fails, log warning but continue (might be permissions issue)
				this.logger?.warn(`⚠ Could not verify bucket existence: ${error.message || error.name || 'Unknown error'}`);
				this.logger?.warn('Continuing anyway. Bucket will be created if requested.');
				bucketExists = false;
			}

			if (bucketExists) {
				this.logger?.info(`✓ Bucket '${bucketName}' already exists`);
			} else {
				if (shouldCreateBucket) {
					this.logger?.info(`Creating bucket '${bucketName}'...`);
					try {
						const createResult = await this.createBucket(bucketName, region, s3Client);
						if (createResult.success) {
							this.logger?.info(`✓ Bucket '${bucketName}' created successfully`);
						} else {
							if (createResult.error === 'Bucket already exists') {
								this.logger?.info(`✓ Bucket '${bucketName}' already exists`);
							} else {
								this.logger?.warn(`⚠ Could not create bucket: ${createResult.error}`);
								if (createResult.httpStatusCode === 403) {
									this.logger?.warn('This appears to be a permissions issue. Check your IAM policies.');
								}
								this.logger?.warn('You may need to create it manually or check your AWS permissions');
							}
						}
					} catch (createError) {
						// If createBucket throws (shouldn't happen, but handle it)
						this.logger?.warn(`⚠ Error creating bucket: ${createError.message || createError.name || 'Unknown error'}`);
						this.logger?.warn('You may need to create it manually or check your AWS permissions');
					}
				} else {
					this.logger?.warn(`⚠ Bucket '${bucketName}' does not exist`);
					this.logger?.warn('You will need to create it manually before using this configuration');
				}
			}

			// Prompt for configuration file name
			const configFileName = await this.promptUser(`Configuration file name [transfer-config.json]: `);
			const finalConfigFileName = configFileName || 'transfer-config.json';

			// Create configuration object
			const config = {
				output: {
					type: 'S3',
					destinationPath: destinationPath,
					settings: {
						accessKeyId: accessKeyId,
						secretAccessKey: secretAccessKey,
						region: region
					}
				},
				workspaces: []
			};

			// Save configuration file
			const configFilePath = path.resolve(process.cwd(), finalConfigFileName);
			fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
			this.logger?.info(`\n✓ Configuration saved to: ${configFilePath}`);

			// Optionally update mgnl.config.js
			const updateConfigAnswer = await this.promptUser('Update mgnl.config.js with this configuration path? (y/n) [y]: ');
			const shouldUpdateConfig = updateConfigAnswer.toLowerCase() !== 'n' && updateConfigAnswer.toLowerCase() !== 'no';

			if (shouldUpdateConfig) {
				if (this.saveConfigFilePath(configFilePath)) {
					this.logger?.info(`✓ Configuration path saved to mgnl.config.js`);
				} else {
					this.logger?.warn('⚠ Could not update mgnl.config.js. You may need to set contentTransferConfigPath manually.');
				}
			}

			this.logger?.info('\n✓ S3 configuration setup complete!');
			this.logger?.info(`You can now use this configuration with: mgnl content-transfer export`);

		} catch (error) {
			// Extract error details
			const errorName = error.name || 'UnknownError';
			const errorMessage = error.message || 'Unknown error occurred';
			const httpStatusCode = error.$metadata?.httpStatusCode;
			
			this.logger?.error('\n❌ Configuration setup failed!\n');
			
			if (errorName === 'InvalidAccessKeyId' || errorName === 'SignatureDoesNotMatch') {
				this.logger?.error('Invalid AWS credentials. Please check your Access Key ID and Secret Access Key.');
			} else if (errorName === 'AccessDenied' || httpStatusCode === 403) {
				this.logger?.error('Access denied. Please check your AWS permissions.');
				this.logger?.error('Required permissions: s3:CreateBucket, s3:HeadBucket, s3:PutObject');
			} else if (errorName === 'BucketAlreadyExists' || errorName === 'BucketAlreadyOwnedByYou') {
				this.logger?.error('Bucket already exists. This is usually not an error.');
			} else if (httpStatusCode) {
				this.logger?.error(`AWS API Error (HTTP ${httpStatusCode}): ${errorMessage}`);
				if (error.$metadata?.requestId) {
					this.logger?.error(`Request ID: ${error.$metadata.requestId}`);
				}
			} else {
				this.logger?.error(`Error: ${errorMessage}`);
				if (errorName !== 'UnknownError') {
					this.logger?.error(`Error Type: ${errorName}`);
				}
			}
			
			// Log additional debug info if available
			if (error.$metadata) {
				this.logger?.debug(`AWS Error Metadata: ${JSON.stringify(error.$metadata, null, 2)}`);
			}
			
			this.logger?.error('\nTroubleshooting tips:');
			this.logger?.error('- Verify your AWS credentials are correct');
			this.logger?.error('- Check that your IAM user has S3 permissions');
			this.logger?.error('- Ensure the bucket name is globally unique (if creating)');
			this.logger?.error('- Verify your AWS region is correct');
			
			throw error;
		}
	}
}

