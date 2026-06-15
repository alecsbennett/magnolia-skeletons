# Magnolia Cargo Configuration

The `magnolia-cargo.properties` file in the project root centralizes all configuration for the Cargo utility scripts.

## Configuration File Location

The properties file is located at: `magnolia-cargo.properties` (project root)

## Environment Variable Overrides

All properties can be overridden using environment variables. Convert property keys to uppercase and replace dots with underscores.

Examples:
- `flags.clear.logs` → `FLAGS_CLEAR_LOGS=true`
- `maildev.enabled` → `MAILDEV_ENABLED=false`
- `author.port` → `AUTHOR_PORT=8080`

## Configuration Sections

### Instance Configuration
- `magnolia.instance.type` - Default instance type (author/public/both)
- `magnolia.instance.default` - Fallback default instance type

### Ports Configuration
- `author.port` - Author instance HTTP port (default: 8080)
- `author.rmi.port` - Author instance RMI port (default: 8206)
- `author.shutdown.port` - Author instance shutdown port (default: 8005)
- `author.ajp.port` - Author instance AJP port (default: 8009)
- `runtime.port` - Runtime instance HTTP port (default: 8081)
- `runtime.rmi.port` - Runtime instance RMI port (default: 8207)
- `runtime.shutdown.port` - Runtime instance shutdown port (default: 8006)
- `runtime.ajp.port` - Runtime instance AJP port (default: 8010)

### MailDev Configuration
- `maildev.enabled` - Enable/disable MailDev server (default: true)
- `maildev.smtp.port` - MailDev SMTP port (default: 1025)
- `maildev.ui.port` - MailDev web UI port (default: 1080)
- `maildev.url` - MailDev web UI URL

### Paths Configuration
All paths are relative to the project root unless specified as absolute.

- `paths.working.dir` - Maven working directory (default: magnolia/magnolia-webapp)
- `paths.tomcat.base` - Base Tomcat directory (default: tomcat)
- `paths.logs.base` - Base logs directory (default: tomcat/logs)
- `paths.repos.base` - Base repositories directory (default: tomcat/Repos)
- `paths.cargo.base` - Base Cargo directory (default: tomcat)

#### Author Instance Paths
- `author.repos.dir` - Author repository directory
- `author.logs.dir` - Author logs directory
- `author.cargo.home` - Author Cargo home directory
- `author.context.path` - Author context path (default: /author)
- `author.server.url` - Author server URL

#### Runtime Instance Paths
- `runtime.repos.dir` - Runtime repository directory
- `runtime.logs.dir` - Runtime logs directory
- `runtime.cargo.home` - Runtime Cargo home directory
- `runtime.context.path` - Runtime context path (default: /)
- `runtime.server.url` - Runtime server URL

### Behavior Flags
All flags accept `true` or `false` values.

- `flags.clear.logs` - Clear logs before starting (default: true)
- `flags.clear.jcr.locks` - Clear JCR lock files before starting (default: true)
- `flags.open.browser` - Automatically open browser when ready (default: false)
- `flags.force.restart` - Force restart without prompt if server is running (default: false)
- `flags.verbose.debug` - Show verbose debug output (default: false)
- `flags.quiet.heartbeat` - Quiet heartbeat mode (default: true)
- `flags.show.toasts` - Show desktop toast notifications (default: true)

### Intervals (milliseconds)
- `intervals.poll` - Log polling interval (default: 1000)
- `intervals.heartbeat` - Heartbeat monitor interval (default: 30000)
- `intervals.startup.timeout` - Startup timeout (default: 1800000 = 30 minutes)

### Maven Configuration
- `maven.command` - Maven command (default: mvn)
- `maven.profile.author` - Author profile name (default: author)
- `maven.profile.runtime` - Runtime profile name (default: runtime)

### Magnolia Superuser Bootstrap
- `magnolia.superuser.bootstrap.password` - Password assigned to `superuser` when a repository is initialized for the first time

The value can be overridden with `MAGNOLIA_SUPERUSER_BOOTSTRAP_PASSWORD`.
Magnolia does not apply changes to this property after initial repository setup.

### Logging Configuration
- `log.file.name` - Log file name (default: tomcat.log)
- `log.startup.pattern` - Regex pattern to detect server startup

### PID Files
- `pid.file.author` - Author PID file name (default: .cargo.author.pid)
- `pid.file.runtime` - Runtime PID file name (default: .cargo.runtime.pid)
- `pid.file.maildev` - MailDev PID file name (default: .maildev.pid)
- `pid.file.location` - PID files directory (default: utils/exec)

### Notification Configuration
- `notification.title.prefix` - Notification title prefix (default: 🚀)
- `notification.app.id` - Notification app ID (default: Magnolia Server Loader)
- `notification.timeout` - Notification timeout in seconds (default: 30)
- `notification.sound` - Play notification sound (default: true)
- `notification.wait` - Wait for notification interaction (default: true)

## Usage Examples

### Disable MailDev
```properties
maildev.enabled=false
```
Or via environment variable:
```bash
MAILDEV_ENABLED=false npm start
```

### Disable Toast Notifications
```properties
flags.show.toasts=false
```
Or via environment variable:
```bash
FLAGS_SHOW_TOASTS=false npm start
```

### Keep Logs (Don't Clear)
```properties
flags.clear.logs=false
```
Or via environment variable:
```bash
FLAGS_CLEAR_LOGS=false npm start
```

### Change Author Port
```properties
author.port=9090
```

### Enable Auto-Open Browser
```properties
flags.open.browser=true
```

### Start both instances
```bash
npm run start:both
```

The Magnolia CLI exposes the same modes:
```bash
./mgnl startx --author
./mgnl startx --public
./mgnl startx --both
```

### Verbose Debug Mode
```properties
flags.verbose.debug=true
```

## Notes

- If the properties file doesn't exist, default values will be used
- Environment variables override properties file values
- Boolean values in properties file: use `true` or `false` (case-insensitive)
- Numeric values are automatically converted to numbers
- Paths can be relative (to project root) or absolute

