# JCR Filesystem Sync Module - Debugging Guide

## Logging Configuration

The module uses SLF4J logging. To enable debug logging, check your Magnolia logging configuration.

### Check Module Initialization

Look for these log messages in `tomcat/logs/author/tomcat.log`:

1. **Class Loading**: `JcrFilesystemSyncModule class loaded`
2. **Instance Creation**: `JcrFilesystemSyncModule instance created`
3. **Initialization**: `Initializing JCR Filesystem Sync Module`
4. **Startup**: `Starting JCR Filesystem Sync Module`
5. **Configuration**: `Loaded configuration from: ...`
6. **Workspace Registration**: `Registered JCR listener for workspace: <workspace>`
7. **Startup Complete**: `JCR Filesystem Sync Module started successfully`

### Check JCR Events

When you create/modify/delete a page, you should see:
- `JCR Event received: workspace=website, path=/pages/..., type=...`
- `Queued JCR event for sync: NODE_ADDED - /pages/... [website]`
- `Processing JCR event: NODE_ADDED - /pages/... [website]`
- `Starting sync for: jcr:website:/pages/...`
- `Synced JCR to filesystem: /pages/... -> data/website/pages/....xml`
- `Completed sync for: jcr:website:/pages/...`

### Common Issues

#### Module Not Starting

If you don't see "Starting JCR Filesystem Sync Module":
- Check if the module is loaded: Look for "JcrFilesystemSyncModule class loaded"
- Check module descriptor: Verify `META-INF/magnolia/jcr-filesystem-sync.xml` is correct
- Check dependencies: Ensure module is included in webapp

#### RepositoryManager Not Available

If you see "RepositoryManager not set":
- The module's `setRepositoryManager()` method may not be called by Magnolia
- This might require implementing a specific interface or using dependency injection

#### Events Not Received

If you don't see "JCR Event received":
- Check if listener is registered: Look for "Registered JCR observation listener"
- Check workspace inclusion: Verify workspace matches `include` pattern in `settings.properties`
- Check path exclusion: Verify path doesn't match `exclude` patterns

#### Sync Not Happening

If events are received but files aren't created:
- Check file permissions: Ensure data directory is writable
- Check path mapping: Verify `data.dir` setting in `settings.properties`
- Check for errors: Look for "Error syncing JCR to filesystem" messages

## Configuration

Edit `data/settings.properties`:

```properties
# Enable/disable synchronization
sync.enabled=true

# Debug logging (set to true for verbose logging)
sync.debug=true

# Workspace inclusion patterns (comma-separated regex)
include=.*

# Path exclusion patterns
exclude=jcr:system.*,.*/jcr:versionStorage.*

# Data directory
data.dir=data
```

## Manual Testing

1. **Check if module is loaded**: Search logs for "JcrFilesystemSyncModule"
2. **Create a test page**: Create a page in Magnolia Author
3. **Check logs**: Look for JCR event messages
4. **Check filesystem**: Look for XML file in `data/website/pages/...`
5. **Modify page**: Edit the page and check for sync
6. **Delete page**: Delete the page and check if XML file is removed

## Enabling Debug Logging

To see more detailed logs, configure your logging framework (logback/log4j) to set the logger level:

```xml
<logger name="info.magnolia.jcrsync" level="DEBUG"/>
```

Or in `logback.xml`:
```xml
<logger name="info.magnolia.jcrsync" level="DEBUG"/>
```

