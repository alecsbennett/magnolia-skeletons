import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get project root (two levels up from utils/exec)
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PROPERTIES_FILE = path.join(PROJECT_ROOT, "magnolia-cargo.properties");

/**
 * Parse properties file
 */
const parseProperties = (content) => {
	const props = {};
	const lines = content.split("\n");
	
	for (const line of lines) {
		// Skip comments and empty lines
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		
		// Parse key=value
		const equalIndex = trimmed.indexOf("=");
		if (equalIndex === -1) continue;
		
		const key = trimmed.substring(0, equalIndex).trim();
		const value = trimmed.substring(equalIndex + 1).trim();
		
		// Convert boolean strings
		if (value === "true") {
			props[key] = true;
		} else if (value === "false") {
			props[key] = false;
		} else if (!isNaN(value) && value !== "") {
			// Convert numbers
			props[key] = Number(value);
		} else {
			props[key] = value;
		}
	}
	
	return props;
};

/**
 * Resolve path relative to project root
 */
const resolvePath = (relativePath) => {
	if (path.isAbsolute(relativePath)) {
		return relativePath;
	}
	return path.resolve(PROJECT_ROOT, relativePath);
};

/**
 * Get property value with environment variable override
 */
const getProperty = (props, key, defaultValue = undefined) => {
	// Check environment variable first (uppercase with dots replaced by underscores)
	const envKey = key.replace(/\./g, "_").toUpperCase();
	if (process.env[envKey] !== undefined) {
		const envValue = process.env[envKey];
		if (envValue === "true") return true;
		if (envValue === "false") return false;
		if (!isNaN(envValue)) return Number(envValue);
		return envValue;
	}
	
	// Return property value or default
	return props[key] !== undefined ? props[key] : defaultValue;
};

/**
 * Load configuration from properties file
 */
export const loadConfig = async () => {
	let props = {};
	
	try {
		const content = await fs.readFile(PROPERTIES_FILE, "utf-8");
		props = parseProperties(content);
	} catch (error) {
		if (error.code === "ENOENT") {
			console.warn(`⚠️  Properties file not found: ${PROPERTIES_FILE}`);
			console.warn(`   Using default configuration. Create ${PROPERTIES_FILE} to customize.`);
		} else {
			console.error(`❌ Error reading properties file: ${error.message}`);
		}
	}
	
	// Build configuration object
	const config = {
		// Instance type
		instanceType: getProperty(props, "magnolia.instance.type", "author"),
		defaultInstance: getProperty(props, "magnolia.instance.default", "author"),
		
		// Ports
		ports: {
			author: {
				cargo: getProperty(props, "author.port", 8080),
				rmi: getProperty(props, "author.rmi.port", 8206),
				shutdown: getProperty(props, "author.shutdown.port", 8005),
				ajp: getProperty(props, "author.ajp.port", 8009),
			},
			runtime: {
				cargo: getProperty(props, "runtime.port", 8081),
				rmi: getProperty(props, "runtime.rmi.port", 8207),
				shutdown: getProperty(props, "runtime.shutdown.port", 8006),
				ajp: getProperty(props, "runtime.ajp.port", 8010),
			},
			maildev: {
				smtp: getProperty(props, "maildev.smtp.port", 1025),
				ui: getProperty(props, "maildev.ui.port", 1080),
			},
		},
		
		// MailDev
		maildev: {
			enabled: getProperty(props, "maildev.enabled", true),
			smtpPort: getProperty(props, "maildev.smtp.port", 1025),
			uiPort: getProperty(props, "maildev.ui.port", 1080),
			url: getProperty(props, "maildev.url", "http://localhost:1080"),
		},
		
		// Paths
		paths: {
			projectRoot: PROJECT_ROOT,
			workingDir: resolvePath(getProperty(props, "paths.working.dir", "magnolia/magnolia-webapp")),
			tomcatBase: resolvePath(getProperty(props, "paths.tomcat.base", "tomcat")),
			logsBase: resolvePath(getProperty(props, "paths.logs.base", "tomcat/logs")),
			reposBase: resolvePath(getProperty(props, "paths.repos.base", "tomcat/Repos")),
			cargoBase: resolvePath(getProperty(props, "paths.cargo.base", "tomcat")),
			author: {
				repos: resolvePath(getProperty(props, "author.repos.dir", "tomcat/Repos/author")),
				logs: resolvePath(getProperty(props, "author.logs.dir", "tomcat/logs/author")),
				cargoHome: resolvePath(getProperty(props, "author.cargo.home", "tomcat/cargo-author")),
				contextPath: getProperty(props, "author.context.path", "/author"),
				serverUrl: getProperty(props, "author.server.url", "http://localhost:8080/author/.magnolia/jcrlogin"),
			},
			runtime: {
				repos: resolvePath(getProperty(props, "runtime.repos.dir", "tomcat/Repos/public")),
				logs: resolvePath(getProperty(props, "runtime.logs.dir", "tomcat/logs/public")),
				cargoHome: resolvePath(getProperty(props, "runtime.cargo.home", "tomcat/cargo-runtime")),
				contextPath: getProperty(props, "runtime.context.path", "/"),
				serverUrl: getProperty(props, "runtime.server.url", "http://localhost:8081/.magnolia/jcrlogin"),
			},
		},
		
		// Flags
		flags: {
			clearLogs: getProperty(props, "flags.clear.logs", true),
			clearJcrLocks: getProperty(props, "flags.clear.jcr.locks", true),
			openBrowser: getProperty(props, "flags.open.browser", false),
			forceRestart: getProperty(props, "flags.force.restart", false),
			verboseDebug: getProperty(props, "flags.verbose.debug", false),
			quietHeartbeat: getProperty(props, "flags.quiet.heartbeat", true),
			showToasts: getProperty(props, "flags.show.toasts", true),
		},
		
		// Intervals
		intervals: {
			poll: getProperty(props, "intervals.poll", 1000),
			heartbeat: getProperty(props, "intervals.heartbeat", 30000),
			startupTimeout: getProperty(props, "intervals.startup.timeout", 1800000),
		},
		
		// Maven
		maven: {
			command: getProperty(props, "maven.command", "mvn"),
			profiles: {
				author: getProperty(props, "maven.profile.author", "author"),
				runtime: getProperty(props, "maven.profile.runtime", "runtime"),
			},
		},
		
		// Logging
		logging: {
			fileName: getProperty(props, "log.file.name", "tomcat.log"),
			// Fix backslashes: properties file may have \\ which needs to become \ for regex
			startupPattern: (() => {
				const patternStr = getProperty(props, "log.startup.pattern", "Server startup in \\[?\\d+\\]? milliseconds|Started SocketConnector");
				// Replace double backslashes with single backslashes for proper regex escaping
				const correctedPattern = patternStr.replace(/\\\\/g, '\\');
				return new RegExp(correctedPattern, "i");
			})(),
		},
		
		// PID Files
		pids: {
			author: path.resolve(__dirname, getProperty(props, "pid.file.author", ".cargo.author.pid")),
			runtime: path.resolve(__dirname, getProperty(props, "pid.file.runtime", ".cargo.runtime.pid")),
			maildev: path.resolve(__dirname, getProperty(props, "pid.file.maildev", ".maildev.pid")),
		},
		
		// Notifications
		notifications: {
			titlePrefix: getProperty(props, "notification.title.prefix", "🚀"),
			appId: getProperty(props, "notification.app.id", "Magnolia Server Loader"),
			timeout: getProperty(props, "notification.timeout", 30),
			sound: getProperty(props, "notification.sound", true),
			wait: getProperty(props, "notification.wait", true),
		},
		
		// Magnolia Enterprise License
		license: {
			owner: getProperty(props, "magnolia.license.owner", ""),
			key: getProperty(props, "magnolia.license.key", ""),
		},
	};
	
	return config;
};

export default loadConfig;

