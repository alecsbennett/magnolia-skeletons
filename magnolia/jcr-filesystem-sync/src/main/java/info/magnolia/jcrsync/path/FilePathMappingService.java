package info.magnolia.jcrsync.path;

import info.magnolia.jcrsync.config.SyncConfigurationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

/**
 * Service for mapping between JCR workspace+path and filesystem paths.
 * Maps JCR paths to: data/{workspace}/{jcr-path}.xml
 */
public class FilePathMappingService {
    
    private static final Logger log = LoggerFactory.getLogger(FilePathMappingService.class);
    
    private static final Pattern INVALID_CHARS = Pattern.compile("[<>:\"|?*\\\\]");
    private static final String XML_EXTENSION = ".xml";
    
    private final SyncConfigurationService configService;
    
    public FilePathMappingService(SyncConfigurationService configService) {
        this.configService = configService;
    }
    
    /**
     * Convert JCR workspace and path to filesystem path.
     * Uses workspace configuration to determine root path and file structure.
     * 
     * Examples:
     * - /pages/home (mgnl:page) -> website/home.xml
     * - /pages/home/child (mgnl:page) -> website/home/child.xml
     * 
     * @param baseDir Base directory (e.g., "data")
     * @param workspace JCR workspace name
     * @param jcrPath JCR node path (e.g., "/pages/home")
     * @return Filesystem path, or null if path is not under configured root
     */
    public Path jcrToFilesystem(Path baseDir, String workspace, String jcrPath) {
        if (jcrPath == null || jcrPath.isEmpty() || jcrPath.equals("/")) {
            return null; // Don't sync root
        }
        
        SyncConfigurationService.WorkspaceConfig config = configService.getWorkspaceConfig(workspace);
        if (config == null || config.getRootPath() == null) {
            // No configuration for this workspace, don't sync
            return null;
        }
        
        String rootPath = config.getRootPath();
        if (!jcrPath.startsWith(rootPath)) {
            // Path is not under configured root
            return null;
        }
        
        // Remove root path prefix
        String relativePath = jcrPath.substring(rootPath.length());
        if (relativePath.isEmpty() || relativePath.equals("/")) {
            return null; // Don't sync root path itself
        }
        
        // Remove leading slash
        if (relativePath.startsWith("/")) {
            relativePath = relativePath.substring(1);
        }
        
        String[] segments = relativePath.split("/");
        
        // Build filesystem path
        // If only one segment: website/home.xml
        // If multiple segments: website/home/child.xml (folder structure)
        StringBuilder fsPath = new StringBuilder();
        
        if (segments.length == 1) {
            // Single node: website/home.xml
            fsPath.append(encodeSegment(segments[0]));
            fsPath.append(XML_EXTENSION);
        } else {
            // Multiple segments: website/parent/child.xml (folder for parent, file for child)
            for (int i = 0; i < segments.length; i++) {
                if (i > 0) {
                    fsPath.append("/");
                }
                fsPath.append(encodeSegment(segments[i]));
            }
            fsPath.append(XML_EXTENSION);
        }
        
        return baseDir.resolve(workspace).resolve(fsPath.toString());
    }
    
    /**
     * Convert filesystem path back to JCR workspace and path.
     * Handles reverse mapping: website/home.xml -> /pages/home
     * 
     * @param baseDir Base directory (e.g., "data")
     * @param fsPath Filesystem path
     * @return WorkspacePath containing workspace name and JCR path, or null if invalid
     */
    public WorkspacePath filesystemToJcr(Path baseDir, Path fsPath) {
        try {
            Path relativePath = baseDir.relativize(fsPath);
            
            if (relativePath.getNameCount() < 2) {
                log.warn("Invalid filesystem path structure: {}", fsPath);
                return null;
            }
            
            // First segment is workspace name
            String workspace = relativePath.getName(0).toString();
            
            // Remaining segments form the JCR path
            Path jcrPathSegments = relativePath.subpath(1, relativePath.getNameCount());
            
            // Remove .xml extension
            String fileName = jcrPathSegments.getFileName().toString();
            if (!fileName.endsWith(XML_EXTENSION)) {
                log.warn("File does not have .xml extension: {}", fsPath);
                return null;
            }
            
            String pathWithoutExt = fileName.substring(0, fileName.length() - XML_EXTENSION.length());
            
            // Handle root node
            if (pathWithoutExt.equals("root") && jcrPathSegments.getNameCount() == 1) {
                return new WorkspacePath(workspace, "/");
            }
            
            // Decode path segments and reconstruct JCR path
            // Use workspace config to determine root path
            SyncConfigurationService.WorkspaceConfig config = configService.getWorkspaceConfig(workspace);
            if (config == null || config.getRootPath() == null) {
                log.warn("No workspace config found for: {}", workspace);
                return null;
            }
            
            String rootPath = config.getRootPath();
            StringBuilder jcrPath = new StringBuilder(rootPath);
            
            // Helper to append a segment with proper slash handling
            // Prevents double slashes when rootPath is "/"
            if (jcrPathSegments.getNameCount() > 1) {
                // Has parent directories: website/home/child.xml -> /pages/home/child
                for (int i = 0; i < jcrPathSegments.getNameCount() - 1; i++) {
                    // Only add "/" if jcrPath doesn't already end with "/"
                    if (jcrPath.length() == 0 || jcrPath.charAt(jcrPath.length() - 1) != '/') {
                        jcrPath.append("/");
                    }
                    jcrPath.append(decodeSegment(jcrPathSegments.getName(i).toString()));
                }
            }
            
            // Add final segment
            // Only add "/" if jcrPath doesn't already end with "/"
            if (jcrPath.length() == 0 || jcrPath.charAt(jcrPath.length() - 1) != '/') {
                jcrPath.append("/");
            }
            jcrPath.append(decodeSegment(pathWithoutExt));
            
            return new WorkspacePath(workspace, jcrPath.toString());
            
        } catch (Exception e) {
            log.error("Failed to convert filesystem path to JCR path: {}", fsPath, e);
            return null;
        }
    }
    
    /**
     * Encode a path segment to be filesystem-safe.
     * Uses URL encoding for special characters.
     */
    private String encodeSegment(String segment) {
        if (segment == null || segment.isEmpty()) {
            return segment;
        }
        
        try {
            // URL encode the segment
            String encoded = URLEncoder.encode(segment, "UTF-8");
            // Replace + with %20 for spaces (more readable)
            encoded = encoded.replace("+", "%20");
            return encoded;
        } catch (UnsupportedEncodingException e) {
            log.warn("Failed to encode segment: {}", segment, e);
            // Fallback: replace invalid chars with underscore
            return INVALID_CHARS.matcher(segment).replaceAll("_");
        }
    }
    
    /**
     * Decode a path segment from filesystem-safe encoding back to JCR name.
     */
    private String decodeSegment(String segment) {
        if (segment == null || segment.isEmpty()) {
            return segment;
        }
        
        try {
            // URL decode the segment
            return java.net.URLDecoder.decode(segment, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            log.warn("Failed to decode segment: {}", segment, e);
            return segment;
        }
    }
    
    /**
     * Ensure directory structure exists for the given path.
     */
    public void ensureDirectoryExists(Path filePath) {
        try {
            Path parent = filePath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
                log.debug("Created directory: {}", parent);
            }
        } catch (Exception e) {
            log.error("Failed to create directory for: {}", filePath, e);
        }
    }
    
    /**
     * Container for workspace name and JCR path.
     */
    public static class WorkspacePath {
        private final String workspace;
        private final String jcrPath;
        
        public WorkspacePath(String workspace, String jcrPath) {
            this.workspace = workspace;
            this.jcrPath = jcrPath;
        }
        
        public String getWorkspace() {
            return workspace;
        }
        
        public String getJcrPath() {
            return jcrPath;
        }
        
        @Override
        public String toString() {
            return workspace + ":" + jcrPath;
        }
    }
}

