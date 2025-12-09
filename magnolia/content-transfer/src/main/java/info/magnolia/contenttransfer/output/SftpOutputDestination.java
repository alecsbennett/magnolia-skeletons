package info.magnolia.contenttransfer.output;

import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Vector;

/**
 * SFTP output destination implementation.
 */
public class SftpOutputDestination implements OutputDestination {
    
    private static final Logger log = LoggerFactory.getLogger(SftpOutputDestination.class);
    
    private Session session;
    private ChannelSftp channel;
    private String basePath;
    
    @Override
    public void initialize(String destinationPath, Map<String, Object> settings) throws Exception {
        this.basePath = destinationPath;
        
        // Get SFTP connection settings
        String host = getSettingAsString(settings, "host");
        int port = getSettingAsInt(settings, "port", 22);
        String username = getSettingAsString(settings, "username");
        String password = getSettingAsString(settings, "password");
        String privateKey = getSettingAsString(settings, "privateKey");
        String passphrase = getSettingAsString(settings, "passphrase");
        
        if (host == null || username == null) {
            throw new IllegalArgumentException("SFTP requires host and username in settings");
        }
        
        if (password == null && privateKey == null) {
            throw new IllegalArgumentException("SFTP requires either password or privateKey in settings");
        }
        
        JSch jsch = new JSch();
        
        // Set up session
        session = jsch.getSession(username, host, port);
        if (password != null) {
            session.setPassword(password);
        }
        
        if (privateKey != null) {
            jsch.addIdentity("sftp-key", privateKey.getBytes(), null, passphrase != null ? passphrase.getBytes() : null);
        }
        
        // Disable host key checking (for development - should be configured properly in production)
        java.util.Properties config = new java.util.Properties();
        config.put("StrictHostKeyChecking", "no");
        session.setConfig(config);
        
        session.connect();
        
        // Open SFTP channel
        channel = (ChannelSftp) session.openChannel("sftp");
        channel.connect();
        
        // Create base directory if it doesn't exist
        try {
            channel.mkdir(basePath);
        } catch (SftpException e) {
            // Directory might already exist, ignore
            if (e.id != ChannelSftp.SSH_FX_FAILURE) {
                log.debug("Could not create base directory (may already exist): {}", basePath);
            }
        }
        
        log.info("Initialized SFTP output destination: {}@{}:{}/{}", username, host, port, basePath);
    }
    
    @Override
    public void write(String relativePath, byte[] data) throws Exception {
        String fullPath = buildPath(relativePath);
        ensureDirectoryExists(fullPath);
        channel.put(new java.io.ByteArrayInputStream(data), fullPath);
        log.debug("Wrote file to SFTP: {}", fullPath);
    }
    
    @Override
    public OutputStream getOutputStream(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        ensureDirectoryExists(fullPath);
        return channel.put(fullPath);
    }
    
    @Override
    public InputStream getInputStream(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        return channel.get(fullPath);
    }
    
    @Override
    public boolean exists(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        try {
            channel.stat(fullPath);
            return true;
        } catch (SftpException e) {
            if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                return false;
            }
            throw e;
        }
    }
    
    @Override
    @SuppressWarnings("unchecked")
    public List<String> listFiles(String prefix) throws Exception {
        String searchPath = buildPath(prefix != null ? prefix : "");
        List<String> files = new ArrayList<>();
        
        try {
            Vector<ChannelSftp.LsEntry> entries = channel.ls(searchPath);
            for (ChannelSftp.LsEntry entry : entries) {
                if (!entry.getAttrs().isDir()) {
                    String filename = entry.getFilename();
                    String relativePath = prefix != null ? prefix + "/" + filename : filename;
                    files.add(relativePath);
                }
            }
        } catch (SftpException e) {
            if (e.id != ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                throw e;
            }
        }
        
        return files;
    }
    
    @Override
    public void delete(String relativePath) throws Exception {
        String fullPath = buildPath(relativePath);
        channel.rm(fullPath);
        log.debug("Deleted file from SFTP: {}", fullPath);
    }
    
    private String buildPath(String relativePath) {
        if (basePath.isEmpty()) {
            return relativePath;
        }
        return basePath + "/" + relativePath;
    }
    
    private void ensureDirectoryExists(String filePath) throws SftpException {
        String dir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (dir.isEmpty()) {
            dir = "/";
        }
        
        String[] dirs = dir.split("/");
        String currentPath = "";
        for (String dirPart : dirs) {
            if (dirPart.isEmpty()) {
                continue;
            }
            currentPath += "/" + dirPart;
            try {
                channel.mkdir(currentPath);
            } catch (SftpException e) {
                // Directory might already exist, ignore
                if (e.id != ChannelSftp.SSH_FX_FAILURE) {
                    // Re-throw if it's a different error
                    throw e;
                }
            }
        }
    }
    
    private String getSettingAsString(Map<String, Object> settings, String key) {
        Object value = settings.get(key);
        return value != null ? value.toString() : null;
    }
    
    private int getSettingAsInt(Map<String, Object> settings, String key, int defaultValue) {
        Object value = settings.get(key);
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(value.toString());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
    
    /**
     * Close the SFTP connection.
     */
    public void close() {
        if (channel != null) {
            channel.disconnect();
        }
        if (session != null) {
            session.disconnect();
        }
    }
}

