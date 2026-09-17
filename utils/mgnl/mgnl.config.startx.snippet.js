// Add to your mgnl.config.js if the installer could not auto-patch:
//
// 1. Import at the top:
import StartCustomPlugin from './utils/mgnl/cli-start-custom-plugin.js';

// 2. Add to the plugins array:
export default {
	// ...existing config...
	plugins: [
		// ...existing plugins...
		new StartCustomPlugin(),
	],
};
