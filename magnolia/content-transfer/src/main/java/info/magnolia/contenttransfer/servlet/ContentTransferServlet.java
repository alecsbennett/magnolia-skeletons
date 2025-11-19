package info.magnolia.contenttransfer.servlet;

import com.fasterxml.jackson.databind.ObjectMapper;
import info.magnolia.contenttransfer.config.ContentTransferConfigurationService;
import info.magnolia.contenttransfer.export.ExportService;
import info.magnolia.contenttransfer.importer.ImportService;
import info.magnolia.contenttransfer.xml.XmlSerializationService;
import info.magnolia.repository.RepositoryManager;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Magnolia servlet that exposes the content-transfer API on /content-transfer/*.
 *
 * Endpoints:
 *   GET  /content-transfer/health                 - health (no auth)
 *   GET  /content-transfer/status                 - status (auth)
 *   GET  /content-transfer/configure?config=<base64> - configure (auth, config as base64 query param)
 *   GET  /content-transfer/export                 - trigger export (auth)
 *   GET  /content-transfer/import                 - trigger import (auth)
 *
 * Authentication:
 *   - Header:  X-Private-Key: team$ite
 *   - or query parameter: ?key=team$ite
 */
public class ContentTransferServlet extends HttpServlet {

    private static final Logger log = LoggerFactory.getLogger(ContentTransferServlet.class);
    private static final String PRIVATE_KEY = "team$ite";

    private volatile boolean initialized = false;
    private ContentTransferConfigurationService configService;
    private ExportService exportService;
    private ImportService importService;
    private ObjectMapper objectMapper;

    @Override
    public void init() throws ServletException {
        super.init();
        log.info("ContentTransferServlet init");
        this.objectMapper = new ObjectMapper();
    }

    private synchronized void ensureInitialized() {
        // Ensure objectMapper is initialized (may not be set if init() wasn't called properly)
        if (this.objectMapper == null) {
            log.info("Initializing ObjectMapper");
            this.objectMapper = new ObjectMapper();
        }
        
        if (initialized) {
            return;
        }
        try {
            log.info("Initializing ContentTransferServlet services");

            this.configService = new ContentTransferConfigurationService();
            XmlSerializationService xmlService = new XmlSerializationService(configService);

            RepositoryManager repositoryManager =
                    info.magnolia.objectfactory.Components.getComponent(RepositoryManager.class);
            if (repositoryManager == null) {
                throw new IllegalStateException("RepositoryManager is null, cannot initialize ContentTransferServlet");
            }

            this.exportService = new ExportService(configService, xmlService, repositoryManager);
            this.importService = new ImportService(configService, xmlService, repositoryManager);

            initialized = true;
            log.info("ContentTransferServlet services initialized");
        } catch (Exception e) {
            log.error("Failed to initialize ContentTransferServlet services", e);
            throw new IllegalStateException("Failed to initialize ContentTransferServlet services", e);
        }
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        log.info("ContentTransferServlet.doGet() called - URI: {}, pathInfo: {}, contextPath: {}", 
                request.getRequestURI(), request.getPathInfo(), request.getContextPath());
        String subPath = getSubPath(request);
        log.info("GET request to subPath: {}", subPath);

        // Health endpoint does not require auth
        if ("/health".equals(subPath)) {
            ensureInitialized();
            handleHealth(response);
            return;
        }

        // Other GET endpoints require authentication
        if (!isAuthenticated(request)) {
            sendErrorResponse(response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized: Invalid private key");
            return;
        }

        ensureInitialized();
        if ("/status".equals(subPath) || "/".equals(subPath)) {
            handleStatus(response);
        } else if ("/configure".equals(subPath)) {
            handleConfigure(request, response);
        } else if ("/export".equals(subPath)) {
            handleExport(response);
        } else if ("/import".equals(subPath)) {
            handleImport(response);
        } else {
            sendErrorResponse(response, HttpServletResponse.SC_NOT_FOUND, "Endpoint not found");
        }
    }

    /**
     * Extract the sub-path from the request URI.
     * Handles both pathInfo and direct URI parsing for Magnolia servlet registration.
     */
    private String getSubPath(HttpServletRequest request) {
        // Try pathInfo first (standard servlet mapping)
        String pathInfo = request.getPathInfo();
        log.debug("getSubPath - pathInfo: {}", pathInfo);
        if (pathInfo != null && !pathInfo.isEmpty()) {
            log.debug("Using pathInfo: {}", pathInfo);
            return pathInfo;
        }

        // Fall back to parsing the URI (for Magnolia JCR-registered servlets)
        String contextPath = request.getContextPath() != null ? request.getContextPath() : "";
        String uri = request.getRequestURI();
        String path = uri.substring(contextPath.length());
        log.debug("getSubPath - contextPath: {}, uri: {}, path: {}", contextPath, uri, path);
        
        if (path.startsWith("/content-transfer")) {
            String subPath = path.substring("/content-transfer".length());
            log.debug("Extracted subPath from URI: {}", subPath);
            return subPath.isEmpty() ? "/" : subPath;
        }
        
        log.debug("Path doesn't start with /content-transfer, returning '/'");
        return "/";
    }

    private boolean isAuthenticated(HttpServletRequest request) {
        String keyFromHeader = request.getHeader("X-Private-Key");
        if (PRIVATE_KEY.equals(keyFromHeader)) {
            return true;
        }

        String keyFromParam = request.getParameter("key");
        return PRIVATE_KEY.equals(keyFromParam);
    }

    private void handleConfigure(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        // Read config from query parameter (base64 encoded JSON)
        String configParam = request.getParameter("config");
        if (configParam == null || configParam.isEmpty()) {
            sendErrorResponse(response, HttpServletResponse.SC_BAD_REQUEST,
                    "Missing 'config' query parameter (base64 encoded JSON)");
            return;
        }

        try {
            // Decode base64
            byte[] decodedBytes = Base64.getDecoder().decode(configParam);
            String configJson = new String(decodedBytes, StandardCharsets.UTF_8);
            
            @SuppressWarnings("unchecked")
            Map<String, Object> configMap = objectMapper.readValue(configJson, Map.class);

            configService.initialize(configMap);

            Map<String, Object> result = createResponse("message", "Configuration updated successfully");
            sendSuccessResponse(response, result);
        } catch (IllegalArgumentException e) {
            log.error("Error decoding base64 configuration", e);
            sendErrorResponse(response, HttpServletResponse.SC_BAD_REQUEST,
                    "Invalid base64 encoding in config parameter: " + e.getMessage());
        } catch (Exception e) {
            log.error("Error parsing configuration JSON", e);
            sendErrorResponse(response, HttpServletResponse.SC_BAD_REQUEST,
                    "Invalid configuration JSON: " + e.getMessage());
        }
    }

    private void handleExport(HttpServletResponse response) throws IOException {
        try {
            exportService.export();
            Map<String, Object> result = createResponse("message", "Export completed successfully");
            sendSuccessResponse(response, result);
        } catch (Exception e) {
            log.error("Error during export", e);
            sendErrorResponse(response, HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                    "Export failed: " + e.getMessage());
        }
    }

    private void handleImport(HttpServletResponse response) throws IOException {
        try {
            importService.importContent();
            Map<String, Object> result = createResponse("message", "Import completed successfully");
            sendSuccessResponse(response, result);
        } catch (Exception e) {
            log.error("Error during import", e);
            sendErrorResponse(response, HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                    "Import failed: " + e.getMessage());
        }
    }

    private void handleHealth(HttpServletResponse response) throws IOException {
        Map<String, Object> health = new HashMap<>();
        health.put("status", "UP");
        health.put("service", "Content Transfer");
        health.put("servlet", "ContentTransferServlet");
        health.put("configured", configService != null);
        health.put("exportService", exportService != null);
        health.put("importService", importService != null);
        sendSuccessResponse(response, health);
    }

    private void handleStatus(HttpServletResponse response) throws IOException {
        Map<String, Object> status = new HashMap<>();
        status.put("status", "running");
        status.put("service", "Content Transfer");
        status.put("configured", configService != null);
        status.put("exportService", exportService != null);
        status.put("importService", importService != null);
        status.put("hasConfiguration", configService != null);
        sendSuccessResponse(response, status);
    }


    private void sendSuccessResponse(HttpServletResponse response, Map<String, Object> data)
            throws IOException {
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        PrintWriter writer = response.getWriter();
        objectMapper.writeValue(writer, data);
        writer.flush();
    }

    private void sendErrorResponse(HttpServletResponse response, int statusCode, String message)
            throws IOException {
        response.setStatus(statusCode);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        Map<String, Object> error = new HashMap<>();
        error.put("error", true);
        error.put("message", message);

        PrintWriter writer = response.getWriter();
        objectMapper.writeValue(writer, error);
        writer.flush();
    }

    private Map<String, Object> createResponse(String key, Object value) {
        Map<String, Object> response = new HashMap<>();
        response.put(key, value);
        response.put("success", true);
        return response;
    }

    @Override
    public void destroy() {
        log.info("Destroying ContentTransferServlet");
        super.destroy();
    }
}

