package info.magnolia.extendedbootstrap.setup;

import info.magnolia.module.DefaultModuleVersionHandler;
import info.magnolia.module.InstallContext;
import info.magnolia.module.delta.DeltaBuilder;
import info.magnolia.module.delta.Task;
import info.magnolia.module.model.Version;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Version handler for the Extended Bootstrap module.
 * 
 * Registers bootstrap tasks for YAML-based configuration and content bootstrapping.
 */
public class ExtendedBootstrapModuleVersionHandler extends DefaultModuleVersionHandler {

    private static final Logger log = LoggerFactory.getLogger(ExtendedBootstrapModuleVersionHandler.class);

    public ExtendedBootstrapModuleVersionHandler() {
        log.info("ExtendedBootstrapModuleVersionHandler constructor called");
        try {
            log.info("Creating bootstrap tasks for YAML-based bootstrapping");
            ProcessYamlBootstrapTask bootstrapTask = new ProcessYamlBootstrapTask();
            log.info("ProcessYamlBootstrapTask created: {}", bootstrapTask.getName());
            
            // Register for initial install
            DeltaBuilder installDelta = DeltaBuilder.install(Version.parseVersion("1.0.0"), "Initial install");
            log.info("DeltaBuilder.install created for version 1.0.0");
            installDelta.addTask(bootstrapTask);
            register(installDelta);
            
            log.info("DeltaBuilder registered successfully");
        } catch (Exception e) {
            log.error("Error in ExtendedBootstrapModuleVersionHandler constructor", e);
            throw new RuntimeException("Failed to initialize ExtendedBootstrapModuleVersionHandler", e);
        }
    }

    /**
     * Task to process YAML bootstrap files during module installation.
     */
    public static class ProcessYamlBootstrapTask implements Task {
        
        private static final Logger taskLog = LoggerFactory.getLogger(ExtendedBootstrapModuleVersionHandler.class);
        
        @Override
        public String getName() {
            return "Process YAML bootstrap files";
        }

        @Override
        public String getDescription() {
            return "Processes YAML files for bootstrapping configuration and content.";
        }

        @Override
        public void execute(InstallContext ctx) {
            taskLog.info("ProcessYamlBootstrapTask.execute() called");
            taskLog.info("Task name: {}, description: {}", getName(), getDescription());
            
            try {
                info.magnolia.extendedbootstrap.bootstrap.YamlBootstrapProcessor processor = 
                    new info.magnolia.extendedbootstrap.bootstrap.YamlBootstrapProcessor();
                
                // First, configure license from system properties if available (needs to happen early)
                String licenseOwner = System.getProperty("magnolia.license.owner");
                String licenseKey = System.getProperty("magnolia.license.key");
                if (licenseOwner != null && !licenseOwner.trim().isEmpty() 
                    && licenseKey != null && !licenseKey.trim().isEmpty()) {
                    taskLog.info("Configuring license from system properties during bootstrap");
                    try {
                        java.util.Map<String, Object> licenseData = new java.util.HashMap<>();
                        licenseData.put("workspace", "config");
                        licenseData.put("path", "/modules/enterprise/license");
                        java.util.Map<String, Object> properties = new java.util.HashMap<>();
                        properties.put("owner", licenseOwner);
                        properties.put("key", licenseKey);
                        licenseData.put("properties", properties);
                        processor.processBootstrapData(licenseData);
                        taskLog.info("License configuration completed during bootstrap");
                    } catch (Exception e) {
                        taskLog.error("Error configuring license during bootstrap", e);
                    }
                }
                
                // Then process YAML files if directory exists
                String bootstrapDir = System.getProperty("magnolia.bootstrap.yaml.dir");
                if (bootstrapDir == null || bootstrapDir.trim().isEmpty()) {
                    // Try to get from magnolia.home
                    String magnoliaHome = System.getProperty("magnolia.home");
                    if (magnoliaHome != null && !magnoliaHome.trim().isEmpty()) {
                        bootstrapDir = new java.io.File(magnoliaHome, "bootstrap/yaml").getAbsolutePath();
                    }
                }
                
                if (bootstrapDir != null && !bootstrapDir.trim().isEmpty()) {
                    java.nio.file.Path bootstrapPath = java.nio.file.Paths.get(bootstrapDir);
                    if (java.nio.file.Files.exists(bootstrapPath) && java.nio.file.Files.isDirectory(bootstrapPath)) {
                        taskLog.info("Processing YAML bootstrap files from: {}", bootstrapDir);
                        processor.processDirectory(bootstrapPath);
                        taskLog.info("YAML bootstrap processing completed");
                    } else {
                        taskLog.info("Bootstrap directory does not exist: {}. Skipping YAML bootstrap.", bootstrapDir);
                    }
                } else {
                    taskLog.info("Bootstrap directory not configured, skipping YAML bootstrap");
                }
            } catch (Exception e) {
                taskLog.error("Error processing bootstrap", e);
                // Don't throw - allow module installation to continue even if bootstrap fails
                log.error("Error processing bootstrap", e);
            }
        }
    }
}

