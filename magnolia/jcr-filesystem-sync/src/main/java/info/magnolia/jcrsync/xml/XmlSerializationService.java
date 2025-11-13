package info.magnolia.jcrsync.xml;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import info.magnolia.jcrsync.config.SyncConfigurationService;
import javax.jcr.Node;
import javax.jcr.NodeIterator;
import javax.jcr.Property;
import javax.jcr.PropertyIterator;
import javax.jcr.RepositoryException;
import javax.jcr.Session;
import javax.jcr.ImportUUIDBehavior;
import javax.jcr.Value;
import javax.jcr.ValueFactory;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Set;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Service for serializing JCR nodes to/from XML with pretty printing.
 */
public class XmlSerializationService {
    
    private static final Logger log = LoggerFactory.getLogger(XmlSerializationService.class);
    
    private final SyncConfigurationService configService;
    
    public XmlSerializationService(SyncConfigurationService configService) {
        this.configService = configService;
    }
    
    /**
     * Export a JCR node to XML file using JCR System View format.
     * This format is compatible with JCR importXML and Magnolia's XML import.
     * Filters out binary properties, access control nodes, and rep:jcr: properties.
     * Also filters out child nodes that have the same node type as the parent node
     * (e.g., child pages when exporting a page).
     * 
     * @param session JCR session
     * @param nodePath Path to the node to export
     * @param outputFile Output file path
     * @throws RepositoryException If JCR operation fails
     * @throws IOException If file operation fails
     */
    public void exportNodeToXml(Session session, String nodePath, Path outputFile) 
            throws RepositoryException, IOException {
        
        Node node = session.getNode(nodePath);
        String parentNodeType = node.getPrimaryNodeType().getName();
        
        // Manually build System View XML format (JCR 1.0 doesn't have exportSystemView)
        // This matches Magnolia's export format with <sv:node> and <sv:property> elements
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        
        pw.println("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        exportNodeToSystemView(node, pw, parentNodeType, 0);
        
        pw.close();
        String xmlContent = sw.toString();
        
        // Filter out unwanted nodes/properties and pretty print
        String filteredXml = filterAndPrettyPrintSystemView(xmlContent, nodePath, parentNodeType);
        
        // Write to file
        Files.createDirectories(outputFile.getParent());
        Files.write(outputFile, filteredXml.getBytes(StandardCharsets.UTF_8));
        
        log.debug("Exported node {} to {}", nodePath, outputFile);
    }
    
    /**
     * Export a node to System View XML format recursively.
     * Excludes child nodes that have the same node type as the parent.
     */
    private void exportNodeToSystemView(Node node, PrintWriter pw, String parentNodeType, int indent) 
            throws RepositoryException {
        
        String nodeName = node.getName();
        String nodeType = node.getPrimaryNodeType().getName();
        
        // Write node opening tag
        addIndent(pw, indent);
        pw.print("<sv:node sv:name=\"");
        pw.print(escapeXml(nodeName));
        pw.println("\" xmlns:sv=\"http://www.jcp.org/jcr/sv/1.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">");
        
        // Export properties
        PropertyIterator props = node.getProperties();
        Set<String> excludePropertyPrefixes = configService.getExcludePropertyPrefixes();
        
        while (props.hasNext()) {
            Property prop = props.nextProperty();
            String propName = prop.getName();
            
            // Skip rep: properties
            if (propName.startsWith("rep:")) {
                continue;
            }
            
            // Skip properties based on configured prefixes (e.g., mgnl:, jcr:)
            boolean shouldExclude = false;
            for (String prefix : excludePropertyPrefixes) {
                if (propName.startsWith(prefix)) {
                    // Always keep jcr:primaryType as it's required
                    if (propName.equals("jcr:primaryType")) {
                        shouldExclude = false;
                        break;
                    }
                    shouldExclude = true;
                    break;
                }
            }
            
            if (shouldExclude) {
                continue;
            }
            
            // Skip unwanted jcr: properties (if not already excluded)
            if (propName.equals("jcr:baseVersion") || 
                propName.equals("jcr:predecessors") || 
                propName.equals("jcr:successors") || 
                propName.equals("jcr:versionHistory") || 
                propName.equals("jcr:isCheckedOut")) {
                continue;
            }
            
            exportPropertyToSystemView(prop, pw, indent + 1);
        }
        
        // Export child nodes (excluding those with same type as parent)
        NodeIterator children = node.getNodes();
        while (children.hasNext()) {
            Node child = children.nextNode();
            String childType = child.getPrimaryNodeType().getName();
            
            // Skip child nodes that have the same type as their immediate parent
            // This prevents a page from including all child pages under it
            if (childType.equals(nodeType)) {
                log.debug("Skipping child node {} with same type as parent: {}", child.getName(), nodeType);
                continue;
            }
            
            // Recursively export child node (pass current node's type as parent type for children)
            exportNodeToSystemView(child, pw, nodeType, indent + 1);
        }
        
        // Write node closing tag
        addIndent(pw, indent);
        pw.println("</sv:node>");
    }
    
    /**
     * Export a property to System View XML format.
     */
    private void exportPropertyToSystemView(Property prop, PrintWriter pw, int indent) 
            throws RepositoryException {
        
        String propName = prop.getName();
        String propType = getPropertyTypeName(prop.getType());
        
        addIndent(pw, indent);
        pw.print("<sv:property sv:name=\"");
        pw.print(escapeXml(propName));
        pw.print("\" sv:type=\"");
        pw.print(propType);
        pw.println("\">");
        
        if (prop.getDefinition().isMultiple()) {
            // Multiple values
            Value[] values = prop.getValues();
            for (Value value : values) {
                addIndent(pw, indent + 1);
                pw.print("<sv:value>");
                pw.print(escapeXml(formatPropertyValue(value)));
                pw.println("</sv:value>");
            }
        } else {
            // Single value
            addIndent(pw, indent + 1);
            pw.print("<sv:value>");
            pw.print(escapeXml(formatPropertyValue(prop.getValue())));
            pw.println("</sv:value>");
        }
        
        addIndent(pw, indent);
        pw.println("</sv:property>");
    }
    
    /**
     * Format a property value as a string.
     */
    private String formatPropertyValue(Value value) throws RepositoryException {
        switch (value.getType()) {
            case javax.jcr.PropertyType.DATE:
                Calendar cal = value.getDate();
                // Format as ISO 8601
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
                sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                return sdf.format(cal.getTime());
            case javax.jcr.PropertyType.BOOLEAN:
                return String.valueOf(value.getBoolean());
            case javax.jcr.PropertyType.LONG:
                return String.valueOf(value.getLong());
            case javax.jcr.PropertyType.DOUBLE:
                return String.valueOf(value.getDouble());
            case javax.jcr.PropertyType.DECIMAL:
                return value.getDecimal().toString();
            default:
                return value.getString();
        }
    }
    
    /**
     * Get the property type name for System View format.
     */
    private String getPropertyTypeName(int type) {
        switch (type) {
            case javax.jcr.PropertyType.STRING:
                return "String";
            case javax.jcr.PropertyType.BINARY:
                return "Binary";
            case javax.jcr.PropertyType.LONG:
                return "Long";
            case javax.jcr.PropertyType.DOUBLE:
                return "Double";
            case javax.jcr.PropertyType.DECIMAL:
                return "Decimal";
            case javax.jcr.PropertyType.DATE:
                return "Date";
            case javax.jcr.PropertyType.BOOLEAN:
                return "Boolean";
            case javax.jcr.PropertyType.NAME:
                return "Name";
            case javax.jcr.PropertyType.PATH:
                return "Path";
            case javax.jcr.PropertyType.REFERENCE:
                return "Reference";
            case javax.jcr.PropertyType.WEAKREFERENCE:
                return "WeakReference";
            case javax.jcr.PropertyType.URI:
                return "URI";
            default:
                return "String";
        }
    }
    
    /**
     * Filter System View XML to remove any unwanted content and ensure proper formatting.
     * Most filtering is already done during export, but this serves as a safety net.
     * 
     * @param xml The XML content to filter
     * @param nodePath The path of the node being exported (for logging)
     * @param parentNodeType The primary node type of the parent node (unused, kept for compatibility)
     */
    private String filterAndPrettyPrintSystemView(String xml, String nodePath, String parentNodeType) {
        try {
            // XML is already clean from export, but do a final safety check
            // Remove any rep: properties that might have slipped through
            xml = xml.replaceAll("(?s)<sv:property[^>]*sv:name=\"rep:[^\"]*\"[^>]*>.*?</sv:property>", "");
            
            // Remove any unwanted jcr: properties that might have been added
            xml = xml.replaceAll("(?s)<sv:property[^>]*sv:name=\"jcr:baseVersion\"[^>]*>.*?</sv:property>", "");
            xml = xml.replaceAll("(?s)<sv:property[^>]*sv:name=\"jcr:predecessors\"[^>]*>.*?</sv:property>", "");
            xml = xml.replaceAll("(?s)<sv:property[^>]*sv:name=\"jcr:successors\"[^>]*>.*?</sv:property>", "");
            xml = xml.replaceAll("(?s)<sv:property[^>]*sv:name=\"jcr:versionHistory\"[^>]*>.*?</sv:property>", "");
            xml = xml.replaceAll("(?s)<sv:property[^>]*sv:name=\"jcr:isCheckedOut\"[^>]*>.*?</sv:property>", "");
            
            // Remove any rep: nodes that might have been added
            xml = xml.replaceAll("(?s)<sv:node[^>]*sv:name=\"rep:[^\"]*\"[^>]*>.*?</sv:node>", "");
            xml = xml.replaceAll("(?s)<sv:node[^>]*sv:name=\"[^\"]*accesscontrol[^\"]*\"[^>]*>.*?</sv:node>", "");
            xml = xml.replaceAll("(?s)<sv:node[^>]*sv:name=\"[^\"]*policy[^\"]*\"[^>]*>.*?</sv:node>", "");
            xml = xml.replaceAll("(?s)<sv:node[^>]*sv:name=\"jcr:versionStorage\"[^>]*>.*?</sv:node>", "");
            
            // XML is already properly formatted with tabs, just return it
            return xml;
            
        } catch (Exception e) {
            log.warn("Failed to filter XML, returning original", e);
            return xml;
        }
    }
    
    /**
     * Escape XML special characters.
     */
    private String escapeXml(String str) {
        if (str == null) return "";
        return str.replace("&", "&amp;")
                  .replace("<", "&lt;")
                  .replace(">", "&gt;")
                  .replace("\"", "&quot;")
                  .replace("'", "&apos;");
    }
    
    /**
     * Add indentation to writer.
     */
    private void addIndent(PrintWriter writer, int level) {
        for (int i = 0; i < level; i++) {
            writer.print("\t");
        }
    }
    
    /**
     * Import XML file to JCR node.
     * If node exists, updates its properties in place (preserving UUIDs and system properties).
     * If node doesn't exist, creates it via importXML.
     * 
     * @param session JCR session
     * @param jcrPath Full JCR path where the node should exist (e.g., "/home")
     * @param xmlFile XML file to import
     * @throws RepositoryException If JCR operation fails
     * @throws IOException If file operation fails
     */
    public void importXmlToNode(Session session, String jcrPath, Path xmlFile) 
            throws RepositoryException, IOException {
        
        if (!Files.exists(xmlFile)) {
            throw new IOException("XML file does not exist: " + xmlFile);
        }
        
        // Check if node already exists
        if (session.nodeExists(jcrPath)) {
            // Update existing node in place to preserve UUIDs and system properties
            log.debug("Node exists at {}, updating properties in place: {}", jcrPath, xmlFile);
            updateNodeFromXml(session, jcrPath, xmlFile);
        } else {
            // Node doesn't exist, create it via importXML
            log.debug("Node does not exist at {}, creating new node: {}", jcrPath, xmlFile);
            createNodeFromXml(session, jcrPath, xmlFile);
        }
        
        session.save();
        log.debug("Imported XML from {} to {}", xmlFile, jcrPath);
    }
    
    /**
     * Update an existing node's properties from XML file.
     * Preserves system properties like UUIDs, creation dates, etc.
     */
    private void updateNodeFromXml(Session session, String jcrPath, Path xmlFile) 
            throws RepositoryException, IOException {
        
        Node node = session.getNode(jcrPath);
        
        // Parse XML file
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        
        try {
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(xmlFile.toFile());
            Element rootElement = doc.getDocumentElement();
            
            // Get all property elements from XML
            // Try namespace-aware first, fallback to regular if needed
            NodeList propertyNodes = rootElement.getElementsByTagNameNS(
                "http://www.jcp.org/jcr/sv/1.0", "property");
            if (propertyNodes.getLength() == 0) {
                // Fallback to non-namespace search
                propertyNodes = rootElement.getElementsByTagName("sv:property");
            }
            
            Set<String> excludePropertyPrefixes = configService.getExcludePropertyPrefixes();
            
            // Update properties from XML
            for (int i = 0; i < propertyNodes.getLength(); i++) {
                Element propElement = (Element) propertyNodes.item(i);
                String propName = propElement.getAttribute("sv:name");
                if (propName == null || propName.isEmpty()) {
                    // Try without namespace prefix
                    propName = propElement.getAttribute("name");
                }
                String propType = propElement.getAttribute("sv:type");
                if (propType == null || propType.isEmpty()) {
                    // Try without namespace prefix
                    propType = propElement.getAttribute("type");
                }
                
                // Skip if property name or type is missing
                if (propName == null || propName.isEmpty() || propType == null || propType.isEmpty()) {
                    continue;
                }
                
                // Skip system properties that should be preserved
                if (propName.startsWith("rep:") || 
                    propName.equals("jcr:uuid") ||
                    propName.equals("jcr:created") ||
                    propName.equals("jcr:createdBy") ||
                    propName.equals("jcr:baseVersion") ||
                    propName.equals("jcr:predecessors") ||
                    propName.equals("jcr:successors") ||
                    propName.equals("jcr:versionHistory") ||
                    propName.equals("jcr:isCheckedOut")) {
                    continue;
                }
                
                // Skip properties based on configured prefixes (but keep jcr:primaryType)
                boolean shouldExclude = false;
                for (String prefix : excludePropertyPrefixes) {
                    if (propName.startsWith(prefix)) {
                        if (propName.equals("jcr:primaryType")) {
                            shouldExclude = false;
                            break;
                        }
                        shouldExclude = true;
                        break;
                    }
                }
                if (shouldExclude) {
                    continue;
                }
                
                // Get property values from XML
                NodeList valueNodes = propElement.getElementsByTagNameNS(
                    "http://www.jcp.org/jcr/sv/1.0", "value");
                if (valueNodes.getLength() == 0) {
                    // Fallback to non-namespace search
                    valueNodes = propElement.getElementsByTagName("sv:value");
                }
                
                if (valueNodes.getLength() == 0) {
                    continue;
                }
                
                // Determine if multi-valued
                boolean isMultiValued = valueNodes.getLength() > 1;
                
                try {
                    if (isMultiValued) {
                        // Multi-valued property
                        List<String> values = new ArrayList<>();
                        for (int j = 0; j < valueNodes.getLength(); j++) {
                            String value = valueNodes.item(j).getTextContent();
                            values.add(value);
                        }
                        setPropertyValue(node, propName, propType, values.toArray(new String[0]));
                    } else {
                        // Single-valued property
                        String value = valueNodes.item(0).getTextContent();
                        setPropertyValue(node, propName, propType, value);
                    }
                } catch (Exception e) {
                    log.warn("Failed to set property {} on node {}: {}", propName, jcrPath, e.getMessage());
                }
            }
            
        } catch (Exception e) {
            throw new IOException("Failed to parse XML file: " + xmlFile, e);
        }
    }
    
    /**
     * Create a new node from XML file using importXML.
     */
    private void createNodeFromXml(Session session, String jcrPath, Path xmlFile) 
            throws RepositoryException, IOException {
        
        // Determine parent path
        String parentPath = jcrPath.equals("/") ? "/" : 
            jcrPath.substring(0, jcrPath.lastIndexOf('/'));
        if (parentPath.isEmpty()) {
            parentPath = "/";
        }
        
        // Read XML content
        byte[] xmlBytes = Files.readAllBytes(xmlFile);
        InputStream xmlStream = new ByteArrayInputStream(xmlBytes);
        
        // Import using JCR importXML
        session.importXML(parentPath, xmlStream, ImportUUIDBehavior.IMPORT_UUID_CREATE_NEW);
    }
    
    /**
     * Set a property value on a node, handling different property types.
     */
    private void setPropertyValue(Node node, String propName, String propType, Object value) 
            throws RepositoryException {
        
        if (value == null) {
            if (node.hasProperty(propName)) {
                node.getProperty(propName).remove();
            }
            return;
        }
        
        ValueFactory valueFactory = node.getSession().getValueFactory();
        
        try {
            switch (propType) {
                case "String":
                    if (value instanceof String[]) {
                        node.setProperty(propName, (String[]) value);
                    } else {
                        node.setProperty(propName, value.toString());
                    }
                    break;
                case "Long":
                    if (value instanceof String[]) {
                        Value[] longValues = new Value[((String[]) value).length];
                        for (int i = 0; i < longValues.length; i++) {
                            longValues[i] = valueFactory.createValue(Long.parseLong(((String[]) value)[i]));
                        }
                        node.setProperty(propName, longValues);
                    } else {
                        node.setProperty(propName, Long.parseLong(value.toString()));
                    }
                    break;
                case "Double":
                    if (value instanceof String[]) {
                        Value[] doubleValues = new Value[((String[]) value).length];
                        for (int i = 0; i < doubleValues.length; i++) {
                            doubleValues[i] = valueFactory.createValue(Double.parseDouble(((String[]) value)[i]));
                        }
                        node.setProperty(propName, doubleValues);
                    } else {
                        node.setProperty(propName, Double.parseDouble(value.toString()));
                    }
                    break;
                case "Boolean":
                    if (value instanceof String[]) {
                        Value[] boolValues = new Value[((String[]) value).length];
                        for (int i = 0; i < boolValues.length; i++) {
                            boolValues[i] = valueFactory.createValue(Boolean.parseBoolean(((String[]) value)[i]));
                        }
                        node.setProperty(propName, boolValues);
                    } else {
                        node.setProperty(propName, Boolean.parseBoolean(value.toString()));
                    }
                    break;
                case "Date":
                    // Date handling - parse ISO 8601 format
                    if (value instanceof String[]) {
                        Value[] calValues = new Value[((String[]) value).length];
                        for (int i = 0; i < calValues.length; i++) {
                            calValues[i] = valueFactory.createValue(parseDate(((String[]) value)[i]));
                        }
                        node.setProperty(propName, calValues);
                    } else {
                        node.setProperty(propName, parseDate(value.toString()));
                    }
                    break;
                case "Name":
                case "Path":
                    // Name and Path types are stored as strings
                    if (value instanceof String[]) {
                        node.setProperty(propName, (String[]) value);
                    } else {
                        node.setProperty(propName, value.toString());
                    }
                    break;
                default:
                    // Default to String for unknown types
                    if (value instanceof String[]) {
                        node.setProperty(propName, (String[]) value);
                    } else {
                        node.setProperty(propName, value.toString());
                    }
                    break;
            }
        } catch (Exception e) {
            log.warn("Failed to set property {} with type {}: {}", propName, propType, e.getMessage());
            // Fallback to string
            if (value instanceof String[]) {
                node.setProperty(propName, (String[]) value);
            } else {
                node.setProperty(propName, value.toString());
            }
        }
    }
    
    /**
     * Parse a date string (ISO 8601 format) to Calendar.
     */
    private Calendar parseDate(String dateStr) {
        try {
            // Try ISO 8601 format first
            java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ");
            java.util.Date date = sdf.parse(dateStr);
            Calendar cal = Calendar.getInstance();
            cal.setTime(date);
            return cal;
        } catch (Exception e) {
            try {
                // Try without milliseconds
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ");
                java.util.Date date = sdf.parse(dateStr);
                Calendar cal = Calendar.getInstance();
                cal.setTime(date);
                return cal;
            } catch (Exception e2) {
                log.warn("Failed to parse date: {}", dateStr);
                return Calendar.getInstance();
            }
        }
    }
    
    /**
     * Delete a JCR node (used when XML file is deleted).
     * 
     * @param session JCR session
     * @param nodePath Path to the node to delete
     * @throws RepositoryException If JCR operation fails
     */
    public void deleteNode(Session session, String nodePath) throws RepositoryException {
        if (session.nodeExists(nodePath)) {
            Node node = session.getNode(nodePath);
            node.remove();
            session.save();
            log.debug("Deleted node: {}", nodePath);
        }
    }
    
    /**
     * Pretty print XML content with indentation.
     * Simple implementation that adds line breaks and indentation.
     */
    private String prettyPrintXml(String xml) {
        if (xml == null || xml.trim().isEmpty()) {
            return xml;
        }
        
        try {
            // Remove existing whitespace between tags
            String compact = xml.replaceAll(">\\s+<", "><");
            
            // Add line breaks and indentation
            StringBuilder pretty = new StringBuilder();
            int indent = 0;
            boolean inTag = false;
            boolean inClosingTag = false;
            
            for (int i = 0; i < compact.length(); i++) {
                char c = compact.charAt(i);
                
                if (c == '<') {
                    if (i > 0 && compact.charAt(i - 1) == '>') {
                        pretty.append('\n');
                        addIndent(pretty, indent);
                    }
                    inTag = true;
                    if (i + 1 < compact.length() && compact.charAt(i + 1) == '/') {
                        inClosingTag = true;
                        indent--;
                        pretty.append('\n');
                        addIndent(pretty, indent);
                    }
                    pretty.append(c);
                } else if (c == '>') {
                    pretty.append(c);
                    inTag = false;
                    if (!inClosingTag) {
                        indent++;
                    }
                    inClosingTag = false;
                } else if (c == '/' && i + 1 < compact.length() && compact.charAt(i + 1) == '>') {
                    // Self-closing tag
                    indent--;
                    pretty.append(c);
                } else {
                    pretty.append(c);
                }
            }
            
            return pretty.toString();
            
        } catch (Exception e) {
            log.warn("Failed to pretty print XML, returning original", e);
            return xml;
        }
    }
    
    /**
     * Add indentation spaces to StringBuilder.
     */
    private void addIndent(StringBuilder sb, int level) {
        for (int i = 0; i < level * 2; i++) {
            sb.append(' ');
        }
    }
    
    /**
     * Check if a node exists in JCR.
     */
    public boolean nodeExists(Session session, String nodePath) {
        try {
            return session.nodeExists(nodePath);
        } catch (RepositoryException e) {
            log.error("Error checking node existence: {}", nodePath, e);
            return false;
        }
    }
}

