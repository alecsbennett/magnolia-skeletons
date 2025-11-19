package info.magnolia.contenttransfer.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import info.magnolia.contenttransfer.config.ContentTransferConfigurationService;
import info.magnolia.contenttransfer.export.ExportService;
import info.magnolia.contenttransfer.importer.ImportService;
import info.magnolia.contenttransfer.xml.XmlSerializationService;
import info.magnolia.repository.RepositoryManager;
import info.magnolia.cms.filters.AbstractMgnlFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.HashMap;
import java.util.Map;

/**
 * Magnolia filter that exposes the content-transfer API on /content-transfer/*.
 *
 * Endpoints:
 *   GET  /content-transfer/health                 - health (no auth)
 *   GET  /content-transfer/status                 - status (auth)
 *   POST /content-transfer/configure              - configure (auth, JSON body)
 *   POST /content-transfer/export                 - trigger export (auth)
 *   POST /content-transfer/import                 - trigger import (auth)
 *
 * Authentication:
 *   - Header:  X-Private-Key: team$ite
 *   - or query parameter: ?key=team$ite
 *
 * The filter intercepts only /content-transfer/* requests and passes all others
 * down the Magnolia filter chain.
 */
public class ContentTransferFilter extends AbstractMgnlFilter {

    private static final Logger log = LoggerFactory.getLogger(ContentTransferFilter.class);
    private static final String PRIVATE_KEY = "team$ite";

    private volatile boolean initialized = false;
    private ContentTransferConfigurationService configService;
    private ExportService exportService;
    private ImportService importService;
    private ObjectMapper objectMapper;

    @Override
    public void init(FilterConfig filterConfig) {
        log.info("ContentTransferFilter init");
        this.objectMapper = new ObjectMapper();
    }

    private synchronized void ensureInitialized() {
        if (initialized) {
            return;
        }
        try {
            log.info("Initializing ContentTransferFilter services");

            this.configService = new ContentTransferConfigurationService();
            XmlSerializationService xmlService = new XmlSerializationService(configService);

            RepositoryManager repositoryManager =
                    info.magnolia.objectfactory.Components.getComponent(RepositoryManager.class);
            if (repositoryManager == null) {
                throw new IllegalStateException("RepositoryManager is null, cannot initialize ContentTransferFilter");
            }

            this.exportService = new ExportService(configService, xmlService, repositoryManager);
            this.importService = new ImportService(configService, xmlService, repositoryManager);

            initialized = true;
            log.info("ContentTransferFilter services initialized");
        } catch (Exception e) {
            log.error("Failed to initialize ContentTransferFilter services", e);
            throw new IllegalStateException("Failed to initialize ContentTransferFilter services", e);
        }
    }

    @Override
    public void doFilter(HttpServletRequest httpReq, HttpServletResponse httpResp, FilterChain chain)
            throws IOException, ServletException {

        String contextPath = httpReq.getContextPath() != null ? httpReq.getContextPath() : "";
        String uri = httpReq.getRequestURI();
        String path = uri.substring(contextPath.length());

        // Only handle /content-transfer/*, let Magnolia handle everything else
        if (!path.startsWith("/content-transfer")) {
            chain.doFilter(httpReq, httpResp);
            return;
        }

        // Normalize sub-path
        String subPath = path.substring("/content-transfer".length());
        if (subPath.isEmpty()) {
            subPath = "/";
        }

        // Initialize services lazily
        ensureInitialized();

        String method = httpReq.getMethod();

        try {
            if ("GET".equalsIgnoreCase(method)) {
                handleGet(httpReq, httpResp, subPath);
            } else if ("POST".equalsIgnoreCase(method)) {
                handlePost(httpReq, httpResp, subPath);
            } else {
                sendErrorResponse(httpResp, HttpServletResponse.SC_METHOD_NOT_ALLOWED,
                        "Method not allowed: " + method);
            }
        } catch (Exception e) {
            log.error("Error handling content-transfer request", e);
            sendErrorResponse(httpResp, HttpServletResponse.SC_INTERNAL_SERVER_ERROR,
                    "Internal server error: " + e.getMessage());
        }
    }

    private void handleGet(HttpServletRequest request, HttpServletResponse response, String subPath)
            throws IOException {

        // Health endpoint does not require auth
        if ("/health".equals(subPath)) {
            handleHealth(response);
            return;
        }

        // Other GET endpoints require authentication
        if (!isAuthenticated(request)) {
            sendErrorResponse(response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized: Invalid private key");
            return;
        }

        if ("/status".equals(subPath) || "/".equals(subPath)) {
            handleStatus(response);
        } else {
            sendErrorResponse(response, HttpServletResponse.SC_NOT_FOUND, "Endpoint not found");
        }
    }

    private void handlePost(HttpServletRequest request, HttpServletResponse response, String subPath)
            throws IOException {

        // POST endpoints require authentication (health is GET-only)
        if (!isAuthenticated(request)) {
            sendErrorResponse(response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized: Invalid private key");
            return;
        }

        if ("/configure".equals(subPath)) {
            handleConfigure(request, response);
        } else if ("/export".equals(subPath)) {
            handleExport(response);
        } else if ("/import".equals(subPath)) {
            handleImport(response);
        } else {
            sendErrorResponse(response, HttpServletResponse.SC_NOT_FOUND, "Endpoint not found");
        }
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

        String body = readRequestBody(request);
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> configJson = objectMapper.readValue(body, Map.class);

            configService.initialize(configJson);

            Map<String, Object> result = createResponse("message", "Configuration updated successfully");
            sendSuccessResponse(response, result);
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
        health.put("filter", "ContentTransferFilter");
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

    private String readRequestBody(HttpServletRequest request) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = request.getReader()) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
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
        log.info("Destroying ContentTransferFilter");
    }
}


