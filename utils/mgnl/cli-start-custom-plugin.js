import { Option } from 'commander';
import { PluginTemplate } from '@magnolia/cli-plugin-template';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const readStartxVersion = () => {
	const versionFile = path.join(PROJECT_ROOT, '.mgnl-startx-version');
	try {
		return readFileSync(versionFile, 'utf-8').trim() || '1.0.0';
	} catch {
		return '1.0.0';
	}
};

export default class StartCustomPlugin extends PluginTemplate {
	name = 'startx';
	version = readStartxVersion();
	description = 'Start Magnolia using custom utils/exec npm start script';
	usage = '[options]';
	options = [
		new Option('-o, --open', 'Open browser when ready'),
		new Option('--noclean', 'Skip log clearing'),
		new Option('--restart', 'Force restart if running'),
		new Option('--clearlocks', 'Force clear JCR locks'),
		new Option('--nomail', 'Start without MailDev'),
		new Option('--author', 'Start author instance only'),
		new Option('--public', 'Start public instance only'),
		new Option('--both', 'Start both author and public instances'),
	];

	utilsExecPath = path.resolve(__dirname, '..', 'exec');
	npmProcess = null;

	init(logger) {
		this.logger = logger;
	}

	async start(options) {
		this.logger?.info('Starting Magnolia with custom utils/exec script...');

		let instanceMode = 'author';
		if (options.both) {
			instanceMode = 'both';
		} else if (options.public) {
			instanceMode = 'public';
		}

		// Determine which npm script to run based on options
		let npmScript = 'start';
		if (options.open) {
			npmScript = 'start:open';
		} else if (options.noclean) {
			npmScript = 'start:noclean';
		} else if (options.restart) {
			npmScript = 'start:restart';
		} else if (options.clearlocks) {
			npmScript = 'start:clearlocks';
		} else if (options.nomail) {
			npmScript = 'start:nomail';
		}

		this.logger?.info(`Running: npm ${npmScript} in ${this.utilsExecPath}`);
		this.logger?.info(`Instance mode: ${instanceMode}`);

		// Spawn npm process
		this.npmProcess = spawn('npm', [npmScript], {
			cwd: this.utilsExecPath,
			stdio: 'inherit',
			shell: true,
			env: {
				...process.env,
				MAGNOLIA_INSTANCE_MODE: instanceMode,
			},
		});

		// Handle process events
		this.npmProcess.on('error', (error) => {
			this.logger?.error(`Failed to start npm process: ${error.message}`);
			process.exit(1);
		});

		this.npmProcess.on('exit', (code) => {
			if (code !== 0 && code !== null) {
				this.logger?.error(`npm process exited with code ${code}`);
				process.exit(code);
			}
		});

		// Keep the plugin running until stopped
		await new Promise((resolve) => {
			// The process will keep running until SIGINT/SIGTERM
			// We resolve only when explicitly stopped
			this.npmProcess?.on('exit', () => {
				resolve();
			});
		});
	}

	async stop() {
		this.logger?.info('Stopping Magnolia server...');

		if (this.npmProcess) {
			// Send SIGINT to npm process, which should propagate to child processes
			this.npmProcess.kill('SIGINT');

			// Also try to run the kill script from utils/exec
			try {
				const killProcess = spawn('npm', ['run', 'kill'], {
					cwd: this.utilsExecPath,
					stdio: 'inherit',
					shell: true,
				});

				killProcess.on('exit', (code) => {
					if (code === 0) {
						this.logger?.info('Server stopped successfully');
					} else {
						this.logger?.warn(`Kill script exited with code ${code}`);
					}
				});
			} catch (error) {
				this.logger?.warn(`Failed to run kill script: ${error}`);
			}
		}

		this.logger?.info('Plugin stopped');
	}
}




















