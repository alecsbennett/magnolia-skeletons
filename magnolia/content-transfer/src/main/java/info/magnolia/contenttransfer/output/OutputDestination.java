package info.magnolia.contenttransfer.output;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * Interface for output destinations (S3, SFTP, FileSystem, OneDrive).
 * Handles authentication, write operations (export), and read operations (import).
 */
public interface OutputDestination {
    
    /**
     * Initialize the destination with configuration settings.
     * 
     * @param destinationPath Base path/directory for files
     * @param settings Configuration settings (authentication, etc.)
     * @throws Exception If initialization fails
     */
    void initialize(String destinationPath, java.util.Map<String, Object> settings) throws Exception;
    
    /**
     * Write data to the destination.
     * 
     * @param relativePath Relative path from destination root
     * @param data Data to write
     * @throws Exception If write fails
     */
    void write(String relativePath, byte[] data) throws Exception;
    
    /**
     * Write data to the destination using an output stream.
     * 
     * @param relativePath Relative path from destination root
     * @return OutputStream to write to
     * @throws Exception If stream creation fails
     */
    OutputStream getOutputStream(String relativePath) throws Exception;
    
    /**
     * Read data from the destination.
     * 
     * @param relativePath Relative path from destination root
     * @return InputStream to read from
     * @throws Exception If read fails
     */
    InputStream getInputStream(String relativePath) throws Exception;
    
    /**
     * Check if a file exists at the given path.
     * 
     * @param relativePath Relative path from destination root
     * @return true if file exists
     * @throws Exception If check fails
     */
    boolean exists(String relativePath) throws Exception;
    
    /**
     * List all files in the destination (optionally filtered by prefix).
     * 
     * @param prefix Optional prefix to filter files (null for all files)
     * @return List of relative paths
     * @throws Exception If listing fails
     */
    List<String> listFiles(String prefix) throws Exception;
    
    /**
     * Delete a file from the destination.
     * 
     * @param relativePath Relative path from destination root
     * @throws Exception If deletion fails
     */
    void delete(String relativePath) throws Exception;
}

