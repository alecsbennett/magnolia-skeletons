import { Option } from 'commander';
import { PluginTemplate } from '@magnolia/cli-plugin-template';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStartxInvocation } from './startx-invocation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const readStartxVersion = () => {
	const versionFile = path.join(PROJECT_ROOT, '.mgnl-startx-version');
	try {
		return readFileSync(versionFile, 'utf-8').trim() || '1.2.0';
	} catch {
		return '1.2.0';
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
		const invocation = createStartxInvocation(options);
		const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

		this.logger?.info(`Running: npm run ${invocation.script} in ${this.utilsExecPath}`);
		this.logger?.info(`Instance mode: ${invocation.instanceMode}`);

		this.npmProcess = spawn(npmCommand, ['run', invocation.script], {
			cwd: this.utilsExecPath,
			stdio: 'inherit',
			shell: process.platform === 'win32',
			env: {
				...process.env,
				...invocation.env,
			},
		});

		const code = await new Promise((resolve, reject) => {
			this.npmProcess.on('error', reject);
			this.npmProcess.on('exit', (exitCode) => resolve(exitCode));
		});
		this.npmProcess = null;
		if (code !== 0 && code !== null) {
			throw new Error(`npm run ${invocation.script} exited with code ${code}`);
		}
	}

	async stop() {
		this.logger?.info('Stopping Magnolia server...');

		if (this.npmProcess && !this.npmProcess.killed) {
			// Send SIGINT to npm process, which should propagate to child processes
			this.npmProcess.kill('SIGINT');
		}

		const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const code = await new Promise((resolve) => {
			const killProcess = spawn(npmCommand, ['run', 'kill'], {
				cwd: this.utilsExecPath,
				stdio: 'inherit',
				shell: process.platform === 'win32',
			});
			killProcess.on('error', () => resolve(1));
			killProcess.on('exit', (exitCode) => resolve(exitCode));
		});
		if (code === 0) this.logger?.info('Server stopped successfully');
		else this.logger?.warn(`Kill script exited with code ${code}`);

		this.logger?.info('Plugin stopped');
	}
}




















