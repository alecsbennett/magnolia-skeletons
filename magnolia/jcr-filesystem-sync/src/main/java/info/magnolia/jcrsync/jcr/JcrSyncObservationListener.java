package info.magnolia.jcrsync.jcr;

import info.magnolia.jcrsync.config.SyncConfigurationService;
import info.magnolia.jcrsync.sync.BidirectionalSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.jcr.Session;
import javax.jcr.observation.Event;
import javax.jcr.observation.EventIterator;
import javax.jcr.observation.EventListener;
import javax.jcr.observation.ObservationManager;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Set;

/**
 * JCR observation listener that monitors JCR changes and queues them for synchronization.
 */
public class JcrSyncObservationListener implements EventListener {
    
    private static final Logger log = LoggerFactory.getLogger(JcrSyncObservationListener.class);
    
    private final String workspace;
    private final Session session;
    private final SyncConfigurationService configService;
    private final BidirectionalSyncService syncService;
    private final BlockingQueue<JcrEvent> eventQueue;
    private ObservationManager observationManager;
    private boolean registered;
    // Track pending property-based node syncs to deduplicate multiple property changes on the same node
    private final Set<String> pendingPropertySyncs = ConcurrentHashMap.newKeySet();
    
    public JcrSyncObservationListener(
            String workspace,
            Session session,
            SyncConfigurationService configService,
            BidirectionalSyncService syncService) {
        this.workspace = workspace;
        this.session = session;
        this.configService = configService;
        this.syncService = syncService;
        this.eventQueue = new LinkedBlockingQueue<>();
        this.registered = false;
    }
    
    /**
     * Register this listener with the JCR observation manager.
     */
    public void register() throws RepositoryException {
        if (registered) {
            log.warn("Listener already registered for workspace: {}", workspace);
            return;
        }
        
        observationManager = session.getWorkspace().getObservationManager();
        
        // Listen to all node and property events
        int eventTypes = Event.NODE_ADDED | Event.NODE_REMOVED | 
                        Event.PROPERTY_ADDED | Event.PROPERTY_CHANGED | Event.PROPERTY_REMOVED;
        
        // Listen to all paths (absolute path "/")
        observationManager.addEventListener(this, eventTypes, "/", true, null, null, false);
        
        registered = true;
        log.info("Registered JCR observation listener for workspace: {}", workspace);
    }
    
    /**
     * Unregister this listener.
     */
    public void unregister() {
        if (!registered || observationManager == null) {
            return;
        }
        
        try {
            observationManager.removeEventListener(this);
            registered = false;
            log.info("Unregistered JCR observation listener for workspace: {}", workspace);
        } catch (RepositoryException e) {
            log.error("Error unregistering JCR observation listener", e);
        }
    }
    
    @Override
    public void onEvent(EventIterator events) {
        while (events.hasNext()) {
            Event event = events.nextEvent();
            try {
                processEvent(event);
            } catch (Exception e) {
                log.error("Error processing JCR event", e);
            }
        }
    }
    
        /**
         * Process a single JCR event.
         */
        private void processEvent(Event event) throws RepositoryException {
            String path = event.getPath();

            log.info("JCR Event received: workspace={}, path={}, type={}",
                workspace, path, event.getType());

            // Check if path should be excluded
            if (configService.isPathExcluded(path)) {
                log.info("Skipping excluded path: {}", path);
                return;
            }

            // Determine event type
            int eventType = event.getType();
            JcrEvent.EventType type;

            if ((eventType & Event.NODE_ADDED) != 0) {
                type = JcrEvent.EventType.NODE_ADDED;
            } else if ((eventType & Event.NODE_REMOVED) != 0) {
                type = JcrEvent.EventType.NODE_REMOVED;
            } else if ((eventType & Event.PROPERTY_ADDED) != 0) {
                // Property events: extract parent node path and sync that node
                handlePropertyEvent(path, "PROPERTY_ADDED");
                return;
            } else if ((eventType & Event.PROPERTY_CHANGED) != 0) {
                // Property events: extract parent node path and sync that node
                handlePropertyEvent(path, "PROPERTY_CHANGED");
                return;
            } else if ((eventType & Event.PROPERTY_REMOVED) != 0) {
                // Property events: extract parent node path and sync that node
                handlePropertyEvent(path, "PROPERTY_REMOVED");
                return;
            } else {
                log.debug("Unknown event type: {}, skipping", eventType);
                return;
            }

            // Create event object and queue for processing
            JcrEvent jcrEvent = new JcrEvent(workspace, path, type);
            eventQueue.offer(jcrEvent);

            log.info("Queued JCR event for sync: {} - {} [{}]", type, path, workspace);

            // Trigger async processing
            syncService.processJcrEvent(jcrEvent);
        }
    
    /**
     * Handle property events by extracting the parent node path and syncing that node.
     * Uses deduplication to avoid syncing the same node multiple times when multiple properties change.
     */
    private void handlePropertyEvent(String propertyPath, String eventTypeName) {
        // Extract parent node path from property path
        // Property paths are like "/home/title" -> parent node is "/home"
        String parentNodePath;
        int lastSlash = propertyPath.lastIndexOf('/');
        if (lastSlash <= 0) {
            // Root property or invalid path, skip
            log.debug("Cannot determine parent node for property path: {}", propertyPath);
            return;
        }
        parentNodePath = propertyPath.substring(0, lastSlash);
        if (parentNodePath.isEmpty()) {
            parentNodePath = "/";
        }
        
        // Check if parent node path should be excluded
        if (configService.isPathExcluded(parentNodePath)) {
            log.debug("Skipping property event - parent node path is excluded: {} -> {}", propertyPath, parentNodePath);
            return;
        }
        
        // Deduplicate: if we already have a pending sync for this node, skip
        String syncKey = workspace + ":" + parentNodePath;
        if (pendingPropertySyncs.contains(syncKey)) {
            log.debug("Property event for node already queued for sync: {} (property: {})", parentNodePath, propertyPath);
            return;
        }
        
        // Mark as pending
        pendingPropertySyncs.add(syncKey);
        
        log.info("Property {} detected, will sync parent node: {} -> {}", eventTypeName, propertyPath, parentNodePath);
        
        // Create a NODE_ADDED event for the parent node (this will trigger a sync)
        // We use NODE_ADDED as it will cause the sync service to export the node
        JcrEvent jcrEvent = new JcrEvent(workspace, parentNodePath, JcrEvent.EventType.NODE_ADDED);
        eventQueue.offer(jcrEvent);
        
        log.info("Queued node sync for property change: {} - {} [{}]", JcrEvent.EventType.NODE_ADDED, parentNodePath, workspace);
        
        // Trigger async processing
        syncService.processJcrEvent(jcrEvent);
        
        // Remove from pending set after a delay to allow the sync to complete
        // This prevents immediate re-syncing but allows future property changes to trigger syncs
        java.util.concurrent.CompletableFuture.delayedExecutor(1, java.util.concurrent.TimeUnit.SECONDS)
            .execute(() -> pendingPropertySyncs.remove(syncKey));
    }
    
    /**
     * Get the workspace name this listener is monitoring.
     */
    public String getWorkspace() {
        return workspace;
    }
    
    /**
     * Check if listener is registered.
     */
    public boolean isRegistered() {
        return registered;
    }
    
    /**
     * Container for JCR event information.
     */
    public static class JcrEvent {
        private final String workspace;
        private final String path;
        private final EventType eventType;
        
        public JcrEvent(String workspace, String path, EventType eventType) {
            this.workspace = workspace;
            this.path = path;
            this.eventType = eventType;
        }
        
        public String getWorkspace() {
            return workspace;
        }
        
        public String getPath() {
            return path;
        }
        
        public EventType getEventType() {
            return eventType;
        }
        
        public enum EventType {
            NODE_ADDED,
            NODE_REMOVED,
            PROPERTY_ADDED,
            PROPERTY_CHANGED,
            PROPERTY_REMOVED
        }
        
        @Override
        public String toString() {
            return workspace + ":" + path + " [" + eventType + "]";
        }
    }
}

