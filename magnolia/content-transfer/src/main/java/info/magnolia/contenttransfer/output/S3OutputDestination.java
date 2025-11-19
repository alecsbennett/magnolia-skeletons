package info.magnolia.contenttransfer.output;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * AWS S3 output destination implementation.
 */
public class S3OutputDestination implements OutputDestination {
    
    private static final Logger log = LoggerFactory.getLogger(S3OutputDestination.class);
    
    private S3Client s3Client;
    private String bucketName;
    private String basePrefix;
    
    @Override
    public void initialize(String destinationPath, Map<String, Object> settings) throws Exception {
        // Parse destination path: bucket-name/prefix or just bucket-name
        String[] parts = destinationPath.split("/", 2);
        this.bucketName = parts[0];
        this.basePrefix = parts.length > 1 ? parts[1] : "";
        
        // Get AWS credentials from settings
        String accessKeyId = getSettingAsString(settings, "accessKeyId");
        String secretAccessKey = getSettingAsString(settings, "secretAccessKey");
        String regionStr = getSettingAsString(settings, "region");
        
        if (accessKeyId == null || secretAccessKey == null) {
            throw new IllegalArgumentException("S3 requires accessKeyId and secretAccessKey in settings");
        }
        
        Region region = regionStr != null ? Region.of(regionStr) : Region.US_EAST_1;
        
        AwsBasicCredentials awsCreds = AwsBasicCredentials.create(accessKeyId, secretAccessKey);
        this.s3Client = S3Client.builder()
            .region(region)
            .credentialsProvider(StaticCredentialsProvider.create(awsCreds))
            .build();
        
        log.info("Initialized S3 output destination: bucket={}, prefix={}", bucketName, basePrefix);
    }
    
    @Override
    public void write(String relativePath, byte[] data) throws Exception {
        String key = buildKey(relativePath);
        s3Client.putObject(PutObjectRequest.builder()
            .bucket(bucketName)
            .key(key)
            .build(), RequestBody.fromBytes(data));
        log.debug("Wrote file to S3: {}", key);
    }
    
    @Override
    public OutputStream getOutputStream(String relativePath) throws Exception {
        // S3 doesn't support streaming uploads easily, so we'll use a buffer
        // For now, throw UnsupportedOperationException - callers should use write() instead
        throw new UnsupportedOperationException("S3 does not support OutputStream directly. Use write() method instead.");
    }
    
    @Override
    public InputStream getInputStream(String relativePath) throws Exception {
        String key = buildKey(relativePath);
        return s3Client.getObject(GetObjectRequest.builder()
            .bucket(bucketName)
            .key(key)
            .build());
    }
    
    @Override
    public boolean exists(String relativePath) throws Exception {
        String key = buildKey(relativePath);
        try {
            s3Client.headObject(HeadObjectRequest.builder()
                .bucket(bucketName)
                .key(key)
                .build());
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        }
    }
    
    @Override
    public List<String> listFiles(String prefix) throws Exception {
        String searchPrefix = buildKey(prefix != null ? prefix : "");
        
        ListObjectsV2Request request = ListObjectsV2Request.builder()
            .bucket(bucketName)
            .prefix(searchPrefix)
            .build();
        
        ListObjectsV2Response response = s3Client.listObjectsV2(request);
        
        return response.contents().stream()
            .map(s3Object -> {
                String key = s3Object.key();
                // Remove base prefix to get relative path
                if (!basePrefix.isEmpty() && key.startsWith(basePrefix)) {
                    return key.substring(basePrefix.length() + 1);
                }
                return key;
            })
            .collect(Collectors.toList());
    }
    
    @Override
    public void delete(String relativePath) throws Exception {
        String key = buildKey(relativePath);
        s3Client.deleteObject(DeleteObjectRequest.builder()
            .bucket(bucketName)
            .key(key)
            .build());
        log.debug("Deleted file from S3: {}", key);
    }
    
    private String buildKey(String relativePath) {
        if (basePrefix.isEmpty()) {
            return relativePath;
        }
        return basePrefix + "/" + relativePath;
    }
    
    private String getSettingAsString(Map<String, Object> settings, String key) {
        Object value = settings.get(key);
        return value != null ? value.toString() : null;
    }
}

