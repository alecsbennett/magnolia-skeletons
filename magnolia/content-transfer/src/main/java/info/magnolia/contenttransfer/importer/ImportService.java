package info.magnolia.contenttransfer.importer;

import info.magnolia.contenttransfer.config.ContentTransferConfigurationService;
import info.magnolia.contenttransfer.output.OutputDestination;
import info.magnolia.contenttransfer.xml.XmlSerializationService;
import info.magnolia.repository.RepositoryManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.jcr.Session;
import java.io.InputStream;
import java.util.List;

/**
 * Service for importing JCR content from configured output destinations.
 */
public class ImportService {
    
    private static final Logger log = LoggerFactory.getLogger(ImportService.class);
    
    private final XmlSerializationService xmlService;
    private final RepositoryManager repositoryManager;
    
    public ImportService(
            ContentTransferConfigurationService configService,
            XmlSerializationService xmlService,
            RepositoryManager repositoryManager) {
        // Note: configService parameter kept for backward compatibility but not stored
        // Configuration is now passed per-request
        this.xmlService = xmlService;
        this.repositoryManager = repositoryManager;
    }
    
    /**
     * Perform import operation based on configuration.
     * @return Map with import statistics including document count
     */
    public java.util.Map<String, Object> importContent(java.util.Map<String, Object> configMap) throws Exception {
        log.info("Starting import operation");
        
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
                    int count = importWorkspace(workspaceConfig, output);
                    totalDocuments[0] += count;
                }
            } catch (Exception e) {
                log.error("Error during import", e);
                throw new RuntimeException(e);
            }
            return null;
        });
        
        java.util.Map<String, Object> result = new java.util.HashMap<>();
        result.put("documentsImported", totalDocuments[0]);
        result.put("message", "Import completed successfully");
        
        log.info("Import operation completed: {} documents imported", totalDocuments[0]);
        return result;
    }
    
    /**
     * Import a workspace based on its configuration.
     * @return Number of documents imported
     */
    private int importWorkspace(
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        log.info("Importing workspace: {}", workspaceName);
        
        Session session = info.magnolia.context.MgnlContext.getJCRSession(workspaceName);
        
        if (workspaceConfig.isCombinedMode()) {
            return importCombinedMode(session, workspaceConfig, output);
        } else if (workspaceConfig.isNodeMode()) {
            return importNodeMode(session, workspaceConfig, output);
        } else {
            log.warn("Unknown import mode for workspace {}: {}", workspaceName, workspaceConfig.getMode());
            return 0;
        }
    }
    
    /**
     * Import in combined mode - single XML file per workspace.
     * @return Number of documents imported (always 1 for combined mode)
     */
    private int importCombinedMode(
            Session session,
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        String filename = workspaceName + "-export.xml";
        
        if (!output.exists(filename)) {
            log.warn("Export file not found: {}", filename);
            return 0;
        }
        
        try (InputStream is = output.getInputStream(filename)) {
            // Import to root
            xmlService.importXmlToNode(session, "/", is);
            log.info("Imported workspace {} from combined file {}", workspaceName, filename);
            return 1; // Combined mode imports 1 file
        }
    }
    
    /**
     * Import in node mode - separate XML files per node.
     * Files are structured as: workspaceName/segment1/segment2/node.xml
     * Which maps to JCR path: /segment1/segment2/node
     * @return Number of documents imported
     */
    private int importNodeMode(
            Session session,
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        String prefix = workspaceName + "/";
        
        // List all files in the workspace directory recursively
        List<String> files = output.listFiles(prefix);
        
        // Sort files to process parents before children
        files.sort((a, b) -> {
            int depthA = a.substring(prefix.length()).split("/").length;
            int depthB = b.substring(prefix.length()).split("/").length;
            return Integer.compare(depthA, depthB);
        });
        
        int documentCount = 0;
        
        for (String filePath : files) {
            if (!filePath.endsWith(".xml")) {
                continue;
            }
            
            // Extract node path from filename
            // File path: workspaceName/segment1/segment2/node.xml
            // JCR path: /segment1/segment2/node
            String relativePath = filePath.substring(prefix.length());
            // Remove .xml extension
            String pathWithoutExt = relativePath.substring(0, relativePath.length() - 4);
            // Convert file path segments back to JCR path
            // Replace underscores back to colons/spaces if needed, but keep structure
            String[] segments = pathWithoutExt.split("/");
            StringBuilder jcrPath = new StringBuilder();
            for (String segment : segments) {
                if (jcrPath.length() == 0) {
                    jcrPath.append("/");
                } else {
                    jcrPath.append("/");
                }
                // Reverse sanitization: _ back to : or space
                segment = segment.replace("_", ":");
                jcrPath.append(segment);
            }
            String nodePath = jcrPath.toString();
            
            try (InputStream is = output.getInputStream(filePath)) {
                // Import the node (will update if exists, create if not)
                xmlService.importXmlToNode(session, nodePath, is);
                log.debug("Imported node {} from file {}", nodePath, filePath);
                documentCount++;
            } catch (Exception e) {
                log.error("Error importing node from file {}: {}", filePath, e.getMessage(), e);
            }
        }
        
        log.info("Imported workspace {} from {} files: {} documents", workspaceName, files.size(), documentCount);
        return documentCount;
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
}

