package info.magnolia.contenttransfer.output;

import com.microsoft.graph.authentication.IAuthenticationProvider;
import com.microsoft.graph.authentication.TokenCredentialAuthProvider;
import com.microsoft.graph.models.DriveItem;
import com.microsoft.graph.models.DriveItemCreateUploadSessionParameterSet;
import com.microsoft.graph.models.UploadSession;
import com.microsoft.graph.requests.GraphServiceClient;
import com.microsoft.graph.requests.DriveItemRequestBuilder;
import com.microsoft.graph.requests.DriveItemContentStreamRequestBuilder;
import com.azure.identity.ClientSecretCredential;
import com.azure.identity.ClientSecretCredentialBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Microsoft OneDrive output destination implementation.
 */
public class OneDriveOutputDestination implements OutputDestination {
    
    private static final Logger log = LoggerFactory.getLogger(OneDriveOutputDestination.class);
    
    private GraphServiceClient<?> graphClient;
    private String basePath;
    private String driveId;
    
    @Override
    public void initialize(String destinationPath, Map<String, Object> settings) throws Exception {
        this.basePath = destinationPath;
        
        // Get Microsoft Graph credentials from settings
        String tenantId = getSettingAsString(settings, "tenantId");
        String clientId = getSettingAsString(settings, "clientId");
        String clientSecret = getSettingAsString(settings, "clientSecret");
        String driveIdSetting = getSettingAsString(settings, "driveId");
        
        if (tenantId == null || clientId == null || clientSecret == null) {
            throw new IllegalArgumentException("OneDrive requires tenantId, clientId, and clientSecret in settings");
        }
        
        // Create Azure credential
        ClientSecretCredential credential = new ClientSecretCredentialBuilder()
            .tenantId(tenantId)
            .clientId(clientId)
            .clientSecret(clientSecret)
            .build();
        
        // Create authentication provider
        List<String> scopes = new ArrayList<>();
        scopes.add("https://graph.microsoft.com/.default");
        IAuthenticationProvider authProvider = new TokenCredentialAuthProvider(scopes, credential);
        
        // Create Graph client
        this.graphClient = GraphServiceClient.builder()
            .authenticationProvider(authProvider)
            .buildClient();
        
        // Get drive ID (default to "me" for user's default drive)
        this.driveId = driveIdSetting != null ? driveIdSetting : "me";
        
        log.info("Initialized OneDrive output destination: driveId={}, basePath={}", driveId, basePath);
    }
    
    @Override
    public void write(String relativePath, byte[] data) throws Exception {
        String fullPath = buildPath(relativePath);
        DriveItemRequestBuilder itemBuilder = getDriveItemBuilder(fullPath);
        
        // Use upload session for large files, direct upload for small files
        if (data.length > 4 * 1024 * 1024) { // 4MB threshold
            uploadLargeFile(itemBuilder, data);
        } else {
            itemBuilder.content().buildRequest().put(data);
        }
        
        log.debug("Wrote file to OneDrive: {}", fullPath);
    }
    
    @Override
    public OutputStream getOutputStream(String relativePath) throws Exception {
        // OneDrive doesn't support OutputStream directly
        // For now, throw UnsupportedOperationException - callers should use write() instead
        throw new UnsupportedOperationException("OneDrive does not support OutputStream directly. Use write() method instead.");
    }
    
    @Override
    public InputStream getInputStream(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        DriveItemRequestBuilder itemBuilder = getDriveItemBuilder(fullPath);
        DriveItemContentStreamRequestBuilder contentBuilder = itemBuilder.content();
        return contentBuilder.buildRequest().get();
    }
    
    @Override
    public boolean exists(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        try {
            DriveItemRequestBuilder itemBuilder = getDriveItemBuilder(fullPath);
            itemBuilder.buildRequest().get();
            return true;
        } catch (Exception e) {
            // File doesn't exist or other error
            return false;
        }
    }
    
    @Override
    public List<String> listFiles(String prefix) throws Exception {
        String searchPath = buildPath(prefix != null ? prefix : "");
        List<String> files = new ArrayList<>();
        
        try {
            DriveItemRequestBuilder itemBuilder = getDriveItemBuilder(searchPath);
            DriveItem item = itemBuilder.buildRequest().get();
            
            if (item.children != null) {
                for (DriveItem child : item.children.getCurrentPage()) {
                    if (child.file != null) { // It's a file, not a folder
                        String relativePath = prefix != null ? prefix + "/" + child.name : child.name;
                        files.add(relativePath);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Error listing files: {}", e.getMessage());
        }
        
        return files;
    }
    
    @Override
    public void delete(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        DriveItemRequestBuilder itemBuilder = getDriveItemBuilder(fullPath);
        itemBuilder.buildRequest().delete();
        log.debug("Deleted file from OneDrive: {}", fullPath);
    }
    
    private String buildPath(String relativePath) {
        if (basePath.isEmpty()) {
            return relativePath;
        }
        return basePath + "/" + relativePath;
    }
    
    private DriveItemRequestBuilder getDriveItemBuilder(String path) {
        if ("me".equals(driveId)) {
            return graphClient.me().drive().root().itemWithPath(path);
        } else {
            return graphClient.drives(driveId).root().itemWithPath(path);
        }
    }
    
    private void uploadLargeFile(DriveItemRequestBuilder itemBuilder, byte[] data) throws Exception {
        // Create upload session
        DriveItemCreateUploadSessionParameterSet params = new DriveItemCreateUploadSessionParameterSet();
        UploadSession session = itemBuilder.createUploadSession(params).buildRequest().post();
        
        // Upload file in chunks (simplified - for production, should handle chunking properly)
        String uploadUrl = session.uploadUrl;
        // For now, use simple PUT request - in production, should use proper chunked upload
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(uploadUrl).openConnection();
        conn.setRequestMethod("PUT");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Length", String.valueOf(data.length));
        
        try (java.io.OutputStream os = conn.getOutputStream()) {
            os.write(data);
        }
        
        int responseCode = conn.getResponseCode();
        if (responseCode < 200 || responseCode >= 300) {
            throw new Exception("Upload failed with response code: " + responseCode);
        }
    }
    
    private String getSettingAsString(Map<String, Object> settings, String key) {
        Object value = settings.get(key);
        return value != null ? value.toString() : null;
    }
}

