package info.magnolia.jcrsync;

import info.magnolia.jcrsync.config.SyncConfigurationService;
import info.magnolia.jcrsync.conflict.ConflictResolutionService;
import info.magnolia.jcrsync.filesystem.FileSystemWatcherService;
import info.magnolia.jcrsync.jcr.JcrSyncObservationListener;
import info.magnolia.jcrsync.path.FilePathMappingService;
import info.magnolia.jcrsync.sync.BidirectionalSyncService;
import info.magnolia.jcrsync.xml.XmlSerializationService;
import info.magnolia.repository.RepositoryManager;
import info.magnolia.context.MgnlContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.jcr.Session;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Main module class for JCR Filesystem Synchronization.
 * This class is instantiated by Magnolia's module framework.
 */
public class JcrFilesystemSyncModule {
    
    private static final Logger log = LoggerFactory.getLogger(JcrFilesystemSyncModule.class);
    
    // Static initializer to verify class is loaded
    static {
        log.info("JcrFilesystemSyncModule class loaded");
    }
    
    // Constructor to verify instance is created
    public JcrFilesystemSyncModule() {
        log.info("JcrFilesystemSyncModule instance created");
        // Initialize immediately in constructor since Magnolia 6.4 doesn't call init()/start()
        initializeInConstructor();
    }
    
    /**
     * Initialize module in constructor since Magnolia 6.4 may not call lifecycle methods.
     */
    private void initializeInConstructor() {
        try {
            log.info("Initializing JCR Filesystem Sync Module in constructor");
            
                // Initialize services
                configService = new SyncConfigurationService();
                // pathMappingService will be initialized after config is loaded
                xmlService = new XmlSerializationService(configService);
                conflictService = new ConflictResolutionService();
            
            jcrListeners = new ArrayList<>();
            
            // Start initialization in a separate thread to allow Magnolia to finish startup
            Thread initThread = new Thread(() -> {
                try {
                    // Wait longer for Magnolia to finish bootstrapping and initializing
                    // Bootstrap can take 20-30 seconds, so wait 35 seconds to ensure it completes
                    Thread.sleep(35000);
                    startModule();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    log.error("Module initialization thread interrupted", e);
                } catch (Exception e) {
                    log.error("Error in delayed module initialization", e);
                }
            });
            initThread.setDaemon(true);
            initThread.setName("JcrFilesystemSyncModule-init");
            initThread.start();
            
        } catch (Exception e) {
            log.error("Error initializing module in constructor", e);
        }
    }
    
    /**
     * Start the module (called from delayed thread).
     */
    private void startModule() {
        log.info("Starting JCR Filesystem Sync Module");
        
        try {
            // Try to get RepositoryManager from Magnolia's Components
            try {
                repositoryManager = info.magnolia.objectfactory.Components.getComponent(RepositoryManager.class);
                log.info("Successfully obtained RepositoryManager from Components");
            } catch (Exception e) {
                log.error("Failed to get RepositoryManager from Components: {}", e.getMessage(), e);
                return;
            }
            
            if (repositoryManager == null) {
                log.error("RepositoryManager is null, cannot start sync");
                return;
            }
            
            // Load configuration - try multiple locations
            File settingsFile = null;
            String magnoliaHome = System.getProperty("magnolia.home");
            String userDir = System.getProperty("user.dir");
            
            // Try various paths relative to project root and magnolia.home
            String[] possiblePaths = {
                "data/settings.properties",  // Relative to current working directory
                "../data/settings.properties",  // One level up
                "../../data/settings.properties",  // Two levels up (from tomcat/cargo-author)
                "../../../data/settings.properties",  // Three levels up
                userDir + "/data/settings.properties",  // Absolute from user.dir
                userDir + "/../data/settings.properties"
            };
            
            // Add magnolia.home paths if available
            if (magnoliaHome != null && !magnoliaHome.isEmpty()) {
                String[] homePaths = {
                    magnoliaHome + "/../data/settings.properties",
                    magnoliaHome + "/data/settings.properties",
                    magnoliaHome + "/../../data/settings.properties"
                };
                String[] combined = new String[possiblePaths.length + homePaths.length];
                System.arraycopy(possiblePaths, 0, combined, 0, possiblePaths.length);
                System.arraycopy(homePaths, 0, combined, possiblePaths.length, homePaths.length);
                possiblePaths = combined;
            }
            
            log.info("Searching for settings.properties in {} locations", possiblePaths.length);
            for (String path : possiblePaths) {
                File testFile = new File(path);
                if (testFile.exists() && testFile.isFile()) {
                    settingsFile = testFile;
                    log.info("Found settings file at: {}", testFile.getAbsolutePath());
                    break;
                }
            }
            
            if (settingsFile == null) {
                // Default to data/settings.properties relative to current directory
                settingsFile = new File("data/settings.properties");
                log.warn("Settings file not found in any searched location, will use default: {}", 
                    settingsFile.getAbsolutePath());
            }
            
            configService.initialize(settingsFile);
            
            // Set project root for resolving data directory
            // Try to find project root by looking for settings.properties parent directory
            Path projectRoot = null;
            if (settingsFile != null && settingsFile.exists()) {
                Path settingsPath = settingsFile.toPath().getParent();
                if (settingsPath != null && settingsPath.getFileName().toString().equals("data")) {
                    projectRoot = settingsPath.getParent();
                } else {
                    // Try to find project root by going up from current working directory
                    Path currentDir = Paths.get(System.getProperty("user.dir"));
                    // Look for data directory
                    Path dataDir = currentDir.resolve("data");
                    if (Files.exists(dataDir)) {
                        projectRoot = currentDir;
                    } else {
                        // Try going up a few levels
                        for (int i = 0; i < 5; i++) {
                            Path testData = currentDir.resolve("data");
                            if (Files.exists(testData)) {
                                projectRoot = currentDir;
                                break;
                            }
                            currentDir = currentDir.getParent();
                            if (currentDir == null) break;
                        }
                    }
                }
            }
            
            if (projectRoot != null) {
                configService.setProjectRoot(projectRoot);
                log.info("Set project root to: {}", projectRoot.toAbsolutePath());
            } else {
                log.warn("Could not determine project root, data directory will be relative to current working directory");
            }
            
            if (!configService.isSyncEnabled()) {
                log.info("Sync disabled in configuration");
                return;
            }
            
            // Initialize path mapping service with config
            pathMappingService = new FilePathMappingService(configService);
            
            // Initialize sync service
            syncService = new BidirectionalSyncService(
                configService,
                pathMappingService,
                xmlService,
                conflictService,
                repositoryManager
            );
            
            // Initialize file system watcher
            fileSystemWatcher = new FileSystemWatcherService(
                configService,
                pathMappingService,
                syncService
            );
            fileSystemWatcher.start();
            // Don't process filesystem events yet - wait until after initial sync
            
            // Register JCR observation listeners for each workspace
            // Execute in system context to get authenticated sessions
            try {
                info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                    try {
                        String[] workspaceNames = repositoryManager.getWorkspaceNames().toArray(new String[0]);
                        
                        for (String workspaceName : workspaceNames) {
                            if (configService.isWorkspaceIncluded(workspaceName)) {
                                registerJcrListener(workspaceName, repositoryManager);
                            }
                        }
                    } catch (Exception e) {
                        log.error("Error registering JCR listeners in system context", e);
                    }
                    return null;
                });
            } catch (Exception e) {
                log.error("Error executing in system context for listener registration", e);
            }
            
            // Perform initial sync if enabled, or scan filesystem for existing files if disabled
            if (configService.isInitialSyncEnabled()) {
                syncService.performInitialSync();
            } else {
                // When initial sync is disabled, scan filesystem for existing files and import them
                // This ensures filesystem content is imported even when initial sync is off
                syncService.scanFilesystemAndImport();
            }
            
            // Now mark filesystem watcher as ready to process events
            // This prevents race conditions where filesystem events fire before initial sync completes
            fileSystemWatcher.setReadyToProcess(true);
            
            log.info("JCR Filesystem Sync Module started successfully");
            
        } catch (Exception e) {
            log.error("Error starting JCR Filesystem Sync Module", e);
        }
    }
    
    private SyncConfigurationService configService;
    private FilePathMappingService pathMappingService;
    private XmlSerializationService xmlService;
    private ConflictResolutionService conflictService;
    private BidirectionalSyncService syncService;
    private FileSystemWatcherService fileSystemWatcher;
    private List<JcrSyncObservationListener> jcrListeners;
    private RepositoryManager repositoryManager;
    
    /**
     * Set the repository manager. Called by Magnolia framework via dependency injection.
     */
    public void setRepositoryManager(RepositoryManager repositoryManager) {
        this.repositoryManager = repositoryManager;
    }
    
    /**
     * Initialize the module. Called by Magnolia framework (if supported).
     */
    public void init() {
        log.info("init() called - but initialization already done in constructor");
    }
    
    /**
     * Start the module. Called by Magnolia framework (if supported).
     */
    public void start() {
        log.info("start() called - but startup already done in constructor");
        // If start() is called, ensure module is started
        if (syncService == null) {
            startModule();
        }
    }
    
    /**
     * Register a JCR observation listener for a workspace.
     */
    private void registerJcrListener(String workspaceName, RepositoryManager repositoryManager) {
        try {
            // Use MgnlContext to get a system session
            Session session = MgnlContext.getJCRSession(workspaceName);
            
            JcrSyncObservationListener listener = new JcrSyncObservationListener(
                workspaceName,
                session,
                configService,
                syncService
            );
            
            listener.register();
            jcrListeners.add(listener);
            
            log.info("Registered JCR listener for workspace: {}", workspaceName);
            
        } catch (RepositoryException e) {
            log.error("Failed to register JCR listener for workspace: {}", workspaceName, e);
        }
    }
    
    /**
     * Stop the module. Called by Magnolia framework.
     */
    public void stop() {
        log.info("Shutting down JCR Filesystem Sync Module");
        
        // Unregister JCR listeners
        for (JcrSyncObservationListener listener : jcrListeners) {
            listener.unregister();
        }
        jcrListeners.clear();
        
        // Stop file system watcher
        if (fileSystemWatcher != null) {
            fileSystemWatcher.stop();
        }
        
        // Shutdown sync service
        if (syncService != null) {
            syncService.shutdown();
        }
        
        log.info("JCR Filesystem Sync Module shut down");
    }
}

