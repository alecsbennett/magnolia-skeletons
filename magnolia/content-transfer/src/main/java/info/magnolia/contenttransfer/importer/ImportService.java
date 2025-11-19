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
    
    private final ContentTransferConfigurationService configService;
    private final XmlSerializationService xmlService;
    private final RepositoryManager repositoryManager;
    
    public ImportService(
            ContentTransferConfigurationService configService,
            XmlSerializationService xmlService,
            RepositoryManager repositoryManager) {
        this.configService = configService;
        this.xmlService = xmlService;
        this.repositoryManager = repositoryManager;
    }
    
    /**
     * Perform import operation based on configuration.
     */
    public void importContent() throws Exception {
        log.info("Starting import operation");
        
        if (configService.getOutputConfig() == null) {
            throw new IllegalStateException("Output configuration not set. Call configure() first.");
        }
        
        List<ContentTransferConfigurationService.WorkspaceConfig> workspaceConfigs = 
            configService.getWorkspaceConfigs();
        
        if (workspaceConfigs == null || workspaceConfigs.isEmpty()) {
            throw new IllegalStateException("No workspace configurations found. Call configure() first.");
        }
        
        // Execute in system context
        info.magnolia.context.MgnlContext.doInSystemContext(() -> {
            try {
                OutputDestination output = createOutputDestination();
                
                for (ContentTransferConfigurationService.WorkspaceConfig workspaceConfig : workspaceConfigs) {
                    importWorkspace(workspaceConfig, output);
                }
            } catch (Exception e) {
                log.error("Error during import", e);
                throw new RuntimeException(e);
            }
            return null;
        });
        
        log.info("Import operation completed");
    }
    
    /**
     * Import a workspace based on its configuration.
     */
    private void importWorkspace(
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        log.info("Importing workspace: {}", workspaceName);
        
        Session session = info.magnolia.context.MgnlContext.getJCRSession(workspaceName);
        
        if (workspaceConfig.isCombinedMode()) {
            importCombinedMode(session, workspaceConfig, output);
        } else if (workspaceConfig.isNodeMode()) {
            importNodeMode(session, workspaceConfig, output);
        } else {
            log.warn("Unknown import mode for workspace {}: {}", workspaceName, workspaceConfig.getMode());
        }
    }
    
    /**
     * Import in combined mode - single XML file per workspace.
     */
    private void importCombinedMode(
            Session session,
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        String filename = workspaceName + "-export.xml";
        
        if (!output.exists(filename)) {
            log.warn("Export file not found: {}", filename);
            return;
        }
        
        try (InputStream is = output.getInputStream(filename)) {
            // Import to root
            xmlService.importXmlToNode(session, "/", is);
            log.info("Imported workspace {} from combined file {}", workspaceName, filename);
        }
    }
    
    /**
     * Import in node mode - separate XML files per node.
     */
    private void importNodeMode(
            Session session,
            ContentTransferConfigurationService.WorkspaceConfig workspaceConfig,
            OutputDestination output) throws Exception {
        
        String workspaceName = workspaceConfig.getWorkspace();
        String prefix = workspaceName + "/";
        
        // List all files in the workspace directory
        List<String> files = output.listFiles(prefix);
        
        for (String filePath : files) {
            if (!filePath.endsWith(".xml")) {
                continue;
            }
            
            // Extract node path from filename (reverse of sanitizePath)
            String relativePath = filePath.substring(prefix.length());
            String nodePath = "/" + relativePath.replace(".xml", "").replace("_", "/");
            
            try (InputStream is = output.getInputStream(filePath)) {
                // Determine parent path
                String parentPath = nodePath.equals("/") ? "/" : 
                    nodePath.substring(0, nodePath.lastIndexOf('/'));
                if (parentPath.isEmpty()) {
                    parentPath = "/";
                }
                
                // Ensure parent exists
                if (!session.nodeExists(parentPath)) {
                    log.warn("Parent path does not exist: {}", parentPath);
                    continue;
                }
                
                // Import the node
                xmlService.importXmlToNode(session, nodePath, is);
                log.debug("Imported node {} from file {}", nodePath, filePath);
            } catch (Exception e) {
                log.error("Error importing node from file {}: {}", filePath, e.getMessage(), e);
            }
        }
        
        log.info("Imported workspace {} from {} files", workspaceName, files.size());
    }
    
    /**
     * Create output destination based on configuration.
     */
    private OutputDestination createOutputDestination() throws Exception {
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

