# Extended Bootstrap Module

A Magnolia module that provides YAML-based bootstrapping for configuration and content, replacing the deprecated `magnolia.inject.config` functionality.

## Features

- **YAML-based bootstrapping**: Define configuration and content in easy-to-edit YAML files
- **Multiple workspaces**: Supports config, website, dam, users, and other workspaces
- **System property fallback**: Can configure license from system properties if YAML files are not available
- **Flexible structure**: Supports nested child nodes and various property types

## Configuration

### Option 1: YAML Files (Recommended)

1. Create a directory for YAML bootstrap files:
   ```
   ${magnolia.home}/bootstrap/yaml/
   ```

2. Or configure a custom directory via system property:
   ```
   -Dmagnolia.bootstrap.yaml.dir=/path/to/yaml/files
   ```

3. Create YAML files in that directory. Example: `license.yaml`
   ```yaml
   workspace: config
   path: /modules/enterprise/license
   properties:
     owner: "your-license-owner@example.com"
     key: "your-license-key-here"
   ```

### Option 2: System Properties (Fallback)

If YAML files are not found, the module will check for license system properties:
- `magnolia.license.owner`
- `magnolia.license.key`

These can be set via Maven system properties or JVM arguments.

## YAML File Format

### Basic Structure

```yaml
workspace: config          # Workspace name (config, website, dam, users, etc.)
path: /path/to/node       # JCR path to the node
properties:                # Node properties
  propertyName: value
  anotherProperty: value
children:                  # Optional: child nodes
  - path: child/path
    properties:
      prop: value
    children:              # Nested children are supported
      - path: nested/child
        properties:
          nestedProp: value
```

### Supported Property Types

- **String**: `property: "value"`
- **Boolean**: `enabled: true`
- **Integer**: `port: 8080`
- **Long**: `timestamp: 1234567890`
- **Double/Float**: `ratio: 1.5`
- **Multi-value** (String arrays): 
  ```yaml
  patterns:
    - "/pattern1"
    - "/pattern2"
  ```

### Example: License Configuration

```yaml
workspace: config
path: /modules/enterprise/license
properties:
  owner: "license@example.com"
  key: "your-license-key"
```

### Example: Server Configuration

```yaml
workspace: config
path: /server/filters/servlets/myServlet
properties:
  class: "info.magnolia.cms.filters.ServletDispatchingFilter"
  servletClass: "com.example.MyServlet"
  servletName: "myServlet"
  enabled: true
children:
  - path: mappings
    children:
      - path: myMapping
        properties:
          pattern: "/my-servlet/*"
```

### Example: Content Bootstrap

```yaml
workspace: website
path: /my-site/pages/home
properties:
  title: "Home Page"
  template: "my-template"
children:
  - path: content
    properties:
      heading: "Welcome"
      text: "This is the home page"
```

## Usage with Cargo

When using the Cargo Maven plugin, you can pass license properties:

```xml
<cargo.jvmargs>
  -Dmagnolia.license.owner=your-owner@example.com
  -Dmagnolia.license.key=your-license-key
</cargo.jvmargs>
```

Or configure via `magnolia-cargo.properties`:

```properties
magnolia.license.owner=your-owner@example.com
magnolia.license.key=your-license-key
```

The module will automatically configure the license during startup.

## Processing Order

1. Module installation/bootstrap: YAML files are processed during module installation
2. Module startup: YAML files are processed again on module startup (for runtime updates)
3. System properties: License properties are processed if YAML files are not found

## Logging

The module logs all bootstrap operations. Check Magnolia logs for:
- `ExtendedBootstrapModule` - Module initialization
- `YamlBootstrapProcessor` - YAML file processing
- `ExtendedBootstrapModuleVersionHandler` - Bootstrap task execution

## Migration from magnolia.inject.config

Replace:
```properties
-Dmagnolia.inject.config="createPath:/modules/enterprise/license;setProperty:/modules/enterprise/license,owner,${owner};setProperty:/modules/enterprise/license,key,${key}"
```

With:
- YAML file: `bootstrap/yaml/license.yaml` (see example above)
- Or system properties: `-Dmagnolia.license.owner=... -Dmagnolia.license.key=...`

