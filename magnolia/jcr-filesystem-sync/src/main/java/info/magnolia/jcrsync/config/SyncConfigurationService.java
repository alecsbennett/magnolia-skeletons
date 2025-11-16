package info.magnolia.jcrsync.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Service for reading and managing synchronization configuration from settings.properties.
 */
public class SyncConfigurationService {
    
    private static final Logger log = LoggerFactory.getLogger(SyncConfigurationService.class);
    
    private static final String DEFAULT_EXCLUDE_PATTERNS = 
        "jcr:system.*," +
        ".*/jcr:versionStorage.*," +
        ".*/jcr:baseVersion.*," +
        ".*/jcr:predecessors.*," +
        ".*/jcr:successors.*," +
        ".*rep:jcr:.*," +
        ".*rep:accesscontrol.*," +
        ".*rep:policy.*," +
        ".*/rep:policy.*," +
        ".*/rep:accesscontrol.*";
    
    private Properties properties;
    private List<Pattern> includePatterns;
    private List<Pattern> excludePatterns;
    private String dataDir;
    private boolean syncEnabled;
    private boolean initialSync;
    private java.util.Set<String> excludePropertyPrefixes = new java.util.HashSet<>();
    
    // Workspace-specific configurations
    private java.util.Map<String, WorkspaceConfig> workspaceConfigs = new java.util.HashMap<>();
    
    /**
     * Initialize configuration from settings.properties file.
     * 
     * @param settingsFile Path to settings.properties file
     */
    public void initialize(File settingsFile) {
        properties = new Properties();
        
        if (settingsFile != null && settingsFile.exists()) {
            try (FileInputStream fis = new FileInputStream(settingsFile)) {
                properties.load(fis);
                log.info("Loaded configuration from: {}", settingsFile.getAbsolutePath());
            } catch (IOException e) {
                log.error("Failed to load settings.properties", e);
            }
        } else {
            log.warn("Settings file not found: {}, using defaults", 
                settingsFile != null ? settingsFile.getAbsolutePath() : "null");
        }
        
        // Parse include patterns
        String includeStr = properties.getProperty("include", ".*");
        includePatterns = parsePatterns(includeStr);
        log.info("Include patterns: {}", includePatterns.stream()
            .map(Pattern::pattern)
            .collect(Collectors.joining(", ")));
        
        // Parse exclude patterns (merge defaults with custom)
        String excludeStr = properties.getProperty("exclude", "");
        String allExcludes = excludeStr.isEmpty() 
            ? DEFAULT_EXCLUDE_PATTERNS 
            : DEFAULT_EXCLUDE_PATTERNS + "," + excludeStr;
        excludePatterns = parsePatterns(allExcludes);
        log.info("Exclude patterns: {}", excludePatterns.stream()
            .map(Pattern::pattern)
            .collect(Collectors.joining(", ")));
        
        // Data directory
        dataDir = properties.getProperty("data.dir", "data");
        log.info("Data directory: {}", dataDir);
        
        // Sync enabled - check Magnolia properties first, then settings.properties
        // Magnolia properties take precedence for environment-specific configuration
        String magnoliaSyncEnabled = System.getProperty("jcr.filesystem.sync.enabled");
        if (magnoliaSyncEnabled != null) {
            syncEnabled = Boolean.parseBoolean(magnoliaSyncEnabled);
            log.info("Sync enabled from Magnolia properties: {}", syncEnabled);
        } else {
            syncEnabled = Boolean.parseBoolean(properties.getProperty("sync.enabled", "true"));
            log.info("Sync enabled from settings.properties: {}", syncEnabled);
        }
        
        // Initial sync
        initialSync = Boolean.parseBoolean(properties.getProperty("sync.initial", "true"));
        log.info("Initial sync on startup: {}", initialSync);
        
        // Parse exclude property prefixes (comma-separated, e.g., "mgnl:,jcr:")
        String excludePropsStr = properties.getProperty("exclude.property.prefixes", "mgnl:,jcr:");
        excludePropertyPrefixes = new java.util.HashSet<>();
        if (excludePropsStr != null && !excludePropsStr.trim().isEmpty()) {
            String[] prefixes = excludePropsStr.split(",");
            for (String prefix : prefixes) {
                String trimmed = prefix.trim();
                if (!trimmed.isEmpty()) {
                    excludePropertyPrefixes.add(trimmed);
                }
            }
        }
        log.info("Exclude property prefixes: {}", excludePropertyPrefixes);
        
        // Load workspace-specific configurations
        loadWorkspaceConfigs();
    }
    
    /**
     * Load workspace-specific configurations from properties.
     */
    private void loadWorkspaceConfigs() {
        workspaceConfigs.clear();
        
        // Find all workspace.* properties
        for (String key : properties.stringPropertyNames()) {
            if (key.startsWith("workspace.") && key.endsWith(".rootPath")) {
                // Extract workspace name: workspace.{name}.rootPath -> {name}
                String workspaceName = key.substring("workspace.".length(), key.lastIndexOf(".rootPath"));
                
                String rootPath = properties.getProperty(key);
                String fileNodeTypes = properties.getProperty("workspace." + workspaceName + ".fileNodeTypes", "");
                String folderNodeTypes = properties.getProperty("workspace." + workspaceName + ".folderNodeTypes", "");
                
                WorkspaceConfig config = new WorkspaceConfig(workspaceName, rootPath, fileNodeTypes, folderNodeTypes);
                workspaceConfigs.put(workspaceName, config);
                
                log.info("Loaded workspace config for {}: rootPath={}, fileNodeTypes={}, folderNodeTypes={}",
                    workspaceName, rootPath, fileNodeTypes, folderNodeTypes);
            }
        }
    }
    
    /**
     * Get workspace configuration for a given workspace.
     */
    public WorkspaceConfig getWorkspaceConfig(String workspaceName) {
        return workspaceConfigs.get(workspaceName);
    }
    
    /**
     * Check if a node type should be synced as a file for the given workspace.
     */
    public boolean isFileNodeType(String workspaceName, String nodeType) {
        WorkspaceConfig config = workspaceConfigs.get(workspaceName);
        if (config == null) {
            return false;
        }
        return config.isFileNodeType(nodeType);
    }
    
    /**
     * Check if a path is under the configured root path for a workspace.
     */
    public boolean isUnderWorkspaceRoot(String workspaceName, String jcrPath) {
        WorkspaceConfig config = workspaceConfigs.get(workspaceName);
        if (config == null || config.getRootPath() == null) {
            return false;
        }
        return jcrPath.startsWith(config.getRootPath());
    }
    
    /**
     * Get the root path for a workspace.
     */
    public String getWorkspaceRootPath(String workspaceName) {
        WorkspaceConfig config = workspaceConfigs.get(workspaceName);
        return config != null ? config.getRootPath() : null;
    }
    
    /**
     * Configuration for a workspace.
     */
    public static class WorkspaceConfig {
        private final String workspaceName;
        private final String rootPath;
        private final java.util.Set<String> fileNodeTypes;
        private final java.util.Set<String> folderNodeTypes;
        
        public WorkspaceConfig(String workspaceName, String rootPath, String fileNodeTypesStr, String folderNodeTypesStr) {
            this.workspaceName = workspaceName;
            this.rootPath = rootPath;
            
            // Parse comma-separated node types
            this.fileNodeTypes = new java.util.HashSet<>();
            if (fileNodeTypesStr != null && !fileNodeTypesStr.trim().isEmpty()) {
                for (String type : fileNodeTypesStr.split(",")) {
                    fileNodeTypes.add(type.trim());
                }
            }
            
            this.folderNodeTypes = new java.util.HashSet<>();
            if (folderNodeTypesStr != null && !folderNodeTypesStr.trim().isEmpty()) {
                for (String type : folderNodeTypesStr.split(",")) {
                    folderNodeTypes.add(type.trim());
                }
            }
        }
        
        public String getWorkspaceName() {
            return workspaceName;
        }
        
        public String getRootPath() {
            return rootPath;
        }
        
        public boolean isFileNodeType(String nodeType) {
            return fileNodeTypes.contains(nodeType);
        }
        
        public boolean isFolderNodeType(String nodeType) {
            return folderNodeTypes.contains(nodeType);
        }
        
        public java.util.Set<String> getFileNodeTypes() {
            return new java.util.HashSet<>(fileNodeTypes);
        }
        
        public java.util.Set<String> getFolderNodeTypes() {
            return new java.util.HashSet<>(folderNodeTypes);
        }
    }
    
    /**
     * Parse comma-separated regex patterns into Pattern objects.
     */
    private List<Pattern> parsePatterns(String patternsStr) {
        List<Pattern> patterns = new ArrayList<>();
        if (patternsStr != null && !patternsStr.trim().isEmpty()) {
            String[] parts = patternsStr.split(",");
            for (String part : parts) {
                String trimmed = part.trim();
                if (!trimmed.isEmpty()) {
                    try {
                        patterns.add(Pattern.compile(trimmed));
                    } catch (Exception e) {
                        log.warn("Invalid regex pattern: {}", trimmed, e);
                    }
                }
            }
        }
        return patterns;
    }
    
    /**
     * Check if a workspace name matches any include pattern.
     */
    public boolean isWorkspaceIncluded(String workspaceName) {
        if (includePatterns.isEmpty()) {
            return true; // No patterns means include all
        }
        return includePatterns.stream()
            .anyMatch(pattern -> pattern.matcher(workspaceName).matches());
    }
    
    /**
     * Check if a JCR path matches any exclude pattern.
     */
    public boolean isPathExcluded(String jcrPath) {
        return excludePatterns.stream()
            .anyMatch(pattern -> pattern.matcher(jcrPath).matches());
    }
    
    private Path projectRoot;
    
    /**
     * Set the project root directory (used to resolve relative data.dir paths).
     */
    public void setProjectRoot(Path projectRoot) {
        this.projectRoot = projectRoot;
    }
    
    /**
     * Get the data directory path, resolved relative to project root if set.
     */
    public Path getDataDirectory() {
        Path dataPath = Paths.get(dataDir);
        if (projectRoot != null && !dataPath.isAbsolute()) {
            // Resolve relative to project root
            return projectRoot.resolve(dataPath).normalize();
        }
        return dataPath;
    }
    
    /**
     * Check if synchronization is enabled.
     */
    public boolean isSyncEnabled() {
        return syncEnabled;
    }
    
    /**
     * Check if initial sync should be performed on startup.
     */
    public boolean isInitialSyncEnabled() {
        return initialSync;
    }
    
    /**
     * Get all configured include patterns.
     */
    public List<Pattern> getIncludePatterns() {
        return new ArrayList<>(includePatterns);
    }
    
    /**
     * Get all configured exclude patterns.
     */
    public List<Pattern> getExcludePatterns() {
        return new ArrayList<>(excludePatterns);
    }
    
    /**
     * Get the set of property prefixes to exclude from XML export.
     * Properties starting with these prefixes will be excluded (except jcr:primaryType).
     * 
     * @return Set of property prefixes (e.g., "mgnl:", "jcr:")
     */
    public java.util.Set<String> getExcludePropertyPrefixes() {
        return new java.util.HashSet<>(excludePropertyPrefixes);
    }
}

