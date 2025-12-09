package info.magnolia.contenttransfer.setup;

import info.magnolia.module.DefaultModuleVersionHandler;
import info.magnolia.module.InstallContext;
import info.magnolia.module.delta.DeltaBuilder;
import info.magnolia.module.delta.Task;
import info.magnolia.module.model.Version;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.Node;
import javax.jcr.Session;

/**
 * Version handler for the Content Transfer module.
 * 
 * Bootstraps the ContentTransferServlet registration in Magnolia's servlet configuration.
 */
public class ContentTransferModuleVersionHandler extends DefaultModuleVersionHandler {

    private static final Logger log = LoggerFactory.getLogger(ContentTransferModuleVersionHandler.class);

    public ContentTransferModuleVersionHandler() {
        log.info("ContentTransferModuleVersionHandler constructor called");
        try {
            log.info("Creating bootstrap tasks for ContentTransferServlet registration and URI security bypass");
            CreateServletConfig createServletTask = new CreateServletConfig();
            log.info("CreateServletConfig task created: {}", createServletTask.getName());
            
            CreateUriSecurityBypass createBypassTask = new CreateUriSecurityBypass();
            log.info("CreateUriSecurityBypass task created: {}", createBypassTask.getName());
            
            DeltaBuilder installDelta = DeltaBuilder.install(Version.parseVersion("1.0.0"), "Initial install");
            log.info("DeltaBuilder.install created for version 1.0.0");
            
            installDelta.addTask(createServletTask);
            installDelta.addTask(createBypassTask);
            log.info("Tasks added to DeltaBuilder");
            
            register(installDelta);
            log.info("DeltaBuilder registered successfully");
        } catch (Exception e) {
            log.error("Error in ContentTransferModuleVersionHandler constructor", e);
            throw new RuntimeException("Failed to initialize ContentTransferModuleVersionHandler", e);
        }
    }

    public static class CreateServletConfig implements Task {
        
        // Use the same logger as the outer class to ensure it's covered by package-level logging config
        private static final Logger taskLog = LoggerFactory.getLogger(ContentTransferModuleVersionHandler.class);
        
        @Override
        public String getName() {
            return "Create servlet node";
        }

        @Override
        public String getDescription() {
            return "Registers ContentTransferServlet at install time.";
        }

        @Override
        public void execute(InstallContext ctx) {
            taskLog.info("CreateServletConfig.execute() called");
            taskLog.info("Task name: {}, description: {}", getName(), getDescription());
            
            try {
                taskLog.info("Getting JCR session for 'config' workspace");
                Session session = ctx.getJCRSession("config");
                taskLog.info("JCR session obtained successfully");
                registerServletDirectly(session);
            } catch (javax.jcr.RepositoryException e) {
                taskLog.error("Failed to register ContentTransferServlet", e);
                log.error("Failed to register ContentTransferServlet", e);
                throw new RuntimeException("Failed to register ContentTransferServlet", e);
            } catch (Exception e) {
                taskLog.error("Unexpected error in CreateServletConfig.execute()", e);
                log.error("Unexpected error in CreateServletConfig.execute()", e);
                throw new RuntimeException("Unexpected error registering ContentTransferServlet", e);
            }
        }
        
        /**
         * Register the servlet directly using a JCR session.
         * This can be called from both the bootstrap task and module startup.
         */
        public static void registerServletDirectly(Session session) {
            taskLog.info("registerServletDirectly() called");
            
            try {

                String servletPath = "/server/filters/servlets/contentTransfer";
                taskLog.info("Checking if servlet node already exists: {}", servletPath);
                
                // Check if servlet node already exists
                if (session.nodeExists(servletPath)) {
                    taskLog.info("Servlet node already exists at {}, skipping creation", servletPath);
                    log.info("ContentTransferServlet already registered at {}", servletPath);
                    return;
                }
                
                taskLog.info("Servlet node does not exist, creating it");

                // Ensure parent node exists
                String servletsPath = "/server/filters/servlets";
                taskLog.info("Checking if servlets path exists: {}", servletsPath);
                
                if (!session.nodeExists(servletsPath)) {
                    taskLog.info("Servlets path does not exist, creating parent nodes");
                    Node serverNode = session.getNode("/server");
                    taskLog.info("Server node obtained: {}", serverNode.getPath());
                    
                    Node filtersNode = serverNode.hasNode("filters") ? 
                        serverNode.getNode("filters") : 
                        serverNode.addNode("filters", "mgnl:contentNode");
                    taskLog.info("Filters node obtained/created: {}", filtersNode.getPath());
                    
                    if (!filtersNode.hasNode("servlets")) {
                        filtersNode.addNode("servlets", "mgnl:contentNode");
                        taskLog.info("Servlets node created");
                    } else {
                        taskLog.info("Servlets node already exists");
                    }
                } else {
                    taskLog.info("Servlets path already exists");
                }

                taskLog.info("Getting servlets parent node");
                Node parent = session.getNode(servletsPath);
                taskLog.info("Parent node obtained: {}", parent.getPath());
                
                String servletName = "contentTransfer";
                taskLog.info("Creating servlet node: {}", servletName);
                Node servlet = parent.addNode(servletName, "mgnl:contentNode");
                taskLog.info("Servlet node created: {}", servlet.getPath());

                // Set the filter class (ServletDispatchingFilter wraps all servlets)
                String filterClass = "info.magnolia.cms.filters.ServletDispatchingFilter";
                taskLog.info("Setting filter class property: {}", filterClass);
                servlet.setProperty("class", filterClass);
                taskLog.info("Filter class property set");

                // Set the servlet class (the actual servlet implementation)
                String servletClass = "info.magnolia.contenttransfer.servlet.ContentTransferServlet";
                taskLog.info("Setting servletClass property: {}", servletClass);
                servlet.setProperty("servletClass", servletClass);
                taskLog.info("ServletClass property set");

                // Set the servlet name (as defined in module descriptor)
                taskLog.info("Setting servletName property: {}", servletName);
                servlet.setProperty("servletName", servletName);
                taskLog.info("ServletName property set");

                // Set enabled to true
                servlet.setProperty("enabled", true);
                taskLog.info("Enabled property set to true");

                // Create empty parameters node (required by ServletDispatchingFilter)
                taskLog.info("Creating parameters node");
                Node parameters = servlet.addNode("parameters", "mgnl:contentNode");
                taskLog.info("Parameters node created");

                taskLog.info("Creating mappings node");
                Node mappings = servlet.addNode("mappings", "mgnl:contentNode");
                taskLog.info("Mappings node created");
                
                String mappingName = "contentTransferMapping";
                String pattern = "/content-transfer/*";
                taskLog.info("Creating mapping node: {} with pattern: {}", mappingName, pattern);
                Node mapping = mappings.addNode(mappingName, "mgnl:contentNode");
                mapping.setProperty("pattern", pattern);
                taskLog.info("Mapping node created with pattern: {}", pattern);

                taskLog.info("Saving session");
                session.save();
                taskLog.info("Session saved successfully");
                
                taskLog.info("ContentTransferServlet successfully registered at {}", servletPath);
                log.info("ContentTransferServlet successfully registered at {}", servletPath);
            } catch (javax.jcr.RepositoryException e) {
                taskLog.error("Failed to register ContentTransferServlet", e);
                log.error("Failed to register ContentTransferServlet", e);
                throw new RuntimeException("Failed to register ContentTransferServlet", e);
            } catch (Exception e) {
                taskLog.error("Unexpected error in registerServletDirectly()", e);
                log.error("Unexpected error in registerServletDirectly()", e);
                throw new RuntimeException("Unexpected error registering ContentTransferServlet", e);
            }
        }
    }
    
    /**
     * Task to create URI security bypass for content-transfer endpoints.
     */
    public static class CreateUriSecurityBypass implements Task {
        
        private static final Logger taskLog = LoggerFactory.getLogger(ContentTransferModuleVersionHandler.class);
        
        @Override
        public String getName() {
            return "Create URI security bypass";
        }

        @Override
        public String getDescription() {
            return "Registers content-transfer endpoints in URI security bypass list to allow unauthenticated access.";
        }

        @Override
        public void execute(InstallContext ctx) {
            taskLog.info("CreateUriSecurityBypass.execute() called");
            taskLog.info("Task name: {}, description: {}", getName(), getDescription());
            
            try {
                taskLog.info("Getting JCR session for 'config' workspace");
                Session session = ctx.getJCRSession("config");
                taskLog.info("JCR session obtained successfully");
                
                String bypassPath = "/server/filters/uriSecurity/bypasses/contentTransfer";
                taskLog.info("Checking if bypass node already exists: {}", bypassPath);
                
                // Check if bypass node already exists
                if (session.nodeExists(bypassPath)) {
                    taskLog.info("Bypass node already exists at {}, skipping creation", bypassPath);
                    log.info("URI security bypass already registered at {}", bypassPath);
                    return;
                }
                
                taskLog.info("Bypass node does not exist, creating it");
                
                // Ensure parent nodes exist
                String bypassesPath = "/server/filters/uriSecurity/bypasses";
                if (!session.nodeExists(bypassesPath)) {
                    taskLog.info("Bypasses path does not exist, creating parent nodes");
                    
                    // Ensure /server/filters exists
                    String filtersPath = "/server/filters";
                    if (!session.nodeExists(filtersPath)) {
                        Node serverNode = session.getNode("/server");
                        serverNode.addNode("filters", "mgnl:contentNode");
                        taskLog.info("Filters node created");
                    }
                    
                    // Ensure /server/filters/uriSecurity exists
                    String uriSecurityPath = "/server/filters/uriSecurity";
                    if (!session.nodeExists(uriSecurityPath)) {
                        Node filtersNode = session.getNode(filtersPath);
                        filtersNode.addNode("uriSecurity", "mgnl:contentNode");
                        taskLog.info("UriSecurity node created");
                    }
                    
                    // Ensure /server/filters/uriSecurity/bypasses exists
                    Node uriSecurityNode = session.getNode(uriSecurityPath);
                    if (!uriSecurityNode.hasNode("bypasses")) {
                        uriSecurityNode.addNode("bypasses", "mgnl:contentNode");
                        taskLog.info("Bypasses node created");
                    }
                    
                    session.save();
                } else {
                    taskLog.info("Bypasses path already exists");
                }
                
                taskLog.info("Getting bypasses parent node");
                Node parent = session.getNode(bypassesPath);
                taskLog.info("Parent node obtained: {}", parent.getPath());
                
                String bypassName = "contentTransfer";
                taskLog.info("Creating bypass node: {}", bypassName);
                Node bypass = parent.addNode(bypassName, "mgnl:contentNode");
                taskLog.info("Bypass node created: {}", bypass.getPath());
                
                String voterClass = "info.magnolia.voting.voters.URIStartsWithVoter";
                taskLog.info("Setting voter class property: {}", voterClass);
                bypass.setProperty("class", voterClass);
                
                // Pattern should match the path after context path
                // URIStartsWithVoter matches against the request URI path (without context)
                // So /author/content-transfer/health becomes /content-transfer/health
                String pattern = "/content-transfer";
                taskLog.info("Setting pattern property: {}", pattern);
                bypass.setProperty("pattern", pattern);
                
                // Set enabled to true (required for bypass to be active)
                bypass.setProperty("enabled", true);
                taskLog.info("Enabled property set to true");

                taskLog.info("Saving session");
                session.save();
                taskLog.info("Session saved successfully");
                
                taskLog.info("URI security bypass successfully registered at {}", bypassPath);
                log.info("URI security bypass successfully registered at {}", bypassPath);
            } catch (javax.jcr.RepositoryException e) {
                taskLog.error("Failed to register URI security bypass", e);
                log.error("Failed to register URI security bypass", e);
                throw new RuntimeException("Failed to register URI security bypass", e);
            } catch (Exception e) {
                taskLog.error("Unexpected error in CreateUriSecurityBypass.execute()", e);
                log.error("Unexpected error in CreateUriSecurityBypass.execute()", e);
                throw new RuntimeException("Unexpected error registering URI security bypass", e);
            }
        }
        
        /**
         * Create the URI security bypass directly using a JCR session.
         * This can be called from both the bootstrap task and module startup.
         */
        public static void createBypassDirectly(Session session) {
            taskLog.info("createBypassDirectly() called");
            
            try {
                String bypassPath = "/server/filters/uriSecurity/bypasses/contentTransfer";
                taskLog.info("Checking if bypass node already exists: {}", bypassPath);
                
                // Check if bypass node already exists
                if (session.nodeExists(bypassPath)) {
                    taskLog.info("Bypass node already exists at {}, skipping creation", bypassPath);
                    log.info("URI security bypass already registered at {}", bypassPath);
                    return;
                }
                
                taskLog.info("Bypass node does not exist, creating it");
                
                // Ensure parent nodes exist
                String bypassesPath = "/server/filters/uriSecurity/bypasses";
                if (!session.nodeExists(bypassesPath)) {
                    taskLog.info("Bypasses path does not exist, creating parent nodes");
                    
                    // Ensure /server/filters exists
                    String filtersPath = "/server/filters";
                    if (!session.nodeExists(filtersPath)) {
                        Node serverNode = session.getNode("/server");
                        serverNode.addNode("filters", "mgnl:contentNode");
                        taskLog.info("Filters node created");
                    }
                    
                    // Ensure /server/filters/uriSecurity exists
                    String uriSecurityPath = "/server/filters/uriSecurity";
                    if (!session.nodeExists(uriSecurityPath)) {
                        Node filtersNode = session.getNode(filtersPath);
                        filtersNode.addNode("uriSecurity", "mgnl:contentNode");
                        taskLog.info("UriSecurity node created");
                    }
                    
                    // Ensure /server/filters/uriSecurity/bypasses exists
                    Node uriSecurityNode = session.getNode(uriSecurityPath);
                    if (!uriSecurityNode.hasNode("bypasses")) {
                        uriSecurityNode.addNode("bypasses", "mgnl:contentNode");
                        taskLog.info("Bypasses node created");
                    }
                    
                    session.save();
                } else {
                    taskLog.info("Bypasses path already exists");
                }
                
                taskLog.info("Getting bypasses parent node");
                Node parent = session.getNode(bypassesPath);
                taskLog.info("Parent node obtained: {}", parent.getPath());
                
                String bypassName = "contentTransfer";
                taskLog.info("Creating bypass node: {}", bypassName);
                Node bypass = parent.addNode(bypassName, "mgnl:contentNode");
                taskLog.info("Bypass node created: {}", bypass.getPath());
                
                String voterClass = "info.magnolia.voting.voters.URIStartsWithVoter";
                taskLog.info("Setting voter class property: {}", voterClass);
                bypass.setProperty("class", voterClass);
                
                // Pattern should match the path after context path
                // URIStartsWithVoter matches against the request URI path (without context)
                // So /author/content-transfer/health becomes /content-transfer/health
                String pattern = "/content-transfer";
                taskLog.info("Setting pattern property: {}", pattern);
                bypass.setProperty("pattern", pattern);
                
                // Set enabled to true (required for bypass to be active)
                bypass.setProperty("enabled", true);
                taskLog.info("Enabled property set to true");
                
                taskLog.info("Saving session");
                session.save();
                taskLog.info("Session saved successfully");
                
                taskLog.info("URI security bypass successfully registered at {}", bypassPath);
                log.info("URI security bypass successfully registered at {}", bypassPath);
            } catch (javax.jcr.RepositoryException e) {
                taskLog.error("Failed to register URI security bypass", e);
                log.error("Failed to register URI security bypass", e);
                throw new RuntimeException("Failed to register URI security bypass", e);
            } catch (Exception e) {
                taskLog.error("Unexpected error in createBypassDirectly()", e);
                log.error("Unexpected error in createBypassDirectly()", e);
                throw new RuntimeException("Unexpected error registering URI security bypass", e);
            }
        }
    }
    
}

