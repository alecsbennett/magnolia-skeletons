package info.magnolia.extendedbootstrap.bootstrap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.yaml.snakeyaml.Yaml;

import javax.jcr.Node;
import javax.jcr.Session;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * Processor for YAML-based bootstrapping of Magnolia configuration and content.
 * 
 * YAML files should be structured as:
 * workspace: config|website|dam|users
 * path: /path/to/node
 * properties:
 *   propertyName: value
 *   anotherProperty: value
 * children:
 *   - path: child/path
 *     properties:
 *       prop: value
 */
public class YamlBootstrapProcessor {
    
    private static final Logger log = LoggerFactory.getLogger(YamlBootstrapProcessor.class);
    
    private final Yaml yaml = new Yaml();
    
    /**
     * Process all YAML files in the given directory.
     */
    public void processDirectory(Path directory) {
        try {
            log.info("Scanning directory for YAML files: {}", directory);
            Files.walk(directory)
                .filter(Files::isRegularFile)
                .filter(path -> path.toString().endsWith(".yaml") || path.toString().endsWith(".yml"))
                .sorted()
                .forEach(this::processFile);
            log.info("Finished processing YAML files from directory: {}", directory);
        } catch (Exception e) {
            log.error("Error scanning bootstrap directory: {}", directory, e);
            throw new RuntimeException("Failed to process bootstrap directory", e);
        }
    }
    
    /**
     * Process a single YAML file.
     */
    private void processFile(Path filePath) {
        log.info("Processing YAML file: {}", filePath);
        try (InputStream inputStream = new FileInputStream(filePath.toFile())) {
            Map<String, Object> data = yaml.load(inputStream);
            if (data == null) {
                log.warn("YAML file is empty or invalid: {}", filePath);
                return;
            }
            
            processBootstrapData(data);
            log.info("Successfully processed YAML file: {}", filePath);
        } catch (Exception e) {
            log.error("Error processing YAML file: {}", filePath, e);
            throw new RuntimeException("Failed to process YAML file: " + filePath, e);
        }
    }
    
    /**
     * Process bootstrap data from a YAML document or Map.
     * This method can be called directly with a Map for programmatic bootstrapping.
     */
    @SuppressWarnings("unchecked")
    public void processBootstrapData(Map<String, Object> data) {
        String workspace = (String) data.get("workspace");
        if (workspace == null || workspace.trim().isEmpty()) {
            log.warn("YAML document missing 'workspace' field, skipping");
            return;
        }
        
        String path = (String) data.get("path");
        if (path == null || path.trim().isEmpty()) {
            log.warn("YAML document missing 'path' field, skipping");
            return;
        }
        
        log.info("Processing bootstrap for workspace: {}, path: {}", workspace, path);
        
        try {
            Session session = info.magnolia.context.MgnlContext.getJCRSession(workspace);
            Node node = getOrCreateNode(session, path);
            
            // Set properties
            Map<String, Object> properties = (Map<String, Object>) data.get("properties");
            if (properties != null) {
                setProperties(node, properties);
            }
            
            // Process children
            List<Map<String, Object>> children = (List<Map<String, Object>>) data.get("children");
            if (children != null) {
                processChildren(node, children);
            }
            
            session.save();
            log.info("Successfully bootstrapped node: {} in workspace: {}", path, workspace);
        } catch (Exception e) {
            log.error("Error bootstrapping node: {} in workspace: {}", path, workspace, e);
            throw new RuntimeException("Failed to bootstrap node", e);
        }
    }
    
    /**
     * Get or create a node at the given path.
     */
    private Node getOrCreateNode(Session session, String path) throws Exception {
        if (session.nodeExists(path)) {
            return session.getNode(path);
        }
        
        // Create parent path if needed
        String parentPath = path.substring(0, path.lastIndexOf('/'));
        String nodeName = path.substring(path.lastIndexOf('/') + 1);
        
        Node parent;
        if (parentPath.isEmpty() || parentPath.equals("/")) {
            parent = session.getRootNode();
        } else {
            parent = getOrCreateNode(session, parentPath);
        }
        
        Node node = parent.addNode(nodeName, "mgnl:contentNode");
        return node;
    }
    
    /**
     * Set properties on a node from a map.
     */
    @SuppressWarnings("unchecked")
    private void setProperties(Node node, Map<String, Object> properties) throws Exception {
        for (Map.Entry<String, Object> entry : properties.entrySet()) {
            String propName = entry.getKey();
            Object value = entry.getValue();
            
            if (value == null) {
                continue;
            }
            
            // Handle different value types
            if (value instanceof String) {
                node.setProperty(propName, (String) value);
            } else if (value instanceof Boolean) {
                node.setProperty(propName, (Boolean) value);
            } else if (value instanceof Integer) {
                node.setProperty(propName, (Long) ((Integer) value).longValue());
            } else if (value instanceof Long) {
                node.setProperty(propName, (Long) value);
            } else if (value instanceof Double || value instanceof Float) {
                node.setProperty(propName, ((Number) value).doubleValue());
            } else if (value instanceof List) {
                // Multi-value property
                List<?> list = (List<?>) value;
                if (!list.isEmpty()) {
                    Object first = list.get(0);
                    if (first instanceof String) {
                        String[] stringArray = list.toArray(new String[0]);
                        node.setProperty(propName, stringArray);
                    } else {
                        log.warn("Unsupported multi-value type for property {}: {}", propName, first.getClass());
                    }
                }
            } else {
                log.warn("Unsupported property type for {}: {}", propName, value.getClass());
            }
        }
    }
    
    /**
     * Process child nodes recursively.
     */
    @SuppressWarnings("unchecked")
    private void processChildren(Node parent, List<Map<String, Object>> children) throws Exception {
        for (Map<String, Object> childData : children) {
            String childPath = (String) childData.get("path");
            if (childPath == null || childPath.trim().isEmpty()) {
                log.warn("Child node missing 'path' field, skipping");
                continue;
            }
            
            // Remove leading slash if present (relative to parent)
            if (childPath.startsWith("/")) {
                childPath = childPath.substring(1);
            }
            
            Node childNode = parent.hasNode(childPath) 
                ? parent.getNode(childPath) 
                : parent.addNode(childPath, "mgnl:contentNode");
            
            // Set properties
            Map<String, Object> properties = (Map<String, Object>) childData.get("properties");
            if (properties != null) {
                setProperties(childNode, properties);
            }
            
            // Process nested children
            List<Map<String, Object>> nestedChildren = (List<Map<String, Object>>) childData.get("children");
            if (nestedChildren != null) {
                processChildren(childNode, nestedChildren);
            }
        }
    }
}

