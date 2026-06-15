# Magnolia CMS 6.4 Enterprise Edition Skeleton

A skeleton project for Magnolia CMS 6.4 Enterprise Edition with integrated development utilities.

## Overview

This project provides a complete development environment for Magnolia CMS 6.4 Enterprise Edition, including:

- **Maven-based build system** for Magnolia webapp
- **Cargo integration** for embedded Tomcat server
- **Node.js utilities** for server management and monitoring
- **Pre-configured Tomcat** setup for development

## Prerequisites

- Java 25
- Maven 3.6+
- Node.js 14+ and npm (for utilities)
- Git

## Project Structure

```
├── magnolia/              # Maven parent project
│   └── magnolia-webapp/   # Magnolia webapp module
├── light-modules/         # Custom Magnolia light modules
├── tomcat/                # Tomcat runtime and configuration
├── utils/exec/            # Node.js utility scripts
└── magnolia-cargo.properties  # Configuration file
```

## Quick Start

### 1. Configure GitHub Packages

The webapp consumes the standalone `content-transfer` and `extended-bootstrap`
artifacts from GitHub Packages using the versions declared in
`magnolia/pom.xml`. Configure Maven credentials with a GitHub personal access
token that has `read:packages` access:

```xml
<servers>
  <server>
    <id>github-content-transfer</id>
    <username>YOUR_GITHUB_USERNAME</username>
    <password>YOUR_GITHUB_TOKEN</password>
  </server>
  <server>
    <id>github-extended-bootstrap</id>
    <username>YOUR_GITHUB_USERNAME</username>
    <password>YOUR_GITHUB_TOKEN</password>
  </server>
</servers>
```

For local module development, install either source project with
`mvn clean install` and temporarily select its snapshot version in
`magnolia/pom.xml`.

### 2. Install Dependencies

```bash
# Install the Magnolia CLI and utility dependencies
npm install
cd utils/exec
npm install
cd ../..
```

### 3. Configure

Edit `magnolia-cargo.properties` to customize:
- Ports
- Paths
- Behavior flags
- MailDev settings

### 4. Start the Server

```bash
# From utils/exec directory
npm start

# Explicit instance modes
npm run start:author
npm run start:public
npm run start:both

# Preferred Magnolia CLI entry point
./mgnl startx --author
./mgnl startx --public
./mgnl startx --both
```

### 5. Access Magnolia

- **Author instance**: http://localhost:8080/author
- **Public instance**: http://localhost:8081/
- **MailDev UI** (if enabled): http://localhost:1080

## Development Utilities

The project includes a comprehensive set of Node.js utilities for managing the development server. See [utils/exec/README.md](utils/exec/README.md) for detailed documentation.

### Common Commands

```bash
cd utils/exec

# Start author and public together
npm run start:both

# Start with browser auto-open
npm run start:open

# Stop server
npm run kill

# Restart server
npm run restart

# Build only
npm run build

# Monitor logs
npm run monitor
```

## Building the Project

### Maven Build

```bash
# Build the project
mvn clean install

# Build for author instance
mvn clean install -Pauthor

# Build for runtime instance
mvn clean install -Pruntime
```

## Configuration

### Magnolia Cargo Properties

All server configuration is managed through `magnolia-cargo.properties`. Key settings include:

- **Ports**: Author (8080) and public (8081) instance ports
- **Paths**: Working directories and log locations
- **Flags**: Behavior flags (log clearing, browser opening, etc.)
- **MailDev**: Email testing server configuration

See `utils/exec/CONFIG.md` for detailed configuration options.

### Environment Variables

You can override properties using environment variables:

```bash
CLEAR_LOGS=false npm start          # Skip log clearing
OPEN_BROWSER=true npm start         # Auto-open browser
FORCE_RESTART=true npm start        # Force restart
MAILDEV_ENABLED=false npm start     # Disable MailDev
```

## Light Modules

Custom Magnolia light modules should be placed in the `light-modules/` directory. Each module should follow the standard Magnolia light module structure.

## Troubleshooting

### Port Already in Use

```bash
cd utils/exec
npm run kill
# or force kill
npm run kill:force
```

### JCR Lock Issues

```bash
cd utils/exec
npm run clean:locks
```

### Build Issues

```bash
# Clean and rebuild
mvn clean install

# Clean Cargo directory
cd utils/exec
npm run clean:cargo
```

## Documentation

- [Magnolia CMS Documentation](https://documentation.magnolia-cms.com/)
- [Magnolia CMS 6.4 Release Notes](https://documentation.magnolia-cms.com/6.4/release-notes/)
- [Utilities Documentation](utils/exec/README.md)
- [Configuration Guide](utils/exec/CONFIG.md)

## License

This project uses Magnolia CMS Enterprise Edition. Please refer to the Magnolia CMS license for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For Magnolia CMS support:
- [Magnolia Enterprise Support](https://www.magnolia-cms.com/support)
- [Magnolia Documentation](https://documentation.magnolia-cms.com/)

