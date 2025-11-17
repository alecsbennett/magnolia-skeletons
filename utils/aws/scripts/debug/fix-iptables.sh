#!/bin/bash
#
# Fix iptables rules to allow port 80 access
# Removes broken OUTPUT NAT redirect rule and ensures proper INPUT/PREROUTING rules
#
# Usage: 
#   Local execution: ./fix-iptables.sh [tomcat_port] [server_ip] [ssh_key]
#   Server execution: ./fix-iptables.sh [tomcat_port]
#
# Arguments:
#   tomcat_port: Port where Tomcat is listening (default: 8080)
#   server_ip: Server IP address (optional, will try to get from Terraform if not provided)
#   ssh_key: SSH key path (optional, will try to get from env/config if not provided)
#
# Environment variables:
#   AWS_KEY_PATH: SSH key path override
#   TOMCAT_HOME: Tomcat installation directory (default: /opt/tomcat)
#

set -uo pipefail
# Note: We don't use 'set -e' because some commands intentionally return non-zero

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TOMCAT_PORT="${1:-8080}"
SERVER_IP="${2:-${SERVER_IP:-}}"  # Allow SERVER_IP from environment
SSH_KEY="${3:-}"
TOMCAT_HOME="${TOMCAT_HOME:-/opt/tomcat}"
IPTABLES_SAVE_FILE="/etc/sysconfig/iptables"
SSH_USER="ec2-user"

# Script directory (for finding Terraform directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/../terraform"

# Remote execution flag
REMOTE_MODE=false
SSH_CMD=""

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# Detect if we're running on the server or locally
detect_execution_mode() {
    # Check if we're on the server (check for /opt/tomcat or if we can run iptables directly)
    if [[ -d "/opt/tomcat" ]] || (command -v iptables &> /dev/null && [[ $EUID -eq 0 ]]); then
        REMOTE_MODE=false
        log_info "Running in local mode (on server)"
    else
        REMOTE_MODE=true
        log_info "Running in remote mode (will execute via SSH)"
    fi
}

# Get server IP from Terraform output
get_server_ip_from_terraform() {
    if [[ ! -d "${TERRAFORM_DIR}" ]]; then
        log_error "Terraform directory not found at ${TERRAFORM_DIR}"
        log_info "Expected location: ${TERRAFORM_DIR}"
        return 1
    fi
    
    if ! command -v terraform &> /dev/null; then
        log_error "terraform command not found in PATH"
        log_info "Please install Terraform or provide server IP manually"
        return 1
    fi
    
    log_info "Getting server IP from Terraform output..."
    log_debug "Terraform directory: ${TERRAFORM_DIR}"
    
    # Try to get IP from Terraform output
    cd "${TERRAFORM_DIR}" || {
        log_error "Failed to change to Terraform directory"
        return 1
    }
    
    local output
    local terraform_error
    if ! output=$(terraform output -json 2>&1); then
        terraform_error="$output"
        log_error "Failed to get Terraform output"
        log_debug "Terraform error: ${terraform_error}"
        cd - > /dev/null
        return 1
    fi
    
    # Try with jq first (more reliable)
    if command -v jq &> /dev/null; then
        SERVER_IP=$(echo "$output" | jq -r '.instance_public_ip.value // empty' 2>/dev/null)
        if [[ -z "${SERVER_IP}" ]]; then
            # Try alternative output keys
            SERVER_IP=$(echo "$output" | jq -r '.magnolia_instance_ip.value // .instance_ip.value // empty' 2>/dev/null)
        fi
    else
        # Basic parsing without jq - try multiple patterns
        SERVER_IP=$(echo "$output" | grep -o '"instance_public_ip"[^}]*"value"[^"]*"[^"]*"' | grep -o '[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}' | head -1)
        if [[ -z "${SERVER_IP}" ]]; then
            SERVER_IP=$(echo "$output" | grep -o '"magnolia_instance_ip"[^}]*"value"[^"]*"[^"]*"' | grep -o '[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}' | head -1)
        fi
        if [[ -z "${SERVER_IP}" ]]; then
            SERVER_IP=$(echo "$output" | grep -o '[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}' | head -1)
        fi
    fi
    
    cd - > /dev/null
    
    if [[ -z "${SERVER_IP}" ]]; then
        log_error "Could not get server IP from Terraform output"
        log_debug "Terraform output keys available:"
        if command -v jq &> /dev/null; then
            echo "$output" | jq -r 'keys[]' 2>/dev/null | while read -r key; do
                log_debug "  - $key"
            done || true
        else
            echo "$output" | grep -o '"[^"]*":' | sed 's/"//g' | sed 's/://g' | while read -r key; do
                log_debug "  - $key"
            done || true
        fi
        return 1
    fi
    
    log_info "Found server IP: ${SERVER_IP}"
    return 0
}

# Expand path (handles ~ and Windows paths)
expand_path() {
    local path="$1"
    # Expand ~
    if [[ "$path" =~ ^~ ]]; then
        path="${path/#\~/$HOME}"
    fi
    # Handle Windows paths in Git Bash (e.g., /c/Users/...)
    # Git Bash can handle both /c/... and C:/... formats, so we'll try to normalize
    if [[ "$path" =~ ^/[a-z]/ ]] && [[ -n "${MSYSTEM:-}" ]]; then
        # Try cygpath if available (Git Bash)
        local cygpath_result=$(cygpath -w "$path" 2>/dev/null || echo "")
        if [[ -n "$cygpath_result" ]]; then
            path="$cygpath_result"
        fi
    fi
    echo "$path"
}

# Get SSH key path from environment or config
get_ssh_key() {
    # Check if SSH key was provided as argument
    if [[ -n "${SSH_KEY}" ]]; then
        local expanded_key=$(expand_path "${SSH_KEY}")
        if [[ -f "${expanded_key}" ]]; then
            SSH_KEY="${expanded_key}"
            log_info "Using SSH key: ${SSH_KEY}"
            return 0
        else
            log_error "SSH key not found at: ${SSH_KEY}"
            return 1
        fi
    fi
    
    # Check environment variable
    if [[ -n "${AWS_KEY_PATH:-}" ]]; then
        local expanded_key=$(expand_path "${AWS_KEY_PATH}")
        if [[ -f "${expanded_key}" ]]; then
            SSH_KEY="${expanded_key}"
            log_info "Using SSH key from AWS_KEY_PATH: ${SSH_KEY}"
            return 0
        fi
    fi
    
    # Try to get from aws-credentials.properties
    local aws_dir="${SCRIPT_DIR}/.."
    local creds_file="${aws_dir}/aws-credentials.properties"
    log_debug "Checking aws-credentials.properties at: ${creds_file}"
    if [[ -f "${creds_file}" ]]; then
        log_debug "File exists, reading SSH key path..."
        local ssh_key_from_file
        ssh_key_from_file=$(grep -E "^aws\.ssh\.key\.path\s*=" "${creds_file}" 2>/dev/null | cut -d'=' -f2 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)
        log_debug "Found SSH key path in file: '${ssh_key_from_file}'"
        if [[ -n "${ssh_key_from_file}" ]]; then
            local expanded_key=$(expand_path "${ssh_key_from_file}")
            log_debug "Expanded path: '${expanded_key}'"
            if [[ -f "${expanded_key}" ]]; then
                SSH_KEY="${expanded_key}"
                log_info "Using SSH key from aws-credentials.properties: ${SSH_KEY}"
                return 0
            else
                log_debug "Expanded path does not exist: ${expanded_key}"
            fi
        else
            log_debug "No aws.ssh.key.path found in credentials file"
        fi
    else
        log_debug "aws-credentials.properties not found at: ${creds_file}"
    fi
    
    # Try to get from Terraform output
    if [[ -d "${TERRAFORM_DIR}" ]] && command -v terraform &> /dev/null; then
        log_debug "Checking Terraform output for SSH key..."
        cd "${TERRAFORM_DIR}" || return 1
        local output
        if output=$(terraform output -json 2>/dev/null); then
            local key_pair_name=""
            local ssh_cmd=""
            
            if command -v jq &> /dev/null; then
                ssh_cmd=$(echo "$output" | jq -r '.ssh_command.value // empty' 2>/dev/null)
                # Extract key pair name from ssh_command
                if [[ -n "${ssh_cmd}" ]]; then
                    key_pair_name=$(echo "$ssh_cmd" | grep -oE '~/.ssh/([^.]+)\.pem' | sed 's|~/.ssh/||' | sed 's|\.pem||' | head -1)
                fi
            else
                ssh_cmd=$(echo "$output" | grep -o '"ssh_command"[^}]*"value"[^"]*"[^"]*"' | head -1)
                if [[ -n "${ssh_cmd}" ]]; then
                    key_pair_name=$(echo "$ssh_cmd" | grep -oE '~/.ssh/([^.]+)\.pem' | sed 's|~/.ssh/||' | sed 's|\.pem||' | head -1)
                fi
            fi
            
            if [[ -n "${key_pair_name}" ]]; then
                log_debug "Found key pair name: ${key_pair_name}"
                # Try common locations with the key pair name
                local possible_keys=(
                    "${HOME}/.ssh/${key_pair_name}.pem"
                    "${HOME}/.ssh/${key_pair_name}"
                    "~/.ssh/${key_pair_name}.pem"
                )
                
                for key in "${possible_keys[@]}"; do
                    local expanded_key=$(expand_path "${key}")
                    log_debug "Trying key: ${expanded_key}"
                    if [[ -f "${expanded_key}" ]]; then
                        SSH_KEY="${expanded_key}"
                        log_info "Using SSH key from Terraform (key pair: ${key_pair_name}): ${SSH_KEY}"
                        cd - > /dev/null
                        return 0
                    fi
                done
                log_debug "Key pair ${key_pair_name} not found in common locations"
            else
                log_debug "Could not extract key pair name from Terraform output"
            fi
        fi
        cd - > /dev/null
    fi
    
    # Try common locations
    log_debug "Checking common SSH key locations..."
    local common_keys=(
        "${HOME}/.ssh/deploy-key.pem"
        "${HOME}/.ssh/aws-key.pem"
        "${HOME}/.ssh/id_rsa"
        "${HOME}/.ssh/id_ed25519"
    )
    
    for key in "${common_keys[@]}"; do
        local expanded_key=$(expand_path "${key}")
        if [[ -f "${expanded_key}" ]]; then
            SSH_KEY="${expanded_key}"
            log_info "Using SSH key from common location: ${SSH_KEY}"
            return 0
        fi
    done
    
    log_error "Could not find SSH key"
    log_info ""
    log_info "Tried the following locations:"
    log_info "  - Argument: ${3:-<not provided>}"
    log_info "  - AWS_KEY_PATH: ${AWS_KEY_PATH:-<not set>}"
    log_info "  - aws-credentials.properties: ${creds_file}"
    log_info "  - Terraform output (ssh_command)"
    log_info "  - Common locations: ~/.ssh/*.pem, ~/.ssh/id_rsa, etc."
    log_info ""
    log_info "You can provide it in one of these ways:"
    log_info "  1. As argument: $0 ${TOMCAT_PORT} ${SERVER_IP} <ssh_key_path>"
    log_info "  2. Set environment variable: AWS_KEY_PATH=<path> $0 ${TOMCAT_PORT}"
    log_info "  3. Set in aws-credentials.properties: aws.ssh.key.path=<path>"
    return 1
}

# Setup SSH command for remote execution
setup_ssh() {
    # Try to get IP from Terraform if not provided
    if [[ -z "${SERVER_IP}" ]]; then
        if ! get_server_ip_from_terraform; then
            log_error "Server IP is required for remote execution"
            log_info ""
            log_info "You can provide it in one of these ways:"
            log_info "  1. As argument: $0 ${TOMCAT_PORT} <server_ip> [ssh_key]"
            log_info "  2. Ensure Terraform output is available (run 'terraform output' in ${TERRAFORM_DIR})"
            log_info "  3. Set environment variable: SERVER_IP=<ip> $0 ${TOMCAT_PORT}"
            exit 1
        fi
    else
        log_info "Using provided server IP: ${SERVER_IP}"
    fi
    
    if ! get_ssh_key; then
        exit 1
    fi
    
    # Make SSH key readable only by owner
    chmod 600 "${SSH_KEY}" 2>/dev/null || true
    
    SSH_CMD="ssh -i \"${SSH_KEY}\" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${SSH_USER}@${SERVER_IP}"
    
    log_info "SSH command configured: ${SSH_USER}@${SERVER_IP}"
    
    # Test SSH connection
    log_info "Testing SSH connection..."
    if ! eval "${SSH_CMD} 'echo Connection test successful'" > /dev/null 2>&1; then
        log_error "Failed to connect to server via SSH"
        exit 1
    fi
    log_info "SSH connection successful"
}

# Execute command locally or remotely
execute_cmd() {
    local cmd="$1"
    
    if [[ "${REMOTE_MODE}" == true ]]; then
        # Escape single quotes in command for SSH
        local escaped_cmd=$(echo "$cmd" | sed "s/'/'\"'\"'/g")
        eval "${SSH_CMD} '${escaped_cmd}'"
    else
        eval "${cmd}"
    fi
}

check_root() {
    if [[ "${REMOTE_MODE}" == true ]]; then
        # For remote execution, we'll use sudo in commands
        return 0
    fi
    
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root when executing locally"
        exit 1
    fi
}

check_iptables() {
    if [[ "${REMOTE_MODE}" == true ]]; then
        if ! execute_cmd "command -v iptables &> /dev/null"; then
            log_error "iptables command not found on remote server. Please install iptables-services."
            exit 1
        fi
    else
        if ! command -v iptables &> /dev/null; then
            log_error "iptables command not found. Please install iptables-services."
            exit 1
        fi
    fi
}

###############################################################
# INPUT RULE - allow external traffic on port 80
###############################################################
ensure_input_rule() {
    log_info "Ensuring INPUT chain allows TCP port 80..."
    
    local sudo_prefix=""
    if [[ "${REMOTE_MODE}" == true ]]; then
        sudo_prefix="sudo "
    fi
    
    if execute_cmd "${sudo_prefix}iptables -C INPUT -p tcp --dport 80 -j ACCEPT" 2>/dev/null; then
        log_info "INPUT rule for port 80 already exists"
    else
        execute_cmd "${sudo_prefix}iptables -A INPUT -p tcp --dport 80 -j ACCEPT"
        log_info "Added INPUT rule to allow TCP port 80"
    fi
}

###############################################################
# NAT PREROUTING RULE - redirect external port 80 to tomcat_port
###############################################################
ensure_prerouting_rule() {
    log_info "Ensuring PREROUTING redirect from port 80 to ${TOMCAT_PORT}..."
    
    local sudo_prefix=""
    if [[ "${REMOTE_MODE}" == true ]]; then
        sudo_prefix="sudo "
    fi
    
    if execute_cmd "${sudo_prefix}iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port ${TOMCAT_PORT}" 2>/dev/null; then
        log_info "PREROUTING redirect rule already exists"
    else
        execute_cmd "${sudo_prefix}iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port ${TOMCAT_PORT}"
        log_info "Added PREROUTING redirect rule: port 80 → ${TOMCAT_PORT}"
    fi
}

###############################################################
# REMOVE OUTPUT NAT RULE (BREAKS OUTBOUND TRAFFIC)
###############################################################
remove_output_rule() {
    log_info "Removing dangerous OUTPUT NAT redirect rule (if present)..."
    
    local sudo_prefix=""
    if [[ "${REMOTE_MODE}" == true ]]; then
        sudo_prefix="sudo "
    fi
    
    if execute_cmd "${sudo_prefix}iptables -t nat -C OUTPUT -p tcp --dport 80 -j REDIRECT --to-port ${TOMCAT_PORT}" 2>/dev/null; then
        execute_cmd "${sudo_prefix}iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port ${TOMCAT_PORT}"
        log_warn "Removed OUTPUT NAT redirect rule (this was breaking outbound traffic)"
    else
        log_info "OUTPUT NAT redirect rule not found (already removed or never existed)"
    fi
}

###############################################################
# SAVE IPTABLES RULES
###############################################################
save_iptables_rules() {
    log_info "Saving iptables rules..."
    
    local sudo_prefix=""
    if [[ "${REMOTE_MODE}" == true ]]; then
        sudo_prefix="sudo "
    fi
    
    if execute_cmd "test -f ${IPTABLES_SAVE_FILE}"; then
        if execute_cmd "${sudo_prefix}iptables-save > ${IPTABLES_SAVE_FILE}" 2>/dev/null; then
            log_info "Saved iptables rules to ${IPTABLES_SAVE_FILE}"
        elif execute_cmd "command -v service &> /dev/null && ${sudo_prefix}service iptables save" 2>/dev/null; then
            log_info "Saved iptables rules using service command"
        else
            log_warn "Could not save iptables rules automatically. Please run 'sudo iptables-save > ${IPTABLES_SAVE_FILE}' manually."
        fi
    else
        log_warn "iptables save file ${IPTABLES_SAVE_FILE} does not exist. Rules will be lost on reboot."
        log_info "Consider running: sudo iptables-save > ${IPTABLES_SAVE_FILE}"
    fi
}

###############################################################
# VERIFY TOMCAT CONNECTOR ADDRESS (OPTIONAL)
###############################################################
verify_tomcat_address() {
    local server_xml="${TOMCAT_HOME}/conf/server.xml"
    
    if [[ "${REMOTE_MODE}" == true ]]; then
        if ! execute_cmd "test -f ${server_xml}"; then
            log_warn "Tomcat server.xml not found at ${server_xml}. Skipping address verification."
            return 0
        fi
        
        log_info "Checking Tomcat Connector address configuration..."
        
        if execute_cmd "grep -q 'port=\"${TOMCAT_PORT}\"' ${server_xml}" 2>/dev/null; then
            if execute_cmd "grep -q 'port=\"${TOMCAT_PORT}\".*address=\"0.0.0.0\"' ${server_xml}" 2>/dev/null; then
                log_info "Tomcat Connector is configured to listen on 0.0.0.0:${TOMCAT_PORT}"
            else
                log_warn "Tomcat Connector may not be listening on 0.0.0.0"
                log_info "Please ensure server.xml has: <Connector port=\"${TOMCAT_PORT}\" address=\"0.0.0.0\" ... />"
            fi
        else
            log_warn "Could not find Connector with port ${TOMCAT_PORT} in server.xml"
        fi
    else
        if [[ ! -f "${server_xml}" ]]; then
            log_warn "Tomcat server.xml not found at ${server_xml}. Skipping address verification."
            return 0
        fi
        
        log_info "Checking Tomcat Connector address configuration..."
        
        if grep -q "port=\"${TOMCAT_PORT}\"" "${server_xml}" 2>/dev/null; then
            if grep -q "port=\"${TOMCAT_PORT}\".*address=\"0.0.0.0\"" "${server_xml}" 2>/dev/null; then
                log_info "Tomcat Connector is configured to listen on 0.0.0.0:${TOMCAT_PORT}"
            else
                log_warn "Tomcat Connector may not be listening on 0.0.0.0"
                log_info "Please ensure server.xml has: <Connector port=\"${TOMCAT_PORT}\" address=\"0.0.0.0\" ... />"
            fi
        else
            log_warn "Could not find Connector with port ${TOMCAT_PORT} in server.xml"
        fi
    fi
}

###############################################################
# MAIN EXECUTION
###############################################################
main() {
    log_info "Starting iptables fix script..."
    log_info "Tomcat port: ${TOMCAT_PORT}"
    log_info "Tomcat home: ${TOMCAT_HOME}"
    echo ""
    
    # Detect execution mode
    detect_execution_mode
    
    # Setup SSH if running remotely
    if [[ "${REMOTE_MODE}" == true ]]; then
        setup_ssh
        echo ""
    fi
    
    check_root
    check_iptables
    
    ensure_input_rule
    ensure_prerouting_rule
    remove_output_rule
    save_iptables_rules
    
    echo ""
    log_info "iptables rules have been fixed!"
    log_info "Current iptables rules:"
    echo ""
    
    local sudo_prefix=""
    if [[ "${REMOTE_MODE}" == true ]]; then
        sudo_prefix="sudo "
    fi
    
    if [[ "${REMOTE_MODE}" == true ]]; then
        execute_cmd "${sudo_prefix}iptables -L -n -v | head -20"
    else
        execute_cmd "${sudo_prefix}iptables -L -n -v" | head -20
    fi
    echo ""
    if [[ "${REMOTE_MODE}" == true ]]; then
        execute_cmd "${sudo_prefix}iptables -t nat -L -n -v | head -20"
    else
        execute_cmd "${sudo_prefix}iptables -t nat -L -n -v" | head -20
    fi
    
    echo ""
    verify_tomcat_address
    
    echo ""
    log_info "Fix complete!"
}

# Run main function
main "$@"

