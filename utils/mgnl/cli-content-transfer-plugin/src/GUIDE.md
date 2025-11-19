# Content Transfer CLI Plugin Guide

The Content Transfer CLI plugin provides command-line access to the Content Transfer REST API for exporting and importing JCR content from Magnolia CMS.

## Installation

The plugin is automatically available when you run `npm run mgnl` or `mgnl` commands in your Magnolia project.

## Commands

### Server Configuration

Set or display the Magnolia server URL:

```bash
# Set server URL
mgnl content-transfer server http://localhost:8080

# Display current server URL
mgnl content-transfer server
```

You can also use the short alias:
```bash
mgnl ct server http://192.168.1.100:8080
```

### Configure

Send configuration to the Magnolia server:

```bash
# From a file
mgnl content-transfer configure config.json

# From stdin (pipe JSON)
cat config.json | mgnl content-transfer configure --stdin
```

### Export

Trigger an export operation:

```bash
mgnl content-transfer export
```

### Import

Trigger an import operation:

```bash
mgnl content-transfer import
```

## Configuration Format

The configuration JSON file has the following structure:

```json
{
  "output": {
    "type": "FileSystem|S3|SFTP|OneDrive",
    "destinationPath": "path/to/destination",
    "settings": {
      // Type-specific settings (authentication, etc.)
    }
  },
  "workspaces": [
    {
      "workspace": "workspace-name",
      "paths": [".*"],
      "mode": "combined|node"
    }
  ]
}
```

## Examples

### Local Development - FileSystem

For local development, use the FileSystem output type to export to a local directory.

**Example: `filesystem-config.json`**

```json
{
  "output": {
    "type": "FileSystem",
    "destinationPath": "d:/magnolia-data",
    "settings": {}
  },
  "workspaces": [
    {
      "workspace": "website",
      "paths": [".*"],
      "mode": "node"
    },
    {
      "workspace": "contacts",
      "paths": [".*"],
      "mode": "combined"
    }
  ]
}
```

**Usage:**

```bash
# Set server URL
mgnl ct server http://localhost:8080

# Configure
mgnl ct configure filesystem-config.json

# Export
mgnl ct export

# Import
mgnl ct import
```

**Explanation:**
- `website` workspace will be exported in `node` mode - each primary node (page) will be exported as a separate XML file
- `contacts` workspace will be exported in `combined` mode - the entire workspace will be exported as a single XML file
- Files will be written to `d:/magnolia-data/`

### AWS S3 Configuration

Export content to AWS S3 bucket.

**Example: `s3-config.json`**

```json
{
  "output": {
    "type": "S3",
    "destinationPath": "my-magnolia-bucket/exports",
    "settings": {
      "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
      "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "region": "us-east-1"
    }
  },
  "workspaces": [
    {
      "workspace": "website",
      "paths": ["/website/.*"],
      "mode": "node"
    },
    {
      "workspace": "contacts",
      "paths": [".*"],
      "mode": "combined"
    }
  ]
}
```

**Setting up AWS S3 Authentication:**

1. **Create IAM User:**
   - Go to AWS IAM Console
   - Create a new user (e.g., `magnolia-content-transfer`)
   - Attach policy: `AmazonS3FullAccess` or create custom policy with:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": [
             "s3:PutObject",
             "s3:GetObject",
             "s3:DeleteObject",
             "s3:ListBucket"
           ],
           "Resource": [
             "arn:aws:s3:::my-magnolia-bucket/*",
             "arn:aws:s3:::my-magnolia-bucket"
           ]
         }
       ]
     }
     ```

2. **Get Access Keys:**
   - After creating the user, go to "Security credentials" tab
   - Click "Create access key"
   - Choose "Application running outside AWS"
   - Save the Access Key ID and Secret Access Key

3. **Configure:**
   ```bash
   mgnl ct configure s3-config.json
   ```

**Security Note:** Never commit AWS credentials to version control. Use environment variables or secure credential management in production.

### SFTP Configuration

Export content to an SFTP server.

**Example: `sftp-config.json`**

```json
{
  "output": {
    "type": "SFTP",
    "destinationPath": "/var/magnolia/exports",
    "settings": {
      "host": "sftp.example.com",
      "port": 22,
      "username": "magnolia",
      "password": "your-password-here"
    }
  },
  "workspaces": [
    {
      "workspace": "website",
      "paths": [".*"],
      "mode": "node"
    },
    {
      "workspace": "contacts",
      "paths": [".*"],
      "mode": "combined"
    }
  ]
}
```

**Using SSH Key Authentication (Alternative):**

```json
{
  "output": {
    "type": "SFTP",
    "destinationPath": "/var/magnolia/exports",
    "settings": {
      "host": "sftp.example.com",
      "port": 22,
      "username": "magnolia",
      "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
      "passphrase": "optional-passphrase"
    }
  },
  "workspaces": [
    {
      "workspace": "website",
      "paths": [".*"],
      "mode": "node"
    }
  ]
}
```

**Setting up SFTP Authentication:**

1. **Password Authentication:**
   - Use username/password in the settings
   - Ensure the SFTP server allows password authentication

2. **SSH Key Authentication (Recommended):**
   - Generate SSH key pair:
     ```bash
     ssh-keygen -t rsa -b 4096 -f ~/.ssh/magnolia_sftp
     ```
   - Copy public key to SFTP server:
     ```bash
     ssh-copy-id -i ~/.ssh/magnolia_sftp.pub magnolia@sftp.example.com
     ```
   - Read private key content:
     ```bash
     cat ~/.ssh/magnolia_sftp
     ```
   - Paste the entire private key (including BEGIN/END lines) into the `privateKey` field

**Usage:**

```bash
mgnl ct configure sftp-config.json
mgnl ct export
```

### Microsoft OneDrive Configuration

Export content to Microsoft OneDrive.

**Example: `onedrive-config.json`**

```json
{
  "output": {
    "type": "OneDrive",
    "destinationPath": "MagnoliaExports",
    "settings": {
      "tenantId": "your-tenant-id",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "driveId": "me"
    }
  },
  "workspaces": [
    {
      "workspace": "website",
      "paths": [".*"],
      "mode": "node"
    },
    {
      "workspace": "contacts",
      "paths": [".*"],
      "mode": "combined"
    }
  ]
}
```

**Setting up OneDrive Authentication:**

1. **Register Azure AD Application:**
   - Go to Azure Portal (https://portal.azure.com)
   - Navigate to "Azure Active Directory" > "App registrations"
   - Click "New registration"
   - Name: `Magnolia Content Transfer`
   - Supported account types: Choose based on your needs
   - Redirect URI: Not needed for this use case
   - Click "Register"

2. **Get Application Details:**
   - Note the **Application (client) ID** - this is your `clientId`
   - Note the **Directory (tenant) ID** - this is your `tenantId`

3. **Create Client Secret:**
   - Go to "Certificates & secrets"
   - Click "New client secret"
   - Description: `Content Transfer Secret`
   - Expires: Choose expiration (e.g., 24 months)
   - Click "Add"
   - **Important:** Copy the secret value immediately - you won't be able to see it again
   - This is your `clientSecret`

4. **Configure API Permissions:**
   - Go to "API permissions"
   - Click "Add a permission"
   - Select "Microsoft Graph"
   - Choose "Application permissions"
   - Add the following permissions:
     - `Files.ReadWrite.All` (Read and write files in all site collections)
     - `Sites.ReadWrite.All` (Read and write items in all site collections)
   - Click "Add permissions"
   - Click "Grant admin consent" (requires admin privileges)

5. **Get Drive ID (Optional):**
   - `driveId: "me"` uses the default drive of the application
   - For a specific SharePoint site or OneDrive, you can specify a drive ID
   - To find a drive ID, use Microsoft Graph Explorer or API calls

**Usage:**

```bash
mgnl ct configure onedrive-config.json
mgnl ct export
```

## Path Patterns

The `paths` array accepts regex patterns to match JCR node paths:

- `[".*"]` - Match everything in the workspace
- `["/website/.*"]` - Match everything under `/website`
- `["/website/home", "/website/about"]` - Match specific paths
- `["/contacts/.*", "/users/.*"]` - Match multiple path patterns

## Export Modes

### Combined Mode

Exports the entire workspace or matching paths as a single XML file per workspace.

**Use case:** Full backup, simple exports, when you want everything in one file.

**Example:**
```json
{
  "workspace": "contacts",
  "paths": [".*"],
  "mode": "combined"
}
```

This creates: `contacts-export.xml`

### Node Mode

Exports each primary node separately, similar to Magnolia's native export format. Each page/content node gets its own XML file.

**Use case:** When you need individual files per page/node, version control, selective imports.

**Example:**
```json
{
  "workspace": "website",
  "paths": [".*"],
  "mode": "node"
}
```

This creates separate files like:
- `website/_website_home.xml`
- `website/_website_about.xml`
- `website/_website_contact.xml`

## Workflow Examples

### Complete Export/Import Workflow

```bash
# 1. Set server URL
mgnl ct server http://localhost:8080

# 2. Configure export settings
mgnl ct configure filesystem-config.json

# 3. Export content
mgnl ct export

# 4. (Optional) Verify exported files in d:/magnolia-data/

# 5. Import content (to another server or after changes)
mgnl ct server http://production-server:8080
mgnl ct configure filesystem-config.json
mgnl ct import
```

### Using Different Configurations

```bash
# Export to local filesystem
mgnl ct configure filesystem-config.json
mgnl ct export

# Export to S3
mgnl ct configure s3-config.json
mgnl ct export

# Export to SFTP
mgnl ct configure sftp-config.json
mgnl ct export
```

## Troubleshooting

### Connection Errors

If you get connection errors:

1. Verify the server URL:
   ```bash
   mgnl ct server
   ```

2. Check if Magnolia is running and accessible:
   ```bash
   curl http://localhost:8080/.magnolia
   ```

3. Ensure the content-transfer module is installed and the REST endpoint is available

### Authentication Errors

If you get "Unauthorized" errors:

- Verify the private key matches: `team$ite`
- Check that the content-transfer module is properly configured
- Ensure the REST servlet is registered

### Configuration Errors

If configuration fails:

- Validate your JSON syntax using a JSON validator
- Check that all required fields are present
- Verify authentication credentials are correct for the output type

### Export/Import Errors

If export/import fails:

- Check Magnolia logs for detailed error messages
- Verify workspace names exist in your Magnolia instance
- Ensure paths match actual JCR node paths
- Check file system permissions (for FileSystem output)
- Verify cloud service credentials and permissions (for S3/SFTP/OneDrive)

## Security Best Practices

1. **Never commit credentials to version control**
   - Use environment variables or secure credential stores
   - Consider using `.gitignore` for configuration files with credentials

2. **Use least privilege principle**
   - Grant only necessary permissions for cloud services
   - Use separate credentials for different environments

3. **Rotate credentials regularly**
   - Update AWS keys, SFTP passwords, and Azure secrets periodically

4. **Use SSH keys instead of passwords for SFTP**
   - More secure and easier to manage

5. **Protect configuration files**
   - Set appropriate file permissions
   - Use encrypted storage for sensitive configurations

## Additional Resources

- Magnolia CMS Documentation: https://documentation.magnolia-cms.com/
- AWS S3 Documentation: https://docs.aws.amazon.com/s3/
- Microsoft Graph API Documentation: https://docs.microsoft.com/en-us/graph/

