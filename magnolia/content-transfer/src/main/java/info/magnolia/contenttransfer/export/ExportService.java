package info.magnolia.contenttransfer.export;

import info.magnolia.contenttransfer.config.ContentTransferConfigurationService;
import info.magnolia.contenttransfer.output.OutputDestination;
import info.magnolia.contenttransfer.xml.XmlSerializationService;
import info.magnolia.repository.RepositoryManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.Node;
import javax.jcr.NodeIterator;
import javax.jcr.RepositoryException;
import javax.jcr.Session;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Service for exporting JCR content to configured output destinations.
 */
public class ExportService {
    
    private static final Logger log = LoggerFactory.getLogger(ExportService.class);
    
    private final XmlSerializationService xmlService;
    private final RepositoryManager repositoryManager;
    
    public ExportService(
            ContentTransferConfigurationService configService,
            XmlSerializationService xmlService,
            RepositoryManager repositoryManager) {
        // Note: configService parameter kept for backward compatibility but not stored
        // Configuration is now passed per-request
        this.xmlService = xmlService;
        this.repositoryManager = repositoryManager;
    }
    
    /**
     * Perform export operation based on configuration.
     * @return Map with export statistics including document count
     */
    public java.util.Map<String, Object> export(java.util.Map<String, Object> configMap) throws Exception {
        log.info("Starting export operation");
        
        // Parse configuration from map
        ContentTransferConfigurationService configService = new ContentTransferConfigurationService();
        configService.initialize(configMap);
        
        if (configService.getOutputConfig() == null) {
            throw new IllegalStateException("Output configuration not set in provided configuration.");
        }
        
        List<ContentTransferConfigurationService.WorkspaceConfig> workspaceConfigs = 
            configService.getWorkspaceConfigs();
        
        if (workspaceConfigs == null || workspaceConfigs.isEmpty()) {
            throw new IllegalStateException("No workspace configurations found in provided configuration.");
        }
        
        final int[] totalDocuments = {0};
        
        // Execute in system context
        info.magnolia.context.MgnlContext.doInSystemContext(() -> {
            try {
                OutputDestination output = createOutputDestination(configService);
                for (ContentTransferConfigurationService.WorkspaceConfig workspaceConfig : workspaceConfigs) {
                    int count = exportWorkspace(workspaceConfig, configService, output);
                    totalDocuments[0] += count;
                }
            } catch (Exception e) {
                log.error("Error during export", e);
                throw new RuntimeException(e);
            }
            return null;
        });
        
        java.util.Map<String, Object> result = new java.util.HashMap<>();
        result.put("documentsExported", totalDocuments[0]);
        result.put("message", "Export completed successfully");
        
        log.info("Export operation completed: {} documents exported", totalDocuments[0]);
        return result;
    }
    
    /**
     * Export a workspace based on its configuration.
     * @return Number of documents exported
     */
    private int exportWorkspace(
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            ContentTransferConfigurationService configService,
            OutputDestination output) 
            throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        log.info("Exporting workspace: {}", workspaceName);
        
        Session session = info.magnolia.context.MgnlContext.getJCRSession(workspaceName);
        
        if (workspaceConfig.isCombinedMode()) {
            return exportCombinedMode(session, workspaceConfig, output);
        } else if (workspaceConfig.isNodeMode()) {
            return exportNodeMode(session, workspaceConfig, configService, output);
        } else {
            log.warn("Unknown export mode for workspace {}: {}", workspaceName, workspaceConfig.getMode());
            return 0;
        }
    }
    
    /**
     * Export in combined mode - single XML file per workspace.
     * @return Number of documents exported (always 1 for combined mode)
     */
    private int exportCombinedMode(
            Session session, 
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) 
            throws RepositoryException, IOException, Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        List<String> paths = workspaceConfig.getPaths();
        
        // For combined mode, export all matching paths as a single file
        // We'll export from root and include all matching nodes
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        
        try {
            // Start XML document
            java.io.PrintWriter pw = new java.io.PrintWriter(baos);
            pw.println("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
            pw.println("<sv:root xmlns:sv=\"http://www.jcp.org/jcr/sv/1.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">");
            
            // Export each matching path
            for (String pathPattern : paths) {
                exportPathPattern(session, pathPattern, pw, 1);
            }
            
            pw.println("</sv:root>");
            pw.flush();
            
            // Write to output destination
            String filename = workspaceName + "-export.xml";
            output.write(filename, baos.toByteArray());
            
            log.info("Exported workspace {} in combined mode to {}", workspaceName, filename);
            return 1; // Combined mode exports 1 file
            
        } finally {
            baos.close();
        }
    }
    
    /**
     * Export in node mode - separate XML file per primary node.
     * @return Number of documents exported
     */
    private int exportNodeMode(
            Session session, 
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            ContentTransferConfigurationService configService,
            OutputDestination output) 
            throws RepositoryException, IOException, Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        List<String> paths = workspaceConfig.getPaths();
        
        int documentCount = 0;
        
        // For each path pattern, find matching nodes and export each separately
        for (String pathPattern : paths) {
            List<String> matchingPaths = findMatchingPaths(session, pathPattern);
            
            for (String nodePath : matchingPaths) {
                if (!session.nodeExists(nodePath)) {
                    continue;
                }
                
                Node node = session.getNode(nodePath);
                String nodeName = node.getName();
                String nodeType = node.getPrimaryNodeType().getName();
                
                // Skip system nodes during export (double-check)
                if (shouldSkipNode(nodePath, nodeName, nodeType)) {
                    log.debug("Skipping system node during export: {}", nodePath);
                    continue;
                }
                
                // Export this node as a separate file
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                try {
                    xmlService.exportNodeToXml(session, nodePath, baos, configService);
                    
                    // Create file path matching ideal structure:
                    // /home -> website/home.xml
                    // /home/homechild -> website/home/homechild.xml
                    String relativePath = buildFilePath(workspaceName, nodePath);
                    
                    output.write(relativePath, baos.toByteArray());
                    log.debug("Exported node {} to {}", nodePath, relativePath);
                    documentCount++;
                    
                } finally {
                    baos.close();
                }
            }
        }
        
        log.info("Exported workspace {} in node mode: {} documents", workspaceName, documentCount);
        return documentCount;
    }
    
    /**
     * Export a path pattern (recursively finds matching nodes).
     */
    private void exportPathPattern(Session session, String pathPattern, java.io.PrintWriter pw, int indent) 
            throws RepositoryException {
        
        // Simple pattern matching - if pattern is ".*", export root
        if (pathPattern.equals(".*")) {
            if (session.nodeExists("/")) {
                exportNodeRecursive(session, "/", pw, indent);
            }
        } else {
            // Try to find nodes matching the pattern
            List<String> matchingPaths = findMatchingPaths(session, pathPattern);
            for (String path : matchingPaths) {
                if (session.nodeExists(path)) {
                    exportNodeRecursive(session, path, pw, indent);
                }
            }
        }
    }
    
    /**
     * Export a node recursively to PrintWriter (for combined mode).
     */
    private void exportNodeRecursive(Session session, String nodePath, java.io.PrintWriter pw, int indent) 
            throws RepositoryException {
        
        Node node = session.getNode(nodePath);
        String nodeName = node.getName();
        String nodeType = node.getPrimaryNodeType().getName();
        
        // Write node opening tag
        addIndent(pw, indent);
        pw.print("<sv:node sv:name=\"");
        pw.print(escapeXml(nodeName));
        pw.println("\">");
        
        // Export properties (simplified - reuse logic from XmlSerializationService)
        // For now, just export primary type
        addIndent(pw, indent + 1);
        pw.print("<sv:property sv:name=\"jcr:primaryType\" sv:type=\"Name\">");
        pw.print("<sv:value>");
        pw.print(escapeXml(nodeType));
        pw.println("</sv:value></sv:property>");
        
        // Export child nodes
        NodeIterator children = node.getNodes();
        while (children.hasNext()) {
            Node child = children.nextNode();
            String childPath = child.getPath();
            String childType = child.getPrimaryNodeType().getName();
            
            // Skip child nodes with same type as parent
            if (childType.equals(nodeType)) {
                continue;
            }
            
            exportNodeRecursive(session, childPath, pw, indent + 1);
        }
        
        // Write node closing tag
        addIndent(pw, indent);
        pw.println("</sv:node>");
    }
    
    /**
     * Find paths matching a pattern.
     * For ".*" pattern, recursively finds all primary nodes.
     */
    private List<String> findMatchingPaths(Session session, String pattern) throws RepositoryException {
        List<String> paths = new ArrayList<>();
        
        if (pattern.equals(".*")) {
            // Recursively find all primary nodes starting from root
            findPrimaryNodesRecursive(session, "/", paths);
        } else {
            // Try to interpret as a path
            if (session.nodeExists(pattern)) {
                paths.add(pattern);
            }
        }
        
        return paths;
    }
    
    /**
     * Recursively find all primary nodes (nodes that should be exported as separate files).
     * Exports all nodes except system nodes (jcr:system, rep:accesscontrol, etc.).
     */
    private void findPrimaryNodesRecursive(Session session, String nodePath, List<String> paths) 
            throws RepositoryException {
        
        if (!session.nodeExists(nodePath)) {
            return;
        }
        
        Node node = session.getNode(nodePath);
        String nodeName = node.getName();
        String nodeType = node.getPrimaryNodeType().getName();
        
        // Skip system nodes that shouldn't be exported
        if (shouldSkipNode(nodePath, nodeName, nodeType)) {
            return;
        }
        
        // Add this node to paths (skip root)
        if (!nodePath.equals("/")) {
            paths.add(nodePath);
        }
        
        // Recursively process children - export ALL children regardless of type
        // This ensures child pages are exported even if they have the same type as parent
        NodeIterator children = node.getNodes();
        while (children.hasNext()) {
            Node child = children.nextNode();
            String childPath = child.getPath();
            findPrimaryNodesRecursive(session, childPath, paths);
        }
    }
    
    /**
     * Check if a node should be skipped during export.
     * Skips system nodes like jcr:system, rep:accesscontrol, etc.
     */
    private boolean shouldSkipNode(String nodePath, String nodeName, String nodeType) {
        // Skip jcr:system and its children
        if (nodePath.startsWith("/jcr:system") || nodePath.equals("/jcr:system")) {
            return true;
        }
        
        // Skip rep:accesscontrol and its children
        if (nodePath.startsWith("/rep:accesscontrol") || nodePath.equals("/rep:accesscontrol")) {
            return true;
        }
        
        // Skip rep:policy nodes (access control policies)
        if (nodePath.contains("/rep:policy") || nodeName.equals("rep:policy")) {
            return true;
        }
        
        // Skip rep:system nodes
        if (nodePath.startsWith("/rep:system") || nodePath.equals("/rep:system")) {
            return true;
        }
        
        // Skip nodes with rep: namespace that are system nodes
        if (nodeType != null && nodeType.startsWith("rep:") && 
            (nodeType.contains("AccessControl") || nodeType.contains("Policy") || 
             nodeType.contains("System") || nodeType.contains("Activities"))) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Create output destination based on configuration.
     */
    private OutputDestination createOutputDestination(ContentTransferConfigurationService configService) throws Exception {
        ContentTransferConfigurationService.OutputConfig outputConfig = configService.getOutputConfig();
        String type = outputConfig.getType();
        
        OutputDestination destination;
        switch (type.toLowerCase()) {
            case "filesystem":
                destination = new info.magnolia.contenttransfer.output.FileSystemOutputDestination();
                break;
            case "s3":
                destination = new info.magnolia.contenttransfer.output.S3OutputDestination();
                break;
            case "sftp":
                destination = new info.magnolia.contenttransfer.output.SftpOutputDestination();
                break;
            case "onedrive":
                destination = new info.magnolia.contenttransfer.output.OneDriveOutputDestination();
                break;
            default:
                throw new IllegalArgumentException("Unknown output type: " + type);
        }
        
        destination.initialize(outputConfig.getDestinationPath(), outputConfig.getSettings());
        return destination;
    }
    
    /**
     * Build file path matching ideal structure where each node becomes a file
     * and child nodes go into folders named after their parents.
     * 
     * Examples:
     * - /home -> website/home.xml
     * - /home/homechild -> website/home/homechild.xml
     * 
     * @param workspaceName The workspace name
     * @param nodePath The JCR node path (e.g., "/home" or "/home/homechild")
     * @return Relative file path (e.g., "website/home.xml" or "website/home/homechild.xml")
     */
    private String buildFilePath(String workspaceName, String nodePath) {
        if (nodePath == null || nodePath.isEmpty() || nodePath.equals("/")) {
            return workspaceName + "/.xml";
        }
        
        // Remove leading slash
        String path = nodePath.startsWith("/") ? nodePath.substring(1) : nodePath;
        
        // Sanitize each segment (replace problematic characters)
        String[] segments = path.split("/");
        StringBuilder filePath = new StringBuilder(workspaceName);
        
        for (int i = 0; i < segments.length; i++) {
            String segment = segments[i];
            // Sanitize segment
            segment = segment.replace(":", "_").replace(" ", "_");
            
            if (i < segments.length - 1) {
                // Parent segments become folders
                filePath.append("/").append(segment);
            } else {
                // Last segment becomes the filename
                filePath.append("/").append(segment).append(".xml");
            }
        }
        
        return filePath.toString();
    }
    
    /**
     * Sanitize a JCR path for use as a file path, preserving folder structure.
     * Removes leading slash and sanitizes problematic characters.
     * Example: "/home/homechild" -> "home/homechild"
     */
    private String sanitizePath(String path) {
        if (path == null || path.isEmpty()) {
            return "";
        }
        
        // Remove leading slash
        String sanitized = path.startsWith("/") ? path.substring(1) : path;
        
        // Replace problematic characters but preserve folder structure
        sanitized = sanitized.replace(":", "_").replace(" ", "_");
        
        return sanitized;
    }
    
    /**
     * Escape XML special characters.
     */
    private String escapeXml(String str) {
        if (str == null) return "";
        return str.replace("&", "&amp;")
                  .replace("<", "&lt;")
                  .replace(">", "&gt;")
                  .replace("\"", "&quot;")
                  .replace("'", "&apos;");
    }
    
    /**
     * Add indentation to PrintWriter.
     */
    private void addIndent(java.io.PrintWriter pw, int level) {
        for (int i = 0; i < level; i++) {
            pw.print("\t");
        }
    }
}

