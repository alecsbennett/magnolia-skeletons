package info.magnolia.jcrsync.conflict;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.Node;
import javax.jcr.Property;
import javax.jcr.RepositoryException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;

/**
 * Service for resolving conflicts between JCR and filesystem using last-write-wins strategy.
 */
public class ConflictResolutionService {
    
    private static final Logger log = LoggerFactory.getLogger(ConflictResolutionService.class);
    
    /**
     * Resolution result indicating which source should win.
     */
    public enum Resolution {
        JCR_WINS,
        FILESYSTEM_WINS,
        NO_CONFLICT
    }
    
    /**
     * Resolve conflict between JCR node and filesystem file using last-write-wins.
     * 
     * @param node JCR node
     * @param file Filesystem file
     * @return Resolution indicating which source should win
     */
    public Resolution resolveConflict(Node node, Path file) {
        try {
            long jcrTimestamp = 0;
            try {
                jcrTimestamp = getJcrLastModified(node);
            } catch (RepositoryException e) {
                log.warn("Error reading JCR timestamp from node: {}", 
                    node != null ? node.getPath() : "null", e);
            }
            
            long fileTimestamp = getFileLastModified(file);
            
            if (jcrTimestamp == 0 && fileTimestamp == 0) {
                return Resolution.NO_CONFLICT;
            }
            
            if (jcrTimestamp == 0) {
                // JCR node doesn't exist or has no timestamp, filesystem wins
                log.debug("JCR timestamp unavailable, filesystem wins: {}", file);
                return Resolution.FILESYSTEM_WINS;
            }
            
            if (fileTimestamp == 0) {
                // File doesn't exist or has no timestamp, JCR wins
                String nodePath = "null";
                try {
                    if (node != null) {
                        nodePath = node.getPath();
                    }
                } catch (RepositoryException e) {
                    log.debug("Error getting node path for logging", e);
                }
                log.debug("File timestamp unavailable, JCR wins: {}", nodePath);
                return Resolution.JCR_WINS;
            }
            
            // Compare timestamps - last write wins
            if (fileTimestamp > jcrTimestamp) {
                log.debug("Filesystem is newer ({} > {}), filesystem wins: {}", 
                    fileTimestamp, jcrTimestamp, file);
                return Resolution.FILESYSTEM_WINS;
            } else if (jcrTimestamp > fileTimestamp) {
                String nodePath = "null";
                try {
                    if (node != null) {
                        nodePath = node.getPath();
                    }
                } catch (RepositoryException re) {
                    log.debug("Error getting node path for logging", re);
                }
                log.debug("JCR is newer ({} > {}), JCR wins: {}", 
                    jcrTimestamp, fileTimestamp, nodePath);
                return Resolution.JCR_WINS;
            } else {
                // Same timestamp, no conflict
                log.debug("Timestamps match ({}), no conflict", jcrTimestamp);
                return Resolution.NO_CONFLICT;
            }
            
        } catch (Exception e) {
            String nodePath = "null";
            try {
                if (node != null) {
                    nodePath = node.getPath();
                }
            } catch (RepositoryException re) {
                log.debug("Error getting node path for error logging", re);
            }
            log.error("Error resolving conflict between {} and {}", nodePath, file, e);
            // Default to JCR wins on error
            return Resolution.JCR_WINS;
        }
    }
    
    /**
     * Get last modified timestamp from JCR node.
     * Tries mgnl:lastModified (Magnolia), jcr:lastModified, jcr:created, or current time if none exist.
     */
    private long getJcrLastModified(Node node) throws RepositoryException {
        if (node == null) {
            return 0;
        }
        
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
        
        // If node has been modified but no timestamp property, use current time
        // This is a fallback - ideally nodes should have mgnl:lastModified or jcr:lastModified
        log.debug("No timestamp property found on node: {}", node.getPath());
        return System.currentTimeMillis();
    }
    
    /**
     * Get last modified timestamp from filesystem file.
     */
    private long getFileLastModified(Path file) {
        if (file == null || !Files.exists(file)) {
            return 0;
        }
        
        try {
            FileTime fileTime = Files.getLastModifiedTime(file);
            return fileTime.toMillis();
        } catch (Exception e) {
            log.warn("Error reading file timestamp: {}", file, e);
            return 0;
        }
    }
    
    /**
     * Check if a conflict exists between JCR node and filesystem file.
     * A conflict exists if both exist and have different timestamps.
     */
    public boolean hasConflict(Node node, Path file) {
        try {
            Resolution resolution = resolveConflict(node, file);
            return resolution != Resolution.NO_CONFLICT;
        } catch (Exception e) {
            log.error("Error checking conflict", e);
            return false;
        }
    }
    
    /**
     * Log conflict information for audit trail.
     */
    public void logConflict(Node node, Path file, Resolution resolution) {
        try {
            long jcrTimestamp = 0;
            long fileTimestamp = getFileLastModified(file);
            
            if (node != null) {
                try {
                    jcrTimestamp = getJcrLastModified(node);
                } catch (Exception e) {
                    log.debug("Error getting JCR timestamp for logging", e);
                }
            }
            
            log.info("Conflict resolved - JCR: {} ({}), File: {} ({}), Winner: {}", 
                node != null ? node.getPath() : "null", 
                jcrTimestamp,
                file != null ? file.toString() : "null",
                fileTimestamp,
                resolution);
        } catch (Exception e) {
            log.error("Error logging conflict", e);
        }
    }
}

