package info.magnolia.extendedbootstrap;

import info.magnolia.extendedbootstrap.bootstrap.YamlBootstrapProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

/**
 * Module for YAML-based bootstrapping of Magnolia configuration and content.
 * 
 * This module replaces the deprecated magnolia.inject.config functionality
 * and provides a more flexible YAML-based approach for bootstrapping.
 * 
 * Configuration:
 * - System property: magnolia.bootstrap.yaml.dir - Directory containing YAML bootstrap files
 * - Default: ${magnolia.home}/bootstrap/yaml
 * 
 * License Configuration (alternative to YAML files):
 * - System properties: magnolia.license.owner and magnolia.license.key
 * - These will be used to bootstrap the Enterprise license if YAML files are not found
 */
public class ExtendedBootstrapModule {
    
    private static final Logger log = LoggerFactory.getLogger(ExtendedBootstrapModule.class);
    
    private static final String BOOTSTRAP_DIR_PROPERTY = "magnolia.bootstrap.yaml.dir";
    private static final String DEFAULT_BOOTSTRAP_DIR = "bootstrap/yaml";
    private static final String LICENSE_OWNER_PROPERTY = "magnolia.license.owner";
    private static final String LICENSE_KEY_PROPERTY = "magnolia.license.key";
    
    public ExtendedBootstrapModule() {
        log.info("ExtendedBootstrapModule instantiated");
        // Configure license immediately (synchronously) if system properties are set
        // This needs to happen before Magnolia checks for license
        configureLicenseImmediately();
        // Then process YAML files in background
        processBootstrapFiles();
    }
    
    /**
     * Configure license immediately from system properties if available.
     * This runs synchronously to ensure license is configured before Magnolia checks for it.
     */
    private void configureLicenseImmediately() {
        final String licenseOwner = System.getProperty(LICENSE_OWNER_PROPERTY);
        final String licenseKey = System.getProperty(LICENSE_KEY_PROPERTY);
        
        if (licenseOwner == null || licenseOwner.trim().isEmpty() 
            || licenseKey == null || licenseKey.trim().isEmpty()) {
            log.info("License properties not set (magnolia.license.owner={}, magnolia.license.key={}), skipping immediate license configuration", 
                licenseOwner != null ? "set" : "null", licenseKey != null ? "set" : "null");
            return;
        }
        
        log.info("License properties found! Configuring license immediately from system properties (owner: {})", licenseOwner);
        try {
            // Try to configure synchronously - if MgnlContext isn't ready, it will be configured during bootstrap task
            info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                try {
                    YamlBootstrapProcessor processor = new YamlBootstrapProcessor();
                    Map<String, Object> licenseData = new HashMap<>();
                    licenseData.put("workspace", "config");
                    licenseData.put("path", "/modules/enterprise/license");
                    Map<String, Object> properties = new HashMap<>();
                    properties.put("owner", licenseOwner);
                    properties.put("key", licenseKey);
                    licenseData.put("properties", properties);
                    processor.processBootstrapData(licenseData);
                    log.info("License configured successfully during module initialization");
                } catch (Exception e) {
                    log.warn("Could not configure license immediately (MgnlContext may not be ready), will be configured during bootstrap task: {}", e.getMessage());
                }
                return null;
            });
        } catch (Exception e) {
            log.info("MgnlContext not yet available, license will be configured during bootstrap task: {}", e.getMessage());
        }
    }
    
    /**
     * Process YAML bootstrap files from the configured directory.
     * Runs in background thread after Magnolia is initialized.
     */
    private void processBootstrapFiles() {
        String bootstrapDir = System.getProperty(BOOTSTRAP_DIR_PROPERTY);
        if (bootstrapDir == null || bootstrapDir.trim().isEmpty()) {
            // Try to get from magnolia.home
            String magnoliaHome = System.getProperty("magnolia.home");
            if (magnoliaHome != null && !magnoliaHome.trim().isEmpty()) {
                bootstrapDir = new File(magnoliaHome, DEFAULT_BOOTSTRAP_DIR).getAbsolutePath();
            }
        }
        
        final boolean hasYamlFiles;
        final String finalBootstrapDir = bootstrapDir;
        if (finalBootstrapDir != null && !finalBootstrapDir.trim().isEmpty()) {
            Path bootstrapPath = Paths.get(finalBootstrapDir);
            if (Files.exists(bootstrapPath) && Files.isDirectory(bootstrapPath)) {
                hasYamlFiles = true;
                log.info("YAML bootstrap directory found: {}", finalBootstrapDir);
            } else {
                hasYamlFiles = false;
            }
        } else {
            hasYamlFiles = false;
        }
        
        if (!hasYamlFiles) {
            log.debug("No YAML bootstrap directory found, skipping YAML processing");
            return;
        }
        
        // Use a thread to delay execution until Magnolia is fully initialized
        Thread bootstrapThread = new Thread(() -> {
            try {
                // Wait for Magnolia to initialize repositories
                Thread.sleep(3000);
                log.info("Starting YAML bootstrap processing");
                
                // Use system context to get JCR sessions (required for background threads)
                info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                    try {
                        YamlBootstrapProcessor processor = new YamlBootstrapProcessor();
                        Path bootstrapPath = Paths.get(finalBootstrapDir);
                        processor.processDirectory(bootstrapPath);
                        log.info("YAML bootstrap processing completed");
                    } catch (Exception e) {
                        log.error("Error processing YAML bootstrap files", e);
                    }
                    return null;
                });
            } catch (Exception e) {
                log.error("Error processing YAML bootstrap files on startup", e);
            }
        }, "ExtendedBootstrap-YAML-Processing");
        bootstrapThread.setDaemon(true);
        bootstrapThread.start();
        log.info("Started YAML bootstrap processing thread");
    }
}

