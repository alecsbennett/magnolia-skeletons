package info.magnolia.contenttransfer.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Service for managing content transfer configuration.
 * Configuration is provided via JSON and includes output settings and workspace settings.
 */
public class ContentTransferConfigurationService {
    
    private static final Logger log = LoggerFactory.getLogger(ContentTransferConfigurationService.class);
    
    private OutputConfig outputConfig;
    private List<WorkspaceConfig> workspaceConfigs;
    
    /**
     * Initialize configuration from JSON.
     * 
     * @param configJson JSON configuration object
     */
    public void initialize(Map<String, Object> configJson) {
        log.info("Initializing Content Transfer Configuration");
        
        // Parse output configuration
        @SuppressWarnings("unchecked")
        Map<String, Object> outputMap = (Map<String, Object>) configJson.get("output");
        if (outputMap != null) {
            outputConfig = new OutputConfig(outputMap);
            log.info("Output configuration: type={}, destination={}", 
                outputConfig.getType(), outputConfig.getDestinationPath());
        } else {
            log.warn("No output configuration provided");
        }
        
        // Parse workspace configurations
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> workspacesList = (List<Map<String, Object>>) configJson.get("workspaces");
        workspaceConfigs = new ArrayList<>();
        if (workspacesList != null) {
            for (Map<String, Object> workspaceMap : workspacesList) {
                WorkspaceConfig workspaceConfig = new WorkspaceConfig(workspaceMap);
                workspaceConfigs.add(workspaceConfig);
                log.info("Workspace configuration: workspace={}, mode={}, paths={}", 
                    workspaceConfig.getWorkspace(), workspaceConfig.getMode(), workspaceConfig.getPaths());
            }
        } else {
            log.warn("No workspace configurations provided");
        }
    }
    
    public OutputConfig getOutputConfig() {
        return outputConfig;
    }
    
    public List<WorkspaceConfig> getWorkspaceConfigs() {
        return workspaceConfigs;
    }
    
    public WorkspaceConfig getWorkspaceConfig(String workspaceName) {
        if (workspaceConfigs == null) {
            return null;
        }
        for (WorkspaceConfig config : workspaceConfigs) {
            if (config.getWorkspace().equals(workspaceName)) {
                return config;
            }
        }
        return null;
    }
    
    /**
     * Check if a path matches any of the configured path patterns for a workspace.
     */
    public boolean matchesPath(String workspaceName, String jcrPath) {
        WorkspaceConfig config = getWorkspaceConfig(workspaceName);
        if (config == null) {
            return false;
        }
        return config.matchesPath(jcrPath);
    }
    
    /**
     * Output configuration.
     */
    public static class OutputConfig {
        private final String type;
        private final String destinationPath;
        private final Map<String, Object> settings;
        private final List<FilterConfig> filters;
        
        public OutputConfig(Map<String, Object> outputMap) {
            this.type = (String) outputMap.get("type");
            this.destinationPath = (String) outputMap.get("destinationPath");
            @SuppressWarnings("unchecked")
            Map<String, Object> settingsMap = (Map<String, Object>) outputMap.get("settings");
            this.settings = settingsMap != null ? new HashMap<>(settingsMap) : new HashMap<>();
            
            // Parse filters
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> filtersList = (List<Map<String, Object>>) outputMap.get("filters");
            this.filters = new ArrayList<>();
            if (filtersList != null) {
                for (Map<String, Object> filterMap : filtersList) {
                    try {
                        FilterConfig filterConfig = new FilterConfig(filterMap);
                        this.filters.add(filterConfig);
                    } catch (Exception e) {
                        log.warn("Invalid filter configuration, skipping: {}", filterMap, e);
                    }
                }
            }
        }
        
        public String getType() {
            return type;
        }
        
        public String getDestinationPath() {
            return destinationPath;
        }
        
        public Map<String, Object> getSettings() {
            return settings;
        }
        
        public Object getSetting(String key) {
            return settings.get(key);
        }
        
        public String getSettingAsString(String key) {
            Object value = settings.get(key);
            return value != null ? value.toString() : null;
        }
        
        public List<FilterConfig> getFilters() {
            return filters;
        }
    }
    
    /**
     * Filter configuration for property exclusion.
     */
    public static class FilterConfig {
        private final Pattern excludePattern;
        private final Set<String> exceptions;
        
        public FilterConfig(Map<String, Object> filterMap) {
            String exclude = (String) filterMap.get("exclude");
            if (exclude == null || exclude.isEmpty()) {
                throw new IllegalArgumentException("Filter must have an 'exclude' pattern");
            }
            
            try {
                this.excludePattern = Pattern.compile(exclude);
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid exclude pattern: " + exclude, e);
            }
            
            @SuppressWarnings("unchecked")
            List<String> exceptionsList = (List<String>) filterMap.get("exceptions");
            this.exceptions = new HashSet<>();
            if (exceptionsList != null) {
                this.exceptions.addAll(exceptionsList);
            }
        }
        
        public Pattern getExcludePattern() {
            return excludePattern;
        }
        
        public Set<String> getExceptions() {
            return exceptions;
        }
        
        /**
         * Check if a property name should be excluded based on this filter.
         * 
         * @param propertyName The property name to check
         * @return true if the property should be excluded, false otherwise
         */
        public boolean shouldExclude(String propertyName) {
            // If property is in exceptions list, never exclude it
            if (exceptions.contains(propertyName)) {
                return false;
            }
            
            // Check if property matches exclude pattern
            return excludePattern.matcher(propertyName).matches();
        }
    }
    
    /**
     * Workspace configuration.
     */
    public static class WorkspaceConfig {
        private final String workspace;
        private final List<String> paths;
        private final List<Pattern> pathPatterns;
        private final String mode;
        
        public WorkspaceConfig(Map<String, Object> workspaceMap) {
            this.workspace = (String) workspaceMap.get("workspace");
            @SuppressWarnings("unchecked")
            List<String> pathsList = (List<String>) workspaceMap.get("paths");
            this.paths = pathsList != null ? new ArrayList<>(pathsList) : new ArrayList<>();
            this.mode = (String) workspaceMap.get("mode");
            
            // Compile path patterns
            this.pathPatterns = new ArrayList<>();
            for (String pathPattern : this.paths) {
                try {
                    pathPatterns.add(Pattern.compile(pathPattern));
                } catch (Exception e) {
                    log.warn("Invalid path pattern: {}", pathPattern, e);
                }
            }
        }
        
        public String getWorkspace() {
            return workspace;
        }
        
        public List<String> getPaths() {
            return paths;
        }
        
        public String getMode() {
            return mode;
        }
        
        public boolean isCombinedMode() {
            return "combined".equalsIgnoreCase(mode);
        }
        
        public boolean isNodeMode() {
            return "node".equalsIgnoreCase(mode);
        }
        
        /**
         * Check if a JCR path matches any of the configured path patterns.
         */
        public boolean matchesPath(String jcrPath) {
            if (pathPatterns.isEmpty()) {
                return false;
            }
            for (Pattern pattern : pathPatterns) {
                if (pattern.matcher(jcrPath).matches()) {
                    return true;
                }
            }
            return false;
        }
    }
}

