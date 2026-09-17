const boolEnv = (value) => (value ? "true" : undefined);

/**
 * Map Magnolia CLI options to one canonical npm start invocation.
 * Keeping the mapping separate makes combinations such as --open --restart
 * work without multiplying npm scripts.
 */
export const createStartxInvocation = (options = {}) => {
	const instanceMode = options.both ? "both" : options.public ? "public" : "author";
	const env = {
		MAGNOLIA_INSTANCE_MODE: instanceMode,
		OPEN_BROWSER: boolEnv(options.open),
		FLAGS_CLEAR_LOGS: options.noclean ? "false" : undefined,
		FORCE_RESTART: boolEnv(options.restart),
		CLEAR_JCR_LOCKS: boolEnv(options.clearlocks),
		MAILDEV_ENABLED: options.nomail ? "false" : undefined,
	};

	return {
		script: "start",
		instanceMode,
		env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
	};
};
