import { execFile } from "child_process";

const notifyOnMacOS = ({ title, message, sound }) => new Promise((resolve, reject) => {
	// Use macOS' built-in notification support instead of node-notifier's bundled
	// terminal-notifier binary, which may not match the machine's architecture.
	const script = sound
		? `on run argv
	display notification (item 1 of argv) with title (item 2 of argv) sound name "default"
end run`
		: `on run argv
	display notification (item 1 of argv) with title (item 2 of argv)
end run`;

	execFile("/usr/bin/osascript", ["-e", script, "--", message, title], (error) => {
		if (error) reject(error);
		else resolve();
	});
});

const notifyWithNodeNotifier = async (options) => {
	const notifierModule = await import("node-notifier");
	const notifier = notifierModule.default ?? notifierModule;

	return new Promise((resolve, reject) => {
		try {
			notifier.notify(options, (error) => {
				if (error) reject(error);
				else resolve();
			});
		} catch (error) {
			reject(error);
		}
	});
};

export const showDesktopNotification = async (options) => {
	if (process.platform === "darwin") {
		return notifyOnMacOS(options);
	}

	// Preserve the existing, working Windows implementation. node-notifier also
	// provides the appropriate native backend for supported Linux desktops.
	return notifyWithNodeNotifier(options);
};
