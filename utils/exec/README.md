# Magnolia Cargo Server Utilities

Self-contained utility scripts for managing the Magnolia Cargo server using modular npm scripts.

## Installation

```bash
cd utils/exec
npm install
```

## Architecture

The system uses **modular scripts** composed with `npm-run-all` for clean, maintainable execution:

- **Sequential execution** (`run-s`): Steps that must complete before the next
- **Parallel execution** (`run-p`): Steps that can run simultaneously

### Script Modules

| Script | Purpose | Runs In |
|--------|---------|---------|
| `scripts/check-server.mjs` | Check if server is already running | Sequential |
| `scripts/clean-locks.mjs` | Clear JCR lock files | Sequential |
| `scripts/clean-logs.mjs` | Clear log files | Sequential |
| `scripts/clean-cargo.mjs` | Clean Cargo directory | Sequential |
| `scripts/build.mjs` | Build parent Maven project | Sequential |
| `scripts/start-cargo.mjs` | Start Cargo server (keeps running) | Parallel |
| `scripts/monitor.mjs` | Monitor logs for startup completion | Parallel |
| `startMailDev.mjs` | Start MailDev server (keeps running) | Parallel |

## Usage

### Starting the Server

| Command | Description | NPM Script |
|---------|-------------|------------|
| **Basic start** | Full startup sequence | `npm start` |
| **Auto-open browser** | Opens browser when ready | `npm run start:open` |
| **Keep logs** | Skip log clearing | `npm run start:noclean` |
| **Auto restart** | Force restart if running | `npm run start:restart` |
| **Clear JCR locks** | Force clear JCR locks | `npm run start:clearlocks` |
| **No MailDev** | Start without MailDev | `npm run start:nomail` |

### Individual Scripts

You can run individual scripts directly:

```bash
npm run check-server    # Check if server is running
npm run clean:locks     # Clear JCR locks
npm run clean:logs      # Clear logs
npm run clean:cargo     # Clean Cargo directory
npm run build           # Build parent project
npm run start:cargo     # Start Cargo (keeps running)
npm run monitor         # Monitor logs (exits when ready)
npm run maildev         # Start MailDev separately
```

### Stopping the Server

**Normal shutdown:**
```bash
npm run kill
```

**Force kill all Java processes:**
```bash
npm run kill:force
```

**Kill MailDev only:**
```bash
npm run kill:maildev
```

### Restarting the Server

```bash
npm run restart        # Kill and start
npm run restart:open   # Kill and start with browser
```

## Startup Sequence

When you run `npm start`, the following happens:

1. **Sequential steps** (using `run-s`):
   - `check-server` - Verify no existing server
   - `clean:locks` - Clear JCR lock files (if enabled)
   - `clean:cargo` - Clean Cargo directory
   - `clean:logs` - Clear log files (if enabled)
   - `maildev` - Start MailDev server in background (if enabled)
   - `build` - Build parent Maven project

2. **Parallel steps** (using `run-p`):
   - `start:cargo` - Start Cargo server (keeps running)
   - `monitor` - Monitor logs for startup completion

The `monitor` script exits when startup is detected, while `start:cargo` and `maildev` keep running.

## Configuration

All configuration is managed through `magnolia-cargo.properties` in the project root. See `CONFIG.md` for details.

Key settings:
- `maildev.enabled` - Enable/disable MailDev (default: true)
- `flags.clear.logs` - Clear logs before starting (default: true)
- `flags.clear.jcr.locks` - Clear JCR locks (default: true)
- `flags.open.browser` - Auto-open browser (default: false)
- `flags.force.restart` - Force restart without prompt (default: false)

## Environment Variables

Environment variables can override properties file settings:

- `CLEAR_LOGS=false` - Skip log clearing
- `OPEN_BROWSER=true` - Auto-open browser
- `FORCE_RESTART=true` - Force restart without prompt
- `CLEAR_JCR_LOCKS=true` - Force clear JCR locks
- `MAILDEV_ENABLED=false` - Disable MailDev
- `MAGNOLIA_INSTANCE=author` - Set instance type

## Process Tracking

The system maintains PID files:
- `.cargo.author.pid` - Tracks Cargo and Tomcat PIDs for author instance
- `.maildev.pid` - Tracks MailDev PID

These files enable clean shutdowns and prevent multiple instances.

## Troubleshooting

**Server won't start (port in use):**
```bash
npm run kill
# or
npm run kill:force
```

**Check what's using a port:**
```bash
netstat -ano | findstr :8080  # Windows
lsof -i :8080                 # Unix/Mac
```

**Manual cleanup:**
```bash
rm .cargo.author.pid
rm .maildev.pid
```

## Platform Support

- ✅ Windows (netstat, taskkill)
- ✅ macOS (lsof, kill)
- ✅ Linux (lsof, kill)
