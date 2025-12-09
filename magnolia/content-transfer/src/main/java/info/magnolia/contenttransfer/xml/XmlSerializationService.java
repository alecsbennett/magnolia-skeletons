package info.magnolia.contenttransfer.xml;

import info.magnolia.contenttransfer.config.ContentTransferConfigurationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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
import java.util.HashSet;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Service for serializing JCR nodes to/from XML with pretty printing.
 * Service for serializing JCR nodes to/from XML.
 */
public class XmlSerializationService {
    
    private static final Logger log = LoggerFactory.getLogger(XmlSerializationService.class);
    
    // Note: configService is now passed per-call to methods that need it
    // This constructor parameter is kept for backward compatibility but not stored
    public XmlSerializationService(ContentTransferConfigurationService configService) {
        // No longer storing configService - it's passed per-request
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
     * @param outputStream Output stream to write XML to
     * @throws RepositoryException If JCR operation fails
     * @throws IOException If file operation fails
     */
    public void exportNodeToXml(Session session, String nodePath, java.io.OutputStream outputStream) 
            throws RepositoryException, IOException {
        exportNodeToXml(session, nodePath, outputStream, null);
    }
    
    public void exportNodeToXml(Session session, String nodePath, java.io.OutputStream outputStream,
            ContentTransferConfigurationService configService) 
            throws RepositoryException, IOException {
        
        Node node = session.getNode(nodePath);
        String parentNodeType = node.getPrimaryNodeType().getName();
        
        // Manually build System View XML format (JCR 1.0 doesn't have exportSystemView)
        // This matches Magnolia's export format with <sv:node> and <sv:property> elements
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        
        pw.println("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        exportNodeToSystemView(node, pw, parentNodeType, 0, configService);
        
        pw.close();
        String xmlContent = sw.toString();
        
        // Filter out unwanted nodes/properties and pretty print
        String filteredXml = filterAndPrettyPrintSystemView(xmlContent, nodePath, parentNodeType);
        
        // Write to output stream
        outputStream.write(filteredXml.getBytes(StandardCharsets.UTF_8));
        
        log.debug("Exported node {} to output stream", nodePath);
    }
    
    /**
     * Export a node to System View XML format recursively.
     * Excludes child nodes that have the same node type as the parent.
     */
    private void exportNodeToSystemView(Node node, PrintWriter pw, String parentNodeType, int indent) 
            throws RepositoryException {
        exportNodeToSystemView(node, pw, parentNodeType, indent, null);
    }
    
    private void exportNodeToSystemView(Node node, PrintWriter pw, String parentNodeType, int indent,
            ContentTransferConfigurationService configService) 
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
        
        while (props.hasNext()) {
            Property prop = props.nextProperty();
            String propName = prop.getName();
            
            // Skip rep: properties
            if (propName.startsWith("rep:")) {
                continue;
            }
            
            // Skip properties based on configured filters
            if (shouldExcludeProperty(propName, configService)) {
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
                exportNodeToSystemView(child, pw, nodeType, indent + 1, configService);
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
     * Check if a property should be excluded based on configured filters.
     * 
     * @param propertyName The property name to check
     * @param configService The configuration service (may be null)
     * @return true if the property should be excluded, false otherwise
     */
    private boolean shouldExcludeProperty(String propertyName, ContentTransferConfigurationService configService) {
        if (configService == null || configService.getOutputConfig() == null) {
            // Fallback to default behavior if no config is available
            // Exclude jcr: and mgnl: properties except jcr:primaryType
            if (propertyName.startsWith("jcr:")) {
                return !propertyName.equals("jcr:primaryType");
            }
            if (propertyName.startsWith("mgnl:")) {
                return !propertyName.equals("mgnl:template");
            }
            return false;
        }
        
        List<ContentTransferConfigurationService.FilterConfig> filters = 
            configService.getOutputConfig().getFilters();
        
        if (filters == null || filters.isEmpty()) {
            // No filters configured, don't exclude anything
            return false;
        }
        
        // Check each filter - if any filter says to exclude, exclude it
        for (ContentTransferConfigurationService.FilterConfig filter : filters) {
            if (filter.shouldExclude(propertyName)) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Filter System View XML to remove any unwanted content and ensure proper formatting.
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
     * Import XML from input stream to JCR node.
     * If node exists, updates its properties in place (preserving UUIDs and system properties).
     * If node doesn't exist, creates it via importXML.
     * Also processes child nodes recursively.
     * 
     * @param session JCR session
     * @param jcrPath Full JCR path where the node should exist (e.g., "/home")
     * @param xmlInputStream XML input stream to import
     * @throws RepositoryException If JCR operation fails
     * @throws IOException If file operation fails
     */
    public void importXmlToNode(Session session, String jcrPath, InputStream xmlInputStream) 
            throws RepositoryException, IOException {
        
        // Read XML content into memory for parsing
        byte[] buffer = new byte[8192];
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        int bytesRead;
        while ((bytesRead = xmlInputStream.read(buffer)) != -1) {
            baos.write(buffer, 0, bytesRead);
        }
        byte[] xmlBytes = baos.toByteArray();
        
        // Check if node already exists
        if (session.nodeExists(jcrPath)) {
            // Update existing node in place to preserve UUIDs and system properties
            log.debug("Node exists at {}, updating properties in place", jcrPath);
            updateNodeFromXml(session, jcrPath, xmlBytes);
        } else {
            // Node doesn't exist, create it via importXML
            log.debug("Node does not exist at {}, creating new node", jcrPath);
            createNodeFromXml(session, jcrPath, xmlBytes);
        }
        
        session.save();
        log.debug("Imported XML to {}", jcrPath);
    }
    
    /**
     * Update an existing node's properties from XML bytes.
     * Preserves system properties like UUIDs, creation dates, etc.
     * Also processes child nodes recursively.
     */
    private void updateNodeFromXml(Session session, String jcrPath, byte[] xmlBytes) 
            throws RepositoryException, IOException {
        
        javax.jcr.Node node = session.getNode(jcrPath);
        
        // Parse XML
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        
        try {
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(new java.io.ByteArrayInputStream(xmlBytes));
            Element rootElement = doc.getDocumentElement();
            
            // Get all property elements from XML
            NodeList propertyNodes = rootElement.getElementsByTagNameNS(
                "http://www.jcp.org/jcr/sv/1.0", "property");
            if (propertyNodes.getLength() == 0) {
                // Fallback to non-namespace search
                propertyNodes = rootElement.getElementsByTagName("sv:property");
            }
            
            // Update properties from XML (skip system properties)
            for (int i = 0; i < propertyNodes.getLength(); i++) {
                Element propElement = (Element) propertyNodes.item(i);
                String propName = propElement.getAttribute("sv:name");
                
                // Skip system properties that shouldn't be updated
                if (propName.startsWith("jcr:") && 
                    !propName.equals("jcr:primaryType") && 
                    !propName.equals("jcr:mixinTypes")) {
                    continue;
                }
                if (propName.startsWith("rep:")) {
                    continue;
                }
                
                String propType = propElement.getAttribute("sv:type");
                NodeList valueNodes = propElement.getElementsByTagNameNS(
                    "http://www.jcp.org/jcr/sv/1.0", "value");
                if (valueNodes.getLength() == 0) {
                    valueNodes = propElement.getElementsByTagName("sv:value");
                }
                
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
            
            // Process direct child nodes recursively (only immediate children, not nested)
            // Get direct child sv:node elements
            org.w3c.dom.NodeList allNodes = rootElement.getChildNodes();
            for (int i = 0; i < allNodes.getLength(); i++) {
                org.w3c.dom.Node childNode = allNodes.item(i);
                if (childNode.getNodeType() == org.w3c.dom.Node.ELEMENT_NODE) {
                    Element childElement = (Element) childNode;
                    String localName = childElement.getLocalName();
                    if ("node".equals(localName) || "sv:node".equals(childElement.getTagName())) {
                        String childName = childElement.getAttribute("sv:name");
                        if (childName == null || childName.isEmpty()) {
                            continue;
                        }
                        String childPath = jcrPath.equals("/") ? "/" + childName : jcrPath + "/" + childName;
                        
                        // Recursively process child node by converting element back to XML
                        try {
                            // Convert child element to XML string
                            javax.xml.transform.TransformerFactory tf = javax.xml.transform.TransformerFactory.newInstance();
                            javax.xml.transform.Transformer transformer = tf.newTransformer();
                            transformer.setOutputProperty(javax.xml.transform.OutputKeys.OMIT_XML_DECLARATION, "yes");
                            StringWriter sw = new StringWriter();
                            javax.xml.transform.stream.StreamResult result = new javax.xml.transform.stream.StreamResult(sw);
                            javax.xml.transform.dom.DOMSource source = new javax.xml.transform.dom.DOMSource(childElement);
                            transformer.transform(source, result);
                            String childXml = sw.toString();
                            
                            // Wrap in proper XML structure
                            String fullChildXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><sv:root xmlns:sv=\"http://www.jcp.org/jcr/sv/1.0\">" + 
                                childXml + "</sv:root>";
                            
                            byte[] childXmlBytes = fullChildXml.getBytes(StandardCharsets.UTF_8);
                            importXmlToNode(session, childPath, new java.io.ByteArrayInputStream(childXmlBytes));
                        } catch (Exception e) {
                            log.warn("Failed to import child node {}: {}", childPath, e.getMessage(), e);
                        }
                    }
                }
            }
            
        } catch (Exception e) {
            throw new IOException("Failed to parse XML", e);
        }
    }
    
    /**
     * Create a new node from XML bytes using importXML.
     */
    private void createNodeFromXml(Session session, String jcrPath, byte[] xmlBytes) 
            throws RepositoryException, IOException {
        
        // Determine parent path
        String parentPath = jcrPath.equals("/") ? "/" : 
            jcrPath.substring(0, jcrPath.lastIndexOf('/'));
        if (parentPath.isEmpty()) {
            parentPath = "/";
        }
        
        // Ensure parent exists
        if (!parentPath.equals("/") && !session.nodeExists(parentPath)) {
            log.warn("Parent path does not exist: {}, cannot create node at {}", parentPath, jcrPath);
            return;
        }
        
        // Import using JCR importXML
        InputStream xmlStream = new java.io.ByteArrayInputStream(xmlBytes);
        session.importXML(parentPath, xmlStream, ImportUUIDBehavior.IMPORT_UUID_CREATE_NEW);
    }
    
    /**
     * Set a property value on a node, handling different property types.
     */
    private void setPropertyValue(javax.jcr.Node node, String propName, String propType, Object value) 
            throws RepositoryException {
        
        javax.jcr.ValueFactory valueFactory = node.getSession().getValueFactory();
        
        try {
            if (value instanceof String[]) {
                // Multi-valued property
                String[] stringValues = (String[]) value;
                javax.jcr.Value[] jcrValues = new javax.jcr.Value[stringValues.length];
                for (int i = 0; i < stringValues.length; i++) {
                    jcrValues[i] = createValue(valueFactory, propType, stringValues[i]);
                }
                node.setProperty(propName, jcrValues);
            } else {
                // Single-valued property
                javax.jcr.Value jcrValue = createValue(valueFactory, propType, value.toString());
                node.setProperty(propName, jcrValue);
            }
        } catch (Exception e) {
            log.warn("Failed to set property {} of type {}: {}", propName, propType, e.getMessage());
            // Fallback to string
            if (value instanceof String[]) {
                node.setProperty(propName, (String[]) value);
            } else {
                node.setProperty(propName, value.toString());
            }
        }
    }
    
    /**
     * Create a JCR Value from a string, handling different property types.
     */
    private javax.jcr.Value createValue(javax.jcr.ValueFactory valueFactory, String propType, String value) 
            throws RepositoryException {
        
        if (propType == null || propType.isEmpty() || "String".equals(propType)) {
            return valueFactory.createValue(value);
        }
        
        try {
            switch (propType) {
                case "Long":
                    return valueFactory.createValue(Long.parseLong(value));
                case "Double":
                    return valueFactory.createValue(Double.parseDouble(value));
                case "Decimal":
                    return valueFactory.createValue(new java.math.BigDecimal(value));
                case "Boolean":
                    return valueFactory.createValue(Boolean.parseBoolean(value));
                case "Date":
                    // Parse ISO 8601 date and convert to Calendar
                    java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
                    sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                    java.util.Date date = sdf.parse(value);
                    java.util.Calendar cal = java.util.Calendar.getInstance();
                    cal.setTime(date);
                    return valueFactory.createValue(cal);
                case "Name":
                    return valueFactory.createValue(value, javax.jcr.PropertyType.NAME);
                case "Path":
                    return valueFactory.createValue(value, javax.jcr.PropertyType.PATH);
                default:
                    return valueFactory.createValue(value);
            }
        } catch (Exception e) {
            log.warn("Failed to parse value {} as type {}, using String: {}", value, propType, e.getMessage());
            return valueFactory.createValue(value);
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

