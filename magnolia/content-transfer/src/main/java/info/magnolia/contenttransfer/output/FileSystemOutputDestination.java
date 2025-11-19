package info.magnolia.contenttransfer.output;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * FileSystem output destination implementation.
 * Used for local development only.
 */
public class FileSystemOutputDestination implements OutputDestination {
    
    private static final Logger log = LoggerFactory.getLogger(FileSystemOutputDestination.class);
    
    private Path basePath;
    
    @Override
    public void initialize(String destinationPath, Map<String, Object> settings) throws Exception {
        this.basePath = Paths.get(destinationPath);
        Files.createDirectories(basePath);
        log.info("Initialized FileSystem output destination: {}", basePath.toAbsolutePath());
    }
    
    @Override
    public void write(String relativePath, byte[] data) throws Exception {
        Path filePath = basePath.resolve(relativePath);
        Files.createDirectories(filePath.getParent());
        Files.write(filePath, data);
        log.debug("Wrote file: {}", filePath);
    }
    
    @Override
    public OutputStream getOutputStream(String relativePath) throws Exception {
        Path filePath = basePath.resolve(relativePath);
        Files.createDirectories(filePath.getParent());
        return new FileOutputStream(filePath.toFile());
    }
    
    @Override
    public InputStream getInputStream(String relativePath) throws Exception {
        Path filePath = basePath.resolve(relativePath);
        if (!Files.exists(filePath)) {
            throw new java.io.FileNotFoundException("File not found: " + filePath);
        }
        return new FileInputStream(filePath.toFile());
    }
    
    @Override
    public boolean exists(String relativePath) throws Exception {
        Path filePath = basePath.resolve(relativePath);
        return Files.exists(filePath);
    }
    
    @Override
    public List<String> listFiles(String prefix) throws Exception {
        List<String> files = new ArrayList<>();
        Path searchPath = prefix != null ? basePath.resolve(prefix) : basePath;
        
        if (!Files.exists(searchPath)) {
            return files;
        }
        
        Files.walkFileTree(searchPath, new java.nio.file.SimpleFileVisitor<Path>() {
            @Override
            public java.nio.file.FileVisitResult visitFile(Path file, java.nio.file.attribute.BasicFileAttributes attrs) {
                Path relative = basePath.relativize(file);
                files.add(relative.toString().replace('\\', '/'));
                return java.nio.file.FileVisitResult.CONTINUE;
            }
        });
        
        return files;
    }
    
    @Override
    public void delete(String relativePath) throws Exception {
        Path filePath = basePath.resolve(relativePath);
        if (Files.exists(filePath)) {
            Files.delete(filePath);
            log.debug("Deleted file: {}", filePath);
        }
    }
}

