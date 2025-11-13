package info.magnolia.jcrsync.filesystem;

import info.magnolia.jcrsync.config.SyncConfigurationService;
import info.magnolia.jcrsync.path.FilePathMappingService;
import info.magnolia.jcrsync.sync.BidirectionalSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import static java.nio.file.StandardWatchEventKinds.*;

/**
 * Service for watching filesystem changes using Java NIO WatchService.
 */
public class FileSystemWatcherService {
    
    private static final Logger log = LoggerFactory.getLogger(FileSystemWatcherService.class);
    
    private final SyncConfigurationService configService;
    private final FilePathMappingService pathMappingService;
    private final BidirectionalSyncService syncService;
    private final Path dataDirectory;
    
    private WatchService watchService;
    private Map<WatchKey, Path> watchKeys;
    private ExecutorService executorService;
    private AtomicBoolean running;
    private AtomicBoolean readyToProcess; // Flag to prevent processing events during startup
    private Thread watchThread;
    
    public FileSystemWatcherService(
            SyncConfigurationService configService,
            FilePathMappingService pathMappingService,
            BidirectionalSyncService syncService) {
        this.configService = configService;
        this.pathMappingService = pathMappingService;
        this.syncService = syncService;
        this.dataDirectory = configService.getDataDirectory();
        this.watchKeys = new HashMap<>();
        this.running = new AtomicBoolean(false);
        this.readyToProcess = new AtomicBoolean(false); // Start as false, will be set to true after initial sync
    }
    
    /**
     * Start watching the filesystem for changes.
     */
    public void start() throws IOException {
        if (running.get()) {
            log.warn("File system watcher already running");
            return;
        }
        
        watchService = FileSystems.getDefault().newWatchService();
        executorService = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "FileSystemWatcher");
            t.setDaemon(true);
            return t;
        });
        
        // Register watch for data directory and all subdirectories
        registerDirectory(dataDirectory);
        
        // Register existing subdirectories recursively
        if (Files.exists(dataDirectory)) {
            Files.walkFileTree(dataDirectory, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                    registerDirectory(dir);
                    return FileVisitResult.CONTINUE;
                }
            });
        }
        
        running.set(true);
        
        // Start watching thread
        watchThread = new Thread(this::watchLoop, "FileSystemWatcher-Thread");
        watchThread.setDaemon(true);
        watchThread.start();
        
        log.info("Started file system watcher for directory: {}", dataDirectory);
    }
    
    /**
     * Register a directory for watching.
     */
    private void registerDirectory(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            Files.createDirectories(dir);
        }
        
        if (!Files.isDirectory(dir)) {
            return;
        }
        
        WatchKey key = dir.register(watchService, 
            ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
        watchKeys.put(key, dir);
        log.debug("Registered watch for directory: {}", dir);
    }
    
    /**
     * Main watch loop that processes filesystem events.
     */
    private void watchLoop() {
        while (running.get()) {
            try {
                WatchKey key = watchService.take();
                
                Path dir = watchKeys.get(key);
                if (dir == null) {
                    log.warn("Unknown watch key, skipping");
                    key.reset();
                    continue;
                }
                
                for (WatchEvent<?> event : key.pollEvents()) {
                    processEvent(dir, event);
                }
                
                // Reset key and remove if directory no longer exists
                boolean valid = key.reset();
                if (!valid) {
                    watchKeys.remove(key);
                }
                
            } catch (InterruptedException e) {
                log.info("File system watcher interrupted, stopping");
                break;
            } catch (Exception e) {
                log.error("Error in file system watcher loop", e);
            }
        }
    }
    
    /**
     * Process a filesystem event.
     */
    private void processEvent(Path dir, WatchEvent<?> event) {
        // Don't process events until ready (after initial sync completes)
        if (!readyToProcess.get()) {
            log.debug("File system watcher not ready yet, skipping event: {}", event.kind());
            return;
        }
        
        WatchEvent.Kind<?> kind = event.kind();
        
        if (kind == OVERFLOW) {
            log.warn("File system watcher overflow event");
            return;
        }
        
        @SuppressWarnings("unchecked")
        WatchEvent<Path> ev = (WatchEvent<Path>) event;
        Path fileName = ev.context();
        Path fullPath = dir.resolve(fileName);
        
        // Skip settings.properties - it's a configuration file, not content
        if (fileName.toString().equals("settings.properties")) {
            log.debug("Skipping settings.properties file");
            return;
        }
        
        // Skip if path should be excluded
        FilePathMappingService.WorkspacePath workspacePath = 
            pathMappingService.filesystemToJcr(dataDirectory, fullPath);
        
        if (workspacePath != null && 
            configService.isPathExcluded(workspacePath.getJcrPath())) {
            log.debug("Skipping excluded path: {}", fullPath);
            return;
        }
        
        // Handle directory creation - register it for watching
        if (kind == ENTRY_CREATE && Files.isDirectory(fullPath)) {
            try {
                registerDirectory(fullPath);
            } catch (IOException e) {
                log.error("Failed to register new directory: {}", fullPath, e);
            }
        }
        
        // Only process XML files
        if (!fileName.toString().endsWith(".xml")) {
            return;
        }
        
        // Create filesystem event and process
        FileSystemEvent fsEvent = new FileSystemEvent(fullPath, kind);
        syncService.processFileSystemEvent(fsEvent);
        
        log.debug("Processed file system event: {} - {}", kind, fullPath);
    }
    
    /**
     * Mark the watcher as ready to process events.
     * Should be called after initial sync completes to prevent race conditions.
     */
    public void setReadyToProcess(boolean ready) {
        this.readyToProcess.set(ready);
        log.info("File system watcher ready to process events: {}", ready);
    }
    
    /**
     * Stop watching the filesystem.
     */
    public void stop() {
        if (!running.get()) {
            return;
        }
        
        running.set(false);
        
        if (watchThread != null) {
            watchThread.interrupt();
            try {
                watchThread.join(5000);
            } catch (InterruptedException e) {
                log.warn("Interrupted while stopping watch thread", e);
            }
        }
        
        if (watchService != null) {
            try {
                watchService.close();
            } catch (IOException e) {
                log.error("Error closing watch service", e);
            }
        }
        
        if (executorService != null) {
            executorService.shutdown();
        }
        
        watchKeys.clear();
        
        log.info("Stopped file system watcher");
    }
    
    /**
     * Check if watcher is running.
     */
    public boolean isRunning() {
        return running.get();
    }
    
    /**
     * Container for filesystem event information.
     */
    public static class FileSystemEvent {
        private final Path filePath;
        private final WatchEvent.Kind<?> eventKind;
        
        public FileSystemEvent(Path filePath, WatchEvent.Kind<?> eventKind) {
            this.filePath = filePath;
            this.eventKind = eventKind;
        }
        
        public Path getFilePath() {
            return filePath;
        }
        
        public WatchEvent.Kind<?> getEventKind() {
            return eventKind;
        }
        
        @Override
        public String toString() {
            return filePath + " [" + eventKind + "]";
        }
    }
}

