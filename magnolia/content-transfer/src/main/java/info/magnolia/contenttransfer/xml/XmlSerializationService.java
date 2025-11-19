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
 * Adapted from jcr-filesystem-sync module.
 */
public class XmlSerializationService {
    
    private static final Logger log = LoggerFactory.getLogger(XmlSerializationService.class);
    
    private final ContentTransferConfigurationService configService;
    
    public XmlSerializationService(ContentTransferConfigurationService configService) {
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
     * @param outputStream Output stream to write XML to
     * @throws RepositoryException If JCR operation fails
     * @throws IOException If file operation fails
     */
    public void exportNodeToXml(Session session, String nodePath, java.io.OutputStream outputStream) 
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
            if (shouldExcludeProperty(propName)) {
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
     * Check if a property should be excluded based on configured filters.
     * 
     * @param propertyName The property name to check
     * @return true if the property should be excluded, false otherwise
     */
    private boolean shouldExcludeProperty(String propertyName) {
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
     * 
     * @param session JCR session
     * @param jcrPath Full JCR path where the node should exist (e.g., "/home")
     * @param xmlInputStream XML input stream to import
     * @throws RepositoryException If JCR operation fails
     * @throws IOException If file operation fails
     */
    public void importXmlToNode(Session session, String jcrPath, InputStream xmlInputStream) 
            throws RepositoryException, IOException {
        
        // Determine parent path
        String parentPath = jcrPath.equals("/") ? "/" : 
            jcrPath.substring(0, jcrPath.lastIndexOf('/'));
        if (parentPath.isEmpty()) {
            parentPath = "/";
        }
        
        // Import using JCR importXML
        session.importXML(parentPath, xmlInputStream, ImportUUIDBehavior.IMPORT_UUID_CREATE_NEW);
        session.save();
        
        log.debug("Imported XML to {}", jcrPath);
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

