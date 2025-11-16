# AWS Deployment for Magnolia CMS

This directory contains Terraform and Ansible configuration for deploying Magnolia CMS author instance to AWS EC2.

**Architecture:**
- **Terraform** - Manages AWS infrastructure (EC2 instances, security groups, networking)
- **Ansible** - Handles application deployment and configuration (idempotent, testable)

**Supports multiple environments:** Development (default), Production, Staging

## Prerequisites

- AWS account with appropriate permissions
- Terraform installed (>= 1.0)
- Ansible installed (>= 2.14)
- Python 3 (for Ansible)
- Node.js (for helper scripts)
- npm dependencies installed (`npm install`)

**Note:** 
- AWS credentials are configured via `aws-credentials.properties` file (see Step 1 below)
- SSH key pairs are automatically created if they don't exist (with user prompt)
- Uses AWS SDK v3 (no AWS CLI required)

### Installing Ansible

**macOS:**
```bash
brew install ansible
```

**Linux:**
```bash
pip3 install ansible
# or
sudo apt-get install ansible  # Debian/Ubuntu
sudo yum install ansible     # RHEL/CentOS
```

**Windows:**
```bash
pip install ansible

# After installation, you may need to add Python Scripts to your PATH:
# Usually: C:\Users\YourName\AppData\Local\Programs\Python\PythonXX\Scripts
# Or use the full path: python -m ansible.cli.galaxy

# Alternative: Use WSL (Windows Subsystem for Linux)
wsl --install
# Then install Ansible in WSL: sudo apt-get install ansible

### Install Ansible Collections

After installing Ansible, install required Ansible collections:

```bash
npm run aws:ansible:install
```

This script will automatically:
- Detect your Ansible installation (Windows, WSL, or native)
- Use WSL automatically on Windows if available
- Install the required collections (community.postgresql)

**Note:** The playbooks use built-in Ansible modules where possible. Only the `community.postgresql` collection is required for PostgreSQL database management.

**Manual installation:**
```bash
cd utils/aws/ansible
ansible-galaxy collection install -r requirements.yml

# On Windows with WSL:
wsl ansible-galaxy collection install -r requirements.yml

# On Windows native, if ansible-galaxy is not in PATH:
python -m ansible.cli.galaxy collection install -r requirements.yml
```

## Multi-Environment Setup

This setup supports multiple environments (development, production, staging) through:
- **Terraform variables** - Control AWS resource configuration
- **Magnolia configuration profiles** - Control application behavior
- **Separate Terraform workspaces** - Isolate environments

### Environment Overview

| Environment | Purpose | Default Instance | Profile | Configuration Location |
|------------|---------|------------------|---------|----------------------|
| **development** | AWS dev/testing | t3.medium | `development` | `WEB-INF/config/development/` |
| **production** | Live production | t3.large+ (recommended) | `production` | `WEB-INF/config/production/` |
| **staging** | Pre-production testing | t3.medium | `staging` | `WEB-INF/config/staging/` |

---

## Quick Start: Development Environment

Follow these steps to set up your **development** environment on AWS:

### Step 1: Configure AWS Credentials

Copy the example credentials file and configure it:

```bash
cd utils/aws
cp aws-credentials.properties.example aws-credentials.properties
```

Edit `aws-credentials.properties` and set your AWS credentials:

```properties
# AWS Access Key ID
aws.access.key.id=YOUR_AWS_ACCESS_KEY_ID

# AWS Secret Access Key
aws.secret.access.key=YOUR_AWS_SECRET_ACCESS_KEY

# AWS Region
aws.region=us-east-1

# PostgreSQL Password (must match postgres_db_password in terraform.tfvars)
postgres.password=YOUR_POSTGRES_PASSWORD
```

**Alternative:** If you prefer using AWS profiles (from `~/.aws/credentials`), you can set:
```properties
aws.profile=your-profile-name
```

**Note:** The `aws-credentials.properties` file is excluded from git to keep your credentials secure.

### Step 2: Configure Terraform for Development

Copy the example variables file and edit it:

```bash
cd utils/aws/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your development settings:

```hcl
# AWS Configuration
aws_region = "us-east-1"

# EC2 Instance Configuration
instance_type = "t3.medium"  # Suitable for development

# SSH Key Pair (will be created automatically if it doesn't exist)
key_pair_name = "magnolia-dev-key"

# Security Configuration
allowed_ssh_cidr = "YOUR_IP_ADDRESS/32"  # Restrict SSH to your IP

# Project Configuration
project_name = "magnolia-dev"

# Environment Configuration (for development)
environment      = "development"
magnolia_profile = "development"  # Uses WEB-INF/config/development/magnolia.properties

# PostgreSQL Configuration
postgres_db_name     = "jackrabbit"
postgres_db_user     = "magnolia"
postgres_db_password = "CHANGE_THIS_TO_STRONG_PASSWORD"  # IMPORTANT!
postgres_storage_size = 20  # GB - can be resized later

# Tags
tags = {
  Project     = "Magnolia-CMS"
  Environment = "Development"
  ManagedBy   = "Terraform"
}
```

**Key points for development:**
- `environment = "development"` - Tags resources for easy identification
- `magnolia_profile = "development"` - Uses development Magnolia configuration
- Smaller instance types are fine for development
- SSH access can be more permissive (but still recommended to restrict)

### Step 3: Install Ansible Collections

Before creating infrastructure, install required Ansible collections:

```bash
npm run aws:ansible:install
```

### Step 4: Create Development Infrastructure

From the project root:

```bash
npm run aws:create
```

This will:
- **Automatically check for SSH key pair** - If the key pair specified in `terraform.tfvars` doesn't exist in AWS, you'll be prompted to create it
- **Create SSH key pair if needed** - The private key will be automatically saved to `~/.ssh/{key_pair_name}.pem` with proper permissions (400)
- Initialize Terraform
- Validate configuration
- Create EC2 instances (Magnolia + PostgreSQL)
- Set up security groups
- Install Python 3 on instances (for Ansible)

#### Automatic SSH Key Pair Management

The script automatically manages SSH key pairs:

- **Checks if key pair exists** in AWS before creating infrastructure
- **Prompts user** if key pair needs to be created
- **Creates key pair** using AWS SDK v3 (no AWS CLI required)
- **Saves private key** to `~/.ssh/{key_pair_name}.pem` automatically
- **Sets proper permissions** (400 - read-only for owner)
- **Handles edge cases**:
  - Key exists in AWS but not locally → warns and asks to continue
  - Key exists locally but not in AWS → prompts to create new key pair
  - Key exists in both → proceeds without prompts

**Example prompt:**
```
🔍 SSH key pair 'magnolia-dev-key' not found in AWS
   Do you want to create it now? (y/n): y

🔑 Creating SSH key pair: magnolia-dev-key
   Region: us-east-1
✅ Key pair created successfully!
   Private key saved to: /home/user/.ssh/magnolia-dev-key.pem
   Key permissions set to 400 (read-only for owner)
```

### Step 5: Deploy Magnolia to Development

After infrastructure is created, deploy Magnolia:

```bash
npm run aws:deploy
```

The deployment script will automatically:
- Load AWS credentials from `aws-credentials.properties`
- Load PostgreSQL password from `aws-credentials.properties` (or `POSTGRES_PASSWORD` env var)
- Detect SSH key path from config or use default location
- Check if infrastructure setup is needed (Java, Tomcat, PostgreSQL)
- Run Ansible playbooks to set up infrastructure and deploy the application

**Note:** The PostgreSQL password in `aws-credentials.properties` must match `postgres_db_password` in your `terraform.tfvars` file.

This will:
- Build the Magnolia WAR file (unless `DEPLOY_SKIP_BUILD=true`)
- Run Ansible infrastructure playbook (if needed) to install Java, Tomcat, PostgreSQL
- Use Ansible to deploy the WAR file
- Configure Magnolia to use PostgreSQL with the `development` profile
- Start the Tomcat service

**Note:** The `POSTGRES_PASSWORD` environment variable must match the `postgres_db_password` value in your `terraform.tfvars` file.

### Step 6: Access Development Magnolia

After deployment, access Magnolia at:
```
http://<instance-ip>/author
```

The instance IP will be shown in the Terraform output. You can also get it with:
```bash
cd utils/aws/terraform
terraform output instance_public_ip
```

### Step 7: Clean Up Development (when done)

To remove all AWS resources:

```bash
npm run aws:clean
```

You will be prompted to type "CLEAN" to confirm.

## Infrastructure Details

### Magnolia EC2 Instance
- **Type:** t3.medium (4GB RAM, 2 vCPU)
- **OS:** Amazon Linux 2023
- **Storage:** 20GB GP3 EBS volume (encrypted)
- **Java:** Amazon Corretto 17
- **Tomcat:** 10.1.30

### PostgreSQL EC2 Instance
- **Type:** t3.micro (1GB RAM, 2 vCPU)
- **OS:** Amazon Linux 2023
- **Database:** PostgreSQL 15
- **Storage:** Separate EBS volume (configurable size, default 20GB)
- **Storage Type:** GP3 (can be resized without downtime)
- **Persistence:** Data stored on dedicated EBS volume (survives instance replacement)

### Security Groups

**Magnolia:**
- **SSH (22):** Configurable CIDR (default: 0.0.0.0/0)
- **HTTP (80):** Open to all (0.0.0.0/0)
- **HTTPS (443):** Open to all (0.0.0.0/0)

**PostgreSQL:**
- **PostgreSQL (5432):** Only accessible from Magnolia instance security group
- **SSH (22):** Configurable CIDR (default: 0.0.0.0/0)

### Network
- Port 80 is forwarded to Tomcat port 8080 using iptables
- Tomcat runs on port 8080 internally
- Magnolia connects to PostgreSQL via private IP (within VPC)

## Manual Operations

### SSH into Instance

```bash
# Get instance IP
cd utils/aws/terraform
terraform output instance_public_ip

# SSH connection
ssh -i ~/.ssh/your-key.pem ec2-user@<instance-ip>
```

### Check Tomcat Status

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<instance-ip>
sudo systemctl status tomcat
sudo journalctl -u tomcat -f
```

### View Magnolia Logs

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<instance-ip>
sudo tail -f /opt/tomcat/logs/catalina.out
```

### Restart Tomcat

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<instance-ip>
sudo systemctl restart tomcat
```

## Ansible Playbooks

The Ansible configuration is organized as follows:

```
ansible/
├── ansible.cfg              # Ansible configuration
├── inventory.ini            # Generated inventory (created by scripts)
├── vars.yml                 # Generated variables (created by scripts)
├── requirements.yml         # Ansible collection requirements
├── group_vars/
│   └── all.yml              # Common variables
└── playbooks/
    ├── infrastructure.yml   # Infrastructure setup (Java, Tomcat, PostgreSQL)
    └── site.yml             # Application deployment
```

### Roles

- **magnolia-infrastructure** - Installs Java, Tomcat, system configuration
- **magnolia-deployment** - Deploys WAR file, configures PostgreSQL connection
- **postgres-infrastructure** - Installs and configures PostgreSQL

### Running Ansible Manually

You can run Ansible playbooks manually:

```bash
cd utils/aws/ansible

# Generate inventory first (or create manually based on Terraform outputs)
# Then run:
ansible-playbook -i inventory.ini -e @vars.yml playbooks/infrastructure.yml
ansible-playbook -i inventory.ini -e @vars.yml playbooks/site.yml

# Run only infrastructure setup:
ansible-playbook -i inventory.ini -e @vars.yml playbooks/infrastructure.yml

# Run only deployment:
ansible-playbook -i inventory.ini -e @vars.yml playbooks/site.yml
```

## Configuration Files

- `terraform/main.tf` - Main Terraform configuration (infrastructure only)
- `terraform/variables.tf` - Input variables
- `terraform/outputs.tf` - Output values
- `terraform/terraform.tfvars` - Your specific configuration (not in git)
- `ansible/playbooks/` - Ansible playbooks for deployment
- `ansible/roles/` - Ansible roles for infrastructure and deployment
- `scripts/create.mjs` - Infrastructure creation script (includes automatic SSH key pair management)
- `scripts/deploy.mjs` - Deployment script (uses Ansible)
- `scripts/clean.mjs` - Cleanup script
- `scripts/keyPairManager.mjs` - SSH key pair management utility (uses AWS SDK v3)
- `scripts/loadAwsConfig.mjs` - AWS credentials and SDK client configuration

## Benefits of Terraform + Ansible Approach

✅ **Separation of Concerns**
- Terraform: Infrastructure as Code
- Ansible: Configuration Management

✅ **Idempotency**
- Ansible playbooks can be run multiple times safely
- No manual state tracking needed

✅ **Better Error Handling**
- Ansible provides clear error messages
- Failed tasks are clearly identified

✅ **Maintainability**
- YAML playbooks are easier to read than bash scripts
- Reusable roles and tasks

✅ **Testability**
- Playbooks can be tested locally
- Can use Ansible Vault for secrets

✅ **Extensibility**
- Easy to add new tasks or roles
- Can integrate with CI/CD pipelines

## Troubleshooting

### Ansible Not Installed

If you get an error about Ansible not being found:
```bash
# Install Ansible (see Prerequisites section)
# Then verify:
ansible --version
```

### Ansible Connection Issues

If Ansible can't connect:
1. Verify SSH key permissions: `chmod 400 ~/.ssh/your-key.pem`
2. Test SSH manually: `ssh -i ~/.ssh/your-key.pem ec2-user@<ip>`
3. Check security group allows SSH from your IP

### Ansible Playbook Fails

Check Ansible output for specific failed tasks. Common issues:
- Missing Python 3 on target host (should be installed by user_data)
- Network connectivity issues
- Insufficient permissions (Ansible uses `become: yes`)

### View Ansible Logs

Ansible provides detailed output. For more verbose logging:
```bash
ansible-playbook -i inventory.ini -e @vars.yml playbooks/site.yml -vvv
```

### Instance Not Responding

If the instance doesn't respond after creation:
1. Wait a few minutes for initialization to complete
2. Check security group rules
3. Verify SSH key permissions: `chmod 400 ~/.ssh/your-key.pem`
4. Ensure SSH key exists locally (should be created automatically)

### SSH Key Pair Issues

If you encounter SSH key pair issues:

**Key pair doesn't exist:**
- The script will automatically prompt you to create it
- If you decline, you can create it manually or update `key_pair_name` in `terraform.tfvars`

**Key pair exists in AWS but not locally:**
- The script will warn you and ask if you want to continue
- You can manually download the private key from AWS Console if needed
- Or create a new key pair with a different name

**Permission denied errors:**
- Ensure key file has correct permissions: `chmod 400 ~/.ssh/your-key.pem`
- On Windows, permissions are handled automatically by the script

### Deployment Fails

If deployment fails:
1. Check that the instance is ready: `terraform output instance_public_ip`
2. Verify SSH access: `ssh -i ~/.ssh/your-key.pem ec2-user@<ip>`
3. Check Tomcat logs on the instance
4. Ensure the WAR file was built successfully

### Terraform State Issues

If you encounter state issues:
- State is stored locally in `terraform/terraform.tfstate`
- Do not edit the state file manually
- Use `terraform refresh` to sync state with AWS

## Resizing PostgreSQL Storage

The PostgreSQL EBS volume can be resized without downtime:

### Using AWS Console:
1. Go to EC2 → Volumes
2. Select the PostgreSQL volume (check tags or volume ID from `terraform output`)
3. Actions → Modify Volume
4. Increase size
5. SSH into PostgreSQL instance and resize filesystem:
   ```bash
   ssh -i ~/.ssh/your-key.pem ec2-user@<postgres-ip>
   sudo growpart /dev/nvme0n1 1  # Adjust partition number if needed
   sudo resize2fs /dev/nvme1n1    # Resize ext4 filesystem
   ```

### Using Terraform:
Update `postgres_storage_size` in `terraform.tfvars` and run:
```bash
terraform apply
```

Then resize filesystem on the instance (as above).

## Database Configuration

Magnolia uses PostgreSQL for JCR (Java Content Repository) storage:
- **Database:** `jackrabbit` (configurable)
- **User:** `magnolia` (configurable)
- **Connection:** Via private IP (secure, within VPC)
- **Storage:** Persistent EBS volume (survives instance replacement)

The deployment script automatically configures Magnolia to use PostgreSQL.

## Setting Up Production Environment

When you're ready to deploy to production, follow these steps:

### Step 1: Create Production Magnolia Configuration Profile

Create the production configuration directory and file:

```bash
mkdir -p magnolia/magnolia-webapp/src/main/webapp/WEB-INF/config/production
cp magnolia/magnolia-webapp/src/main/webapp/WEB-INF/config/development/magnolia.properties \
   magnolia/magnolia-webapp/src/main/webapp/WEB-INF/config/production/magnolia.properties
```

Edit `magnolia/magnolia-webapp/src/main/webapp/WEB-INF/config/production/magnolia.properties`:

```properties
#--------------------------------------------
# AWS Production Profile
# This profile is used for AWS production deployments
#--------------------------------------------

# Development mode - DISABLED for production
magnolia.develop=false

# Superuser - DISABLED for production (use proper user management)
magnolia.superuser.enabled=false

# Activate UTF-8 support to pages
magnolia.utf8.enabled=true

# Auto-update - DISABLED for production (manual control)
magnolia.update.auto=false

# Bootstrap configuration
magnolia.bootstrap.authorInstance=true
magnolia.bootstrap.samples=false  # No sample data in production

# Webapp name displayed in admin
magnolia.webapp=AWS Production Author

# Jackrabbit indexing optimization
magnolia.repositories.jackrabbit.indexing.optimization=true

# Point to light-modules directory
magnolia.resources.dir=${magnolia.home}/../../light-modules

# Repository configuration
magnolia.repositories.home=${magnolia.home}/repositories
magnolia.logs.dir=${magnolia.home}/logs
magnolia.repositories.config=WEB-INF/config/default/repositories.xml
magnolia.repositories.jackrabbit.config=WEB-INF/config/repo-conf/jackrabbit-bundle-postgres-search.xml

magnolia.bundle.version=6.4.0-rc3
```

**Key differences from development:**
- `magnolia.develop=false` - Disables development features
- `magnolia.superuser.enabled=false` - Requires proper user management
- `magnolia.update.auto=false` - Manual control over updates
- `magnolia.bootstrap.samples=false` - No sample content

### Step 2: Create Separate Terraform Directory for Production

To keep environments isolated, create a separate Terraform directory:

```bash
# Copy the terraform directory
cp -r utils/aws/terraform utils/aws/terraform-production

# Or use Terraform workspaces (alternative approach)
cd utils/aws/terraform
terraform workspace new production
```

**Recommended:** Use separate directories for complete isolation.

### Step 3: Configure Production Terraform Variables

Edit `utils/aws/terraform-production/terraform.tfvars`:

```hcl
# AWS Configuration
aws_region = "us-east-1"

# EC2 Instance Configuration - LARGER for production
instance_type = "t3.large"  # or t3.xlarge for high traffic

# SSH Key Pair (can reuse or create separate production key)
key_pair_name = "magnolia-prod-key"

# Security Configuration - RESTRICTIVE for production
allowed_ssh_cidr = "YOUR_OFFICE_IP/32"  # Only allow from office/VPN

# Project Configuration
project_name = "magnolia-production"

# Environment Configuration (for production)
environment      = "production"
magnolia_profile = "production"  # Uses WEB-INF/config/production/magnolia.properties

# PostgreSQL Configuration
postgres_db_name     = "jackrabbit"
postgres_db_user     = "magnolia"
postgres_db_password = "VERY_STRONG_PRODUCTION_PASSWORD"  # Use strong password!
postgres_storage_size = 100  # Larger storage for production
postgres_storage_type = "gp3"

# Tags
tags = {
  Project     = "Magnolia-CMS"
  Environment = "Production"
  ManagedBy   = "Terraform"
  CostCenter  = "Production"
}
```

**Key differences from development:**
- Larger instance type (`t3.large` or higher)
- More restrictive SSH access
- Larger PostgreSQL storage
- Production-specific tags
- Stronger passwords

### Step 4: Initialize and Deploy Production

```bash
cd utils/aws/terraform-production

# Initialize Terraform
terraform init

# Review the plan
terraform plan

# Apply (creates production infrastructure)
terraform apply

# Deploy Magnolia
# Make sure aws-credentials.properties is configured with production credentials
cd ../..  # Back to project root
node utils/aws/scripts/deploy.mjs  # Deploy to production
```

**Note:** The deploy script will automatically detect the `magnolia_profile` from `terraform.tfvars` and use the production configuration.

### Step 5: Verify Production Deployment

1. Check that Magnolia is using production profile:
   ```bash
   ssh -i ~/.ssh/magnolia-prod-key.pem ec2-user@<production-ip>
   sudo systemctl status tomcat
   # Check logs for MAGNOLIA_PROFILE=production
   ```

2. Verify production settings:
   - Development mode should be disabled
   - Superuser should be disabled
   - Sample content should not be installed

## How Multi-Environment Configuration Works

### Configuration Profiles

Magnolia configuration profiles are located in:
```
magnolia/magnolia-webapp/src/main/webapp/WEB-INF/config/{profile}/magnolia.properties
```

Available profiles:
- **`development`** - AWS development environment (already created)
- **`local`** - Local Cargo development (already exists)
- **`production`** - Production environment (create when needed)
- **`staging`** - Staging environment (create if needed)

### How Profile Selection Works

1. **Terraform sets the profile:**
   - `magnolia_profile` variable in `terraform.tfvars`
   - Sets `-DMAGNOLIA_PROFILE={profile}` in Tomcat systemd service
   - Magnolia reads this system property at startup

2. **Magnolia loads configuration:**
   - Reads `WEB-INF/config/{MAGNOLIA_PROFILE}/magnolia.properties`
   - Falls back to `WEB-INF/config/default/magnolia.properties` if profile not found
   - Merges with shared configuration

3. **Environment isolation:**
   - Each environment has separate Terraform state
   - Separate AWS resources (instances, security groups, etc.)
   - Different configuration profiles
   - Can run simultaneously without conflicts

### Managing Multiple Environments

**Development:**
```bash
cd utils/aws/terraform
terraform workspace select default  # or use terraform/ directory
npm run aws:create
npm run aws:deploy
```

**Production:**
```bash
cd utils/aws/terraform-production
terraform apply
# Deploy using production-specific scripts or update deploy.mjs to accept environment parameter
```

**Best Practices:**
- Use separate AWS accounts or at least separate VPCs for production
- Use different SSH keys for each environment (automatically managed by the script)
- Restrict production SSH access to VPN/office IPs only
- Use larger instance types for production
- Enable CloudWatch monitoring for production
- Set up automated backups for production
- Use separate Terraform state backends (S3) for each environment
- Keep SSH private keys secure - they're automatically saved with 400 permissions

## Technical Details

### AWS SDK Integration

This project uses **AWS SDK v3** (JavaScript) for AWS operations:
- **No AWS CLI required** - All operations use the SDK
- **Automatic credential handling** - Supports both access keys and AWS profiles
- **SSH key pair management** - Automatic creation and management via SDK
- **Cross-platform** - Works on Windows, macOS, and Linux

**Dependencies:**
- `@aws-sdk/client-ec2` - EC2 service client for key pair operations
- `@aws-sdk/credential-providers` - Credential providers for profile-based auth

### Resource Tagging

All AWS resources are automatically tagged for:
- **Deployment tracking** - `CreatedDate` and `CreatedTime` tags
- **Cost allocation** - Custom tags via `tags` variable in `terraform.tfvars`
- **Environment management** - `Environment` tag from `environment` variable
- **Resource identification** - `Project`, `ManagedBy`, `TerraformRepo` tags

**Automatic tags applied to all resources:**
- `Environment` - From `environment` variable
- `Project` - From `project_name` variable
- `ManagedBy` - Set to "Terraform"
- `CreatedDate` - Deployment date (YYYY-MM-DD)
- `CreatedTime` - Deployment time (HH:mm:ss)
- `TerraformRepo` - Set to "MagnoliaSkeletons"

**Custom tags** can be added via the `tags` variable in `terraform.tfvars`:
```hcl
tags = {
  CostCenter  = "Engineering"
  Team        = "Platform"
  Owner       = "platform-team@example.com"
}
```

## Future Enhancements

- Add public instances (load balanced)
- Migrate Terraform state to S3 backend
- Set up CloudWatch monitoring
- Add SSL/TLS certificates
- Configure auto-scaling
- Add backup/restore functionality
- Set up automated EBS snapshots

## Security Best Practices

### Development Environment
- Restrict SSH access to your IP address
- Use strong PostgreSQL passwords
- Enable encrypted EBS volumes (already enabled)
- Regular security updates

### Production Environment
- **Restrict SSH access** to VPN/office IPs only (`allowed_ssh_cidr`)
- **Use IAM roles** instead of access keys where possible
- **Enable CloudTrail** for audit logging
- **Use encrypted EBS volumes** (already enabled)
- **Set up VPC** with private subnets (Magnolia in private subnet, ALB in public)
- **Use Application Load Balancer** with SSL termination
- **Enable AWS WAF** for DDoS protection
- **Set up automated backups** (EBS snapshots, RDS backups)
- **Use AWS Secrets Manager** for passwords instead of terraform.tfvars
- **Enable CloudWatch alarms** for monitoring
- **Regular security audits** and updates
- **Separate AWS accounts** for production (recommended)

## Cost Estimation

Approximate monthly costs (us-east-1):
- t3.medium instance (Magnolia): ~$30/month
- t3.micro instance (PostgreSQL): ~$7.50/month
- EBS storage (20GB Magnolia + 20GB PostgreSQL): ~$4/month
- Data transfer: Variable

Total: ~$41-50/month (excluding data transfer)

**Note:** Costs can be reduced by:
- Using smaller instance types for development
- Resizing EBS volumes as needed
- Using Reserved Instances for production

## Support

For issues or questions:
- Check Terraform documentation: https://www.terraform.io/docs
- Check AWS EC2 documentation: https://docs.aws.amazon.com/ec2/
- Check Magnolia documentation: https://documentation.magnolia-cms.com/

