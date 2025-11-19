import CreateVirtualUriPlugin from '@magnolia/cli-create-virtual-uri-plugin';
import CreateRestEndpointPlugin from '@magnolia/cli-create-rest-endpoint-plugin';
import CreateLightModulePlugin from '@magnolia/cli-create-light-module-plugin';
import CreateComponentPlugin from '@magnolia/cli-create-component-plugin';
import CreatePagePlugin from '@magnolia/cli-create-page-plugin';
import CreateAppPlugin from '@magnolia/cli-create-app-plugin';
import CreateBlockPlugin from '@magnolia/cli-create-block-plugin';
import StartCustomPlugin from './utils/mgnl/cli-start-custom-plugin.js';
import ContentTransferPlugin from './utils/mgnl/cli-content-transfer-plugin.js';
export default {
	lightModule: 'tbscg',
	// Global properties used by plugins
	lightModulesPath: './light-modules',
	webapp: './magnolia/magnolia-webapp',
	// Plugins
	plugins: [
		new CreateVirtualUriPlugin(),
		new CreateRestEndpointPlugin(),
		new CreateLightModulePlugin({}),
		new CreateComponentPlugin({
			templateEngine: 'freemarker',
		}),
		new CreatePagePlugin({
			templateEngine: 'freemarker',
		}),
		new CreateAppPlugin(),
		new CreateBlockPlugin(),
		new StartCustomPlugin(),
		new ContentTransferPlugin(),
	],
	// Logger configuration
	logger: {
		filename: './mgnl.error.log',
		fileLevel: 'warn',
		consoleLevel: 'debug',
	},
	// Analytics configuration
	analytics: {
		enabled: true,
	},
};
