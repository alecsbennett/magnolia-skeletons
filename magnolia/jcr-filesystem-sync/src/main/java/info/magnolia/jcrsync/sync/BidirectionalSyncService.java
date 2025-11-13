package info.magnolia.jcrsync.sync;

import info.magnolia.jcrsync.config.SyncConfigurationService;
import info.magnolia.jcrsync.conflict.ConflictResolutionService;
import info.magnolia.jcrsync.filesystem.FileSystemWatcherService;
import java.nio.file.WatchEvent;
import info.magnolia.jcrsync.jcr.JcrSyncObservationListener;
import info.magnolia.jcrsync.path.FilePathMappingService;
import info.magnolia.jcrsync.xml.XmlSerializationService;
import info.magnolia.repository.RepositoryManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.Node;
import javax.jcr.RepositoryException;
import javax.jcr.Session;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.HashSet;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.jcr.Property;

import static java.nio.file.StandardWatchEventKinds.*;

/**
 * Service that coordinates bidirectional synchronization between JCR and filesystem.
 * Prevents sync loops by tracking in-progress operations.
 */
public class BidirectionalSyncService {
    
    private static final Logger log = LoggerFactory.getLogger(BidirectionalSyncService.class);
    
    private final SyncConfigurationService configService;
    private final FilePathMappingService pathMappingService;
    private final XmlSerializationService xmlService;
    private final ConflictResolutionService conflictService;
    private final RepositoryManager repositoryManager;
    
    // Track in-progress syncs to prevent loops
    private final Set<String> inProgressSyncs = ConcurrentHashMap.newKeySet();
    
    // Track files we just wrote to prevent filesystem watcher from triggering
    private final Set<Path> recentlyWrittenFiles = Collections.synchronizedSet(new HashSet<>());
    
    private final ExecutorService executorService;
    
    public BidirectionalSyncService(
            SyncConfigurationService configService,
            FilePathMappingService pathMappingService,
            XmlSerializationService xmlService,
            ConflictResolutionService conflictService,
            RepositoryManager repositoryManager) {
        this.configService = configService;
        this.pathMappingService = pathMappingService;
        this.xmlService = xmlService;
        this.conflictService = conflictService;
        this.repositoryManager = repositoryManager;
        this.executorService = Executors.newFixedThreadPool(5, r -> {
            Thread t = new Thread(r, "SyncService-Worker");
            t.setDaemon(true);
            return t;
        });
    }
    
    /**
     * Process a JCR event and sync to filesystem.
     */
    public void processJcrEvent(JcrSyncObservationListener.JcrEvent event) {
        // Check if sync is enabled before processing
        if (!configService.isSyncEnabled()) {
            log.debug("Sync disabled, ignoring JCR event: {} - {} [{}]", 
                event.getEventType(), event.getPath(), event.getWorkspace());
            return;
        }
        
        log.info("Processing JCR event: {} - {} [{}]", 
            event.getEventType(), event.getPath(), event.getWorkspace());
        
        String syncKey = "jcr:" + event.getWorkspace() + ":" + event.getPath();
        
        if (inProgressSyncs.contains(syncKey)) {
            log.info("Sync already in progress, skipping: {}", syncKey);
            return;
        }
        
        executorService.submit(() -> {
            try {
                inProgressSyncs.add(syncKey);
                log.info("Starting sync for: {}", syncKey);
                syncJcrToFilesystem(event);
                log.info("Completed sync for: {}", syncKey);
            } catch (Exception e) {
                log.error("Error syncing JCR to filesystem: {}", event, e);
            } finally {
                inProgressSyncs.remove(syncKey);
            }
        });
    }
    
    /**
     * Process a filesystem event and sync to JCR.
     */
    public void processFileSystemEvent(FileSystemWatcherService.FileSystemEvent event) {
        // Skip if this is a file we just wrote (prevent sync loops)
        if (recentlyWrittenFiles.contains(event.getFilePath())) {
            log.debug("Skipping filesystem event for recently written file: {}", event.getFilePath());
            return;
        }
        
        FilePathMappingService.WorkspacePath workspacePath =
            pathMappingService.filesystemToJcr(configService.getDataDirectory(), event.getFilePath());

        if (workspacePath == null) {
            log.warn("Could not map filesystem path to JCR: {}", event.getFilePath());
            return;
        }
        
        String syncKey = "fs:" + workspacePath.getWorkspace() + ":" + workspacePath.getJcrPath();
        
        if (inProgressSyncs.contains(syncKey)) {
            log.debug("Sync already in progress, skipping: {}", syncKey);
            return;
        }
        
        executorService.submit(() -> {
            try {
                inProgressSyncs.add(syncKey);
                syncFilesystemToJcr(workspacePath, event);
            } catch (Exception e) {
                log.error("Error syncing filesystem to JCR: {}", event, e);
            } finally {
                inProgressSyncs.remove(syncKey);
            }
        });
    }
    
    /**
     * Sync JCR node to filesystem.
     */
    private void syncJcrToFilesystem(JcrSyncObservationListener.JcrEvent event) {
        try {
            // Execute in system context to get authenticated session
            info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                try {
                    Session session = info.magnolia.context.MgnlContext.getJCRSession(event.getWorkspace());
                    String nodePath = event.getPath();
                    syncJcrToFilesystemInternal(session, event, nodePath);
                } catch (Exception e) {
                    log.error("Error syncing JCR to filesystem in system context: {}", event, e);
                }
                return null;
            });
        } catch (Exception e) {
            log.error("Error syncing JCR to filesystem: {}", event, e);
        }
    }
    
    /**
     * Internal method to sync JCR node to filesystem (called within system context).
     */
    private void syncJcrToFilesystemInternal(Session session, JcrSyncObservationListener.JcrEvent event, String nodePath) {
        try {
            if (!session.nodeExists(nodePath)) {
                // Node was removed, delete corresponding file
                Path fsPath = pathMappingService.jcrToFilesystem(
                    configService.getDataDirectory(), 
                    event.getWorkspace(), 
                    nodePath);
                
                if (fsPath != null && Files.exists(fsPath)) {
                    Files.delete(fsPath);
                    log.info("Deleted file (JCR node removed): {}", fsPath);
                }
                return;
            }
            
            Node node = session.getNode(nodePath);
            
            // Check exclusion
            if (configService.isPathExcluded(nodePath)) {
                log.debug("Skipping excluded node: {}", nodePath);
                return;
            }
            
            // Check if path is under workspace root and node type matches file node types
            if (!configService.isUnderWorkspaceRoot(event.getWorkspace(), nodePath)) {
                log.info("Skipping node {} - not under workspace root {} for workspace {}", 
                    nodePath, configService.getWorkspaceRootPath(event.getWorkspace()), event.getWorkspace());
                return;
            }
            
            String primaryType = node.getPrimaryNodeType().getName();
            if (!configService.isFileNodeType(event.getWorkspace(), primaryType)) {
                // Not a file node type, skip
                log.info("Skipping node {} - node type {} is not a configured file node type for workspace {}", 
                    nodePath, primaryType, event.getWorkspace());
                return;
            }
            
            Path fsPath = pathMappingService.jcrToFilesystem(
                configService.getDataDirectory(),
                event.getWorkspace(),
                nodePath);
            
            if (fsPath == null) {
                // Path mapping returned null (not under configured root)
                log.info("Skipping node {} - path mapping returned null (not under configured root)", nodePath);
                return;
            }
            
            log.info("Syncing node {} (type: {}) to filesystem: {}", nodePath, primaryType, fsPath);
            
            // Check conflict
            if (Files.exists(fsPath)) {
                ConflictResolutionService.Resolution resolution = 
                    conflictService.resolveConflict(node, fsPath);
                
                if (resolution == ConflictResolutionService.Resolution.FILESYSTEM_WINS) {
                    log.debug("Filesystem is newer, skipping JCR sync: {}", nodePath);
                    conflictService.logConflict(node, fsPath, resolution);
                    return;
                }
                
                conflictService.logConflict(node, fsPath, resolution);
            }
            
            // Export to filesystem
            pathMappingService.ensureDirectoryExists(fsPath);
            
            // Mark file as recently written to prevent filesystem watcher from triggering
            recentlyWrittenFiles.add(fsPath);
            
            xmlService.exportNodeToXml(session, nodePath, fsPath);
            
            // Set file timestamp to match JCR node timestamp to prevent future conflicts
            try {
                long jcrTimestamp = getJcrNodeTimestamp(node);
                if (jcrTimestamp > 0) {
                    Files.setLastModifiedTime(fsPath, java.nio.file.attribute.FileTime.fromMillis(jcrTimestamp));
                    log.debug("Set file timestamp to match JCR node: {} -> {}", fsPath, jcrTimestamp);
                }
            } catch (Exception e) {
                log.debug("Could not set file timestamp to match JCR node: {}", fsPath, e);
            }
            
            log.info("Synced JCR to filesystem: {} -> {}", nodePath, fsPath);
            
            // Remove from recently written set after a delay (to allow file write to complete)
            java.util.concurrent.CompletableFuture.delayedExecutor(2, java.util.concurrent.TimeUnit.SECONDS)
                .execute(() -> recentlyWrittenFiles.remove(fsPath));
            
        } catch (Exception e) {
            log.error("Error syncing JCR to filesystem: {}", event, e);
        }
    }
    
    /**
     * Sync filesystem file to JCR.
     */
    private void syncFilesystemToJcr(
            FilePathMappingService.WorkspacePath workspacePath,
            FileSystemWatcherService.FileSystemEvent event) {
        
        try {
            // Execute in system context to get authenticated session
            info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                try {
                    Session session = info.magnolia.context.MgnlContext.getJCRSession(workspacePath.getWorkspace());
                    syncFilesystemToJcrInternal(session, workspacePath, event);
                } catch (Exception e) {
                    log.error("Error syncing filesystem to JCR in system context: {}", workspacePath, e);
                }
                return null;
            });
        } catch (Exception e) {
            log.error("Error syncing filesystem to JCR: {}", workspacePath, e);
        }
    }
    
    /**
     * Internal method to sync filesystem file to JCR (called within system context).
     */
    private void syncFilesystemToJcrInternal(
            Session session,
            FilePathMappingService.WorkspacePath workspacePath,
            FileSystemWatcherService.FileSystemEvent event) {
        
        try {
            String jcrPath = workspacePath.getJcrPath();
            Path fsPath = event.getFilePath();
            
            WatchEvent.Kind<?> eventKind = event.getEventKind();
            
            if (eventKind == ENTRY_DELETE || !Files.exists(fsPath)) {
                // File was deleted, remove JCR node
                if (xmlService.nodeExists(session, jcrPath)) {
                    xmlService.deleteNode(session, jcrPath);
                    log.info("Deleted JCR node (file removed): {}", jcrPath);
                }
                return;
            }
            
            // Check exclusion
            if (configService.isPathExcluded(jcrPath)) {
                return;
            }
            
            // Determine parent path
            String parentPath = jcrPath.equals("/") ? "/" : 
                jcrPath.substring(0, jcrPath.lastIndexOf('/'));
            if (parentPath.isEmpty()) {
                parentPath = "/";
            }
            
            // Check if parent exists
            if (!session.nodeExists(parentPath)) {
                log.warn("Parent node does not exist: {}", parentPath);
                return;
            }
            
            // Check conflict if node exists
            if (xmlService.nodeExists(session, jcrPath)) {
                Node node = session.getNode(jcrPath);
                ConflictResolutionService.Resolution resolution = 
                    conflictService.resolveConflict(node, fsPath);
                
                if (resolution == ConflictResolutionService.Resolution.JCR_WINS) {
                    log.debug("JCR is newer, skipping filesystem sync: {}", jcrPath);
                    conflictService.logConflict(node, fsPath, resolution);
                    return;
                }
                
                conflictService.logConflict(node, fsPath, resolution);
            }
            
            // Import from filesystem (pass full jcrPath for overwrite behavior)
            xmlService.importXmlToNode(session, jcrPath, fsPath);
            log.info("Synced filesystem to JCR: {} -> {}", fsPath, jcrPath);
            
        } catch (Exception e) {
            log.error("Error syncing filesystem to JCR: {}", workspacePath, e);
        }
    }
    
    /**
     * Perform initial sync of all configured workspaces.
     */
    public void performInitialSync() {
        if (!configService.isInitialSyncEnabled()) {
            log.info("Initial sync disabled, skipping");
            return;
        }
        
        log.info("Starting initial sync...");
        
        try {
            String[] workspaceNames = repositoryManager.getWorkspaceNames().toArray(new String[0]);
            
            for (String workspaceName : workspaceNames) {
                if (!configService.isWorkspaceIncluded(workspaceName)) {
                    log.debug("Skipping excluded workspace: {}", workspaceName);
                    continue;
                }
                
                syncWorkspaceToFilesystem(workspaceName);
            }
            
            log.info("Initial sync completed");
            
        } catch (Exception e) {
            log.error("Error during initial sync", e);
        }
    }
    
    /**
     * Scan filesystem for existing XML files and import them to JCR.
     * This is called when initial sync is disabled to ensure filesystem content is imported.
     */
    public void scanFilesystemAndImport() {
        log.info("Scanning filesystem for existing files to import...");
        
        try {
            Path dataDir = configService.getDataDirectory();
            if (!Files.exists(dataDir)) {
                log.info("Data directory does not exist: {}", dataDir);
                return;
            }
            
            // Execute in system context
            info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                try {
                    // Walk through data directory
                    Files.walkFileTree(dataDir, new java.nio.file.SimpleFileVisitor<Path>() {
                        @Override
                        public java.nio.file.FileVisitResult visitFile(Path file, java.nio.file.attribute.BasicFileAttributes attrs) {
                            try {
                                // Only process XML files
                                if (!file.getFileName().toString().endsWith(".xml")) {
                                    return java.nio.file.FileVisitResult.CONTINUE;
                                }
                                
                                // Skip settings.properties
                                if (file.getFileName().toString().equals("settings.properties")) {
                                    return java.nio.file.FileVisitResult.CONTINUE;
                                }
                                
                                // Map filesystem path to JCR path
                                FilePathMappingService.WorkspacePath workspacePath = 
                                    pathMappingService.filesystemToJcr(dataDir, file);
                                
                                if (workspacePath == null) {
                                    return java.nio.file.FileVisitResult.CONTINUE;
                                }
                                
                                // Check if path should be excluded
                                if (configService.isPathExcluded(workspacePath.getJcrPath())) {
                                    return java.nio.file.FileVisitResult.CONTINUE;
                                }
                                
                                // Get session for workspace
                                Session session = info.magnolia.context.MgnlContext.getJCRSession(workspacePath.getWorkspace());
                                
                                // Check if node already exists
                                if (xmlService.nodeExists(session, workspacePath.getJcrPath())) {
                                    log.debug("Node already exists in JCR, skipping import: {}", workspacePath.getJcrPath());
                                    return java.nio.file.FileVisitResult.CONTINUE;
                                }
                                
                                // Determine parent path
                                String jcrPath = workspacePath.getJcrPath();
                                String parentPath = jcrPath.equals("/") ? "/" : 
                                    jcrPath.substring(0, jcrPath.lastIndexOf('/'));
                                if (parentPath.isEmpty()) {
                                    parentPath = "/";
                                }
                                
                                // Check if parent exists, create if needed (for root-level pages)
                                if (!session.nodeExists(parentPath)) {
                                    if (parentPath.equals("/")) {
                                        // Root exists, proceed with import
                                        log.debug("Parent is root, proceeding with import");
                                    } else {
                                        log.debug("Parent node does not exist, skipping: {}", parentPath);
                                        return java.nio.file.FileVisitResult.CONTINUE;
                                    }
                                }
                                
                                // Import the file (pass full jcrPath for overwrite behavior)
                                try {
                                    xmlService.importXmlToNode(session, workspacePath.getJcrPath(), file);
                                    session.save();
                                    log.info("Imported existing filesystem file to JCR: {} -> {}", file, workspacePath.getJcrPath());
                                } catch (Exception importError) {
                                    log.error("Failed to import file {} to JCR path {}", file, workspacePath.getJcrPath(), importError);
                                }
                                
                            } catch (Exception e) {
                                log.error("Error importing filesystem file: {}", file, e);
                            }
                            return java.nio.file.FileVisitResult.CONTINUE;
                        }
                    });
                } catch (Exception e) {
                    log.error("Error scanning filesystem", e);
                }
                return null;
            });
            
            log.info("Filesystem scan completed");
            
        } catch (Exception e) {
            log.error("Error scanning filesystem for import", e);
        }
    }
    
    /**
     * Sync an entire workspace to filesystem.
     * Starts from the configured root path for the workspace.
     */
    private void syncWorkspaceToFilesystem(String workspaceName) {
        try {
            // Get workspace root path from config
            String rootPath = configService.getWorkspaceRootPath(workspaceName);
            if (rootPath == null) {
                log.info("No root path configured for workspace: {}, skipping sync", workspaceName);
                return;
            }
            
            // Execute in system context to get authenticated session
            info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                try {
                    Session session = info.magnolia.context.MgnlContext.getJCRSession(workspaceName);
                    
                    // Start sync from configured root path
                    if (session.nodeExists(rootPath)) {
                        syncNodeRecursive(session, rootPath, workspaceName);
                    } else {
                        log.warn("Root path does not exist in workspace {}: {}", workspaceName, rootPath);
                    }
                } catch (Exception e) {
                    log.error("Error syncing workspace in system context: {}", workspaceName, e);
                }
                return null;
            });
        } catch (Exception e) {
            log.error("Error syncing workspace: {}", workspaceName, e);
        }
    }
    
    /**
     * Recursively sync a node and its children.
     * Only syncs nodes under configured workspace root path that match file node types.
     */
    private void syncNodeRecursive(Session session, String nodePath, String workspaceName) 
            throws RepositoryException {
        
        if (configService.isPathExcluded(nodePath)) {
            return;
        }
        
        if (!session.nodeExists(nodePath)) {
            return;
        }
        
        try {
            Node node = session.getNode(nodePath);
            
            // Check if path is under workspace root
            if (!configService.isUnderWorkspaceRoot(workspaceName, nodePath)) {
                return;
            }
            
            // Check if this node type should be synced as a file
            String primaryType = node.getPrimaryNodeType().getName();
            if (configService.isFileNodeType(workspaceName, primaryType)) {
                // Export this node as a file
                Path fsPath = pathMappingService.jcrToFilesystem(
                    configService.getDataDirectory(),
                    workspaceName,
                    nodePath);
                
                if (fsPath != null) {
                    pathMappingService.ensureDirectoryExists(fsPath);
                    
                    // Mark as recently written
                    recentlyWrittenFiles.add(fsPath);
                    
                    xmlService.exportNodeToXml(session, nodePath, fsPath);
                    
                    // Remove from recently written after delay
                    java.util.concurrent.CompletableFuture.delayedExecutor(2, java.util.concurrent.TimeUnit.SECONDS)
                        .execute(() -> recentlyWrittenFiles.remove(fsPath));
                }
            }
            
            // Recursively process children (only if under workspace root)
            var children = node.getNodes();
            while (children.hasNext()) {
                Node child = children.nextNode();
                String childPath = child.getPath();
                // Skip access control and rep: nodes
                if (!childPath.contains("rep:") && !childPath.contains("accesscontrol")) {
                    syncNodeRecursive(session, childPath, workspaceName);
                }
            }
            
        } catch (Exception e) {
            log.error("Error syncing node: {}", nodePath, e);
        }
    }
    
    /**
     * Get JCR node timestamp (mgnl:lastModified, jcr:lastModified, or jcr:created).
     * Helper method to extract timestamp for setting file modification time.
     */
    private long getJcrNodeTimestamp(Node node) {
        try {
            // Try mgnl:lastModified first (Magnolia-specific property)
            if (node.hasProperty("mgnl:lastModified")) {
                Property prop = node.getProperty("mgnl:lastModified");
                return prop.getDate().getTimeInMillis();
            }
            
            // Try jcr:lastModified next
            if (node.hasProperty("jcr:lastModified")) {
                Property prop = node.getProperty("jcr:lastModified");
                return prop.getDate().getTimeInMillis();
            }
            
            // Fall back to jcr:created
            if (node.hasProperty("jcr:created")) {
                Property prop = node.getProperty("jcr:created");
                return prop.getDate().getTimeInMillis();
            }
        } catch (RepositoryException e) {
            String nodePath = "null";
            try {
                if (node != null) {
                    nodePath = node.getPath();
                }
            } catch (RepositoryException re) {
                // Ignore
            }
            log.debug("Error getting JCR node timestamp: {}", nodePath, e);
        } catch (Exception e) {
            String nodePath = "null";
            try {
                if (node != null) {
                    nodePath = node.getPath();
                }
            } catch (RepositoryException re) {
                // Ignore
            }
            log.debug("Error getting JCR node timestamp: {}", nodePath, e);
        }
        return 0;
    }
    
    /**
     * Shutdown the sync service.
     */
    public void shutdown() {
        executorService.shutdown();
        log.info("Bidirectional sync service shut down");
    }
}

