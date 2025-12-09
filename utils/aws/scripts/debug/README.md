# Debug Scripts

This folder contains diagnostic, test, and fix scripts that are useful for troubleshooting but are not part of the main deployment workflow (`create`, `clean`, `deploy`).

## Diagnostic Scripts

### Log Checking
- **`checkMagnoliaLogs.mjs`** - Comprehensive Magnolia/Tomcat log checker
  - Checks Tomcat service status
  - Shows catalina.out logs
  - Checks for errors
  - Verifies webapp directory structure
  - Tests HTTP connectivity

- **`checkInstallation.mjs`** - Detailed Tomcat installation status check
  - Checks file existence and permissions
  - Verifies service status
  - Checks installation markers

### PostgreSQL Diagnostics
- **`checkPostgresConnection.mjs`** - Tests PostgreSQL connectivity from Magnolia instance
  - Network connectivity tests
  - Repository configuration check
  - Connection testing

- **`checkPostgresConfig.mjs`** - Checks PostgreSQL server configuration
  - `listen_addresses` setting
  - `pg_hba.conf` entries
  - Port listening status
  - PostgreSQL logs

- **`checkPostgresCloudInit.mjs`** - Detailed cloud-init logs for PostgreSQL instance

### Resource Checking
- **`checkResources.mjs`** - Standalone resource checker
  - Finds tagged instances, security groups, volumes
  - Useful for manual verification

## Fix Scripts

- **`fixPostgresConfig.mjs`** - Fixes PostgreSQL configuration
  - Sets `listen_addresses` to `*`
  - Updates `pg_hba.conf` to allow connections from Magnolia
  - Restarts PostgreSQL

- **`fixMagnoliaPostgresConfig.mjs`** - Fixes Magnolia repository configuration
  - Updates JDBC connection URL
  - Updates database user and password
  - Verifies configuration

- **`verifyPostgresUser.mjs`** - Verifies and creates PostgreSQL user
  - Checks if `magnolia` user exists
  - Creates user if missing
  - Sets correct password
  - Grants necessary privileges

- **`restartTomcat.mjs`** - Restarts Tomcat service
  - Stops Tomcat
  - Waits briefly
  - Starts Tomcat
  - Shows status

## Test Scripts

These scripts were created during development/debugging to test specific functionality:

- **`testActualStatusCheck.mjs`** - Tests the exact status check logic
- **`testExactCodePath.mjs`** - Tests specific code paths
- **`testExactDeployCommand.mjs`** - Tests deploy command execution
- **`testFileChecks.mjs`** - Tests file existence checks
- **`testPostgresReadiness.mjs`** - Tests PostgreSQL readiness checks
- **`testReadinessCheck.mjs`** - Tests readiness check functions
- **`testStatCommand.mjs`** - Tests `stat` command execution
- **`testStatFailure.mjs`** - Tests fallback logic for stat failures
- **`testStatusChecks.mjs`** - Tests various status checks
- **`testTomcatUser.mjs`** - Tests Tomcat user creation and permissions
- **`testWaitMagnolia.mjs`** - Tests Magnolia instance readiness waiting

## Usage

All scripts can be run directly from the `debug` folder:

```bash
# From utils/aws directory
node scripts/debug/checkMagnoliaLogs.mjs
node scripts/debug/fixPostgresConfig.mjs
node scripts/debug/restartTomcat.mjs
```

Or from the debug folder:

```bash
cd scripts/debug
node checkMagnoliaLogs.mjs
node fixPostgresConfig.mjs
node restartTomcat.mjs
```

## Note

These scripts import from the parent directory (`../loadAwsConfig.mjs`, `../instanceReadiness.mjs`, etc.), so they must be run from the correct location or with the correct path structure.

