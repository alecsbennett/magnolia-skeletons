package info.magnolia.contenttransfer;

import info.magnolia.contenttransfer.setup.ContentTransferModuleVersionHandler.CreateServletConfig;
import info.magnolia.contenttransfer.setup.ContentTransferModuleVersionHandler.CreateUriSecurityBypass;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.Session;

/**
 * Main module class for Content Transfer.
 * This class is instantiated by Magnolia's module framework.
 */
public class ContentTransferModule {
    
    private static final Logger log = LoggerFactory.getLogger(ContentTransferModule.class);
    
    public ContentTransferModule() {
        log.info("ContentTransferModule instantiated");
        // Register servlet and URI security bypass on module startup
        registerServletAndBypass();
    }
    
    /**
     * Register the ContentTransferServlet and URI security bypass in Magnolia's configuration.
     * This runs on every module startup to ensure both are registered.
     */
    private void registerServletAndBypass() {
        log.info("Registering ContentTransferServlet and URI security bypass on module startup");
        try {
            // Use a thread to delay execution until Magnolia is fully initialized
            Thread registrationThread = new Thread(() -> {
                try {
                    // Wait a bit for Magnolia to initialize repositories
                    Thread.sleep(5000);
                    log.info("Attempting to register ContentTransferServlet and URI security bypass");
                    
                    // Use system context to get JCR session (required for background threads)
                    info.magnolia.context.MgnlContext.doInSystemContext(() -> {
                        Session session = null;
                        try {
                            // Get the config session using MgnlContext in system context
                            session = info.magnolia.context.MgnlContext.getJCRSession("config");
                            log.info("Got config session: {}", session != null);
                            
                            // Register servlet if not exists, or update if configuration is incorrect
                            String servletPath = "/server/filters/servlets/contentTransfer";
                            log.info("Checking if servlet node exists: {}", servletPath);
                            
                            if (!session.nodeExists(servletPath)) {
                                log.info("Servlet node does not exist, creating it");
                                CreateServletConfig.registerServletDirectly(session);
                                log.info("ContentTransferServlet registration completed");
                            } else {
                                log.info("Servlet node already exists at {}, checking/updating configuration", servletPath);
                                // Check if the configuration is correct and update if needed
                                try {
                                    javax.jcr.Node servletNode = session.getNode(servletPath);
                                    String currentClass = servletNode.hasProperty("class") ? servletNode.getProperty("class").getString() : null;
                                    String correctClass = "info.magnolia.cms.filters.ServletDispatchingFilter";
                                    boolean needsUpdate = false;
                                    
                                    if (!correctClass.equals(currentClass)) {
                                        log.info("Updating servlet filter class from '{}' to '{}'", currentClass, correctClass);
                                        servletNode.setProperty("class", correctClass);
                                        needsUpdate = true;
                                    }
                                    
                                    // Ensure servletClass property exists
                                    if (!servletNode.hasProperty("servletClass")) {
                                        log.info("Adding missing servletClass property");
                                        servletNode.setProperty("servletClass", "info.magnolia.contenttransfer.servlet.ContentTransferServlet");
                                        needsUpdate = true;
                                    }
                                    
                                    // Ensure servletName property exists
                                    if (!servletNode.hasProperty("servletName")) {
                                        log.info("Adding missing servletName property");
                                        servletNode.setProperty("servletName", "contentTransfer");
                                        needsUpdate = true;
                                    }
                                    
                                    // Ensure enabled property exists
                                    if (!servletNode.hasProperty("enabled")) {
                                        log.info("Adding missing enabled property");
                                        servletNode.setProperty("enabled", true);
                                        needsUpdate = true;
                                    }
                                    
                                    // Ensure parameters node exists (required by ServletDispatchingFilter)
                                    if (!servletNode.hasNode("parameters")) {
                                        log.info("Adding missing parameters node");
                                        servletNode.addNode("parameters", "mgnl:contentNode");
                                        needsUpdate = true;
                                    }
                                    
                                    if (needsUpdate) {
                                        session.save();
                                        log.info("Servlet configuration updated successfully");
                                    } else {
                                        log.info("Servlet configuration already correct");
                                    }
                                } catch (Exception e) {
                                    log.error("Error updating servlet configuration, will recreate", e);
                                    // Delete and recreate if update fails
                                    try {
                                        javax.jcr.Node servletNode = session.getNode(servletPath);
                                        servletNode.remove();
                                        session.save();
                                        log.info("Deleted old servlet node, recreating with correct configuration");
                                        CreateServletConfig.registerServletDirectly(session);
                                        log.info("ContentTransferServlet recreated successfully");
                                    } catch (Exception e2) {
                                        log.error("Error recreating servlet node", e2);
                                    }
                                }
                            }
                            
                            // Register URI security bypass if not exists, or update pattern if it exists
                            String bypassPath = "/server/filters/uriSecurity/bypasses/contentTransfer";
                            log.info("Checking if URI security bypass node exists: {}", bypassPath);
                            
                            if (!session.nodeExists(bypassPath)) {
                                log.info("URI security bypass node does not exist, creating it");
                                CreateUriSecurityBypass.createBypassDirectly(session);
                                log.info("URI security bypass registration completed");
                            } else {
                                log.info("URI security bypass node already exists at {}, checking/updating pattern", bypassPath);
                                // Update the pattern if needed
                                try {
                                    javax.jcr.Node bypass = session.getNode(bypassPath);
                                    String currentPattern = bypass.hasProperty("pattern") ? bypass.getProperty("pattern").getString() : null;
                                    String correctPattern = "/content-transfer";
                                    boolean needsUpdate = false;
                                    if (!correctPattern.equals(currentPattern)) {
                                        log.info("Updating bypass pattern from '{}' to '{}'", currentPattern, correctPattern);
                                        bypass.setProperty("pattern", correctPattern);
                                        needsUpdate = true;
                                    }
                                    // Ensure enabled property is set
                                    if (!bypass.hasProperty("enabled") || !bypass.getProperty("enabled").getBoolean()) {
                                        log.info("Setting enabled property to true for bypass");
                                        bypass.setProperty("enabled", true);
                                        needsUpdate = true;
                                    }
                                    if (needsUpdate) {
                                        session.save();
                                        log.info("Bypass configuration updated successfully");
                                    } else {
                                        log.info("Bypass pattern already correct: {}", correctPattern);
                                    }
                                } catch (Exception e) {
                                    log.error("Error updating bypass pattern", e);
                                }
                            }
                        } catch (Exception e) {
                            log.error("Error registering ContentTransferServlet or URI security bypass in system context", e);
                        } finally {
                            // Ensure session is logged out in background thread
                            if (session != null && session.isLive()) {
                                try {
                                    session.logout();
                                    log.debug("JCR session logged out");
                                } catch (Exception e) {
                                    log.warn("Error logging out JCR session", e);
                                }
                            }
                        }
                        return null;
                    });
                } catch (Exception e) {
                    log.error("Error registering ContentTransferServlet or URI security bypass on startup", e);
                }
            }, "ContentTransfer-Registration");
            registrationThread.setDaemon(true);
            registrationThread.start();
            log.info("Started registration thread");
        } catch (Exception e) {
            log.error("Error starting registration thread", e);
        }
    }
}

