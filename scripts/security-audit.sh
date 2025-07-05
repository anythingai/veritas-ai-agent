#!/bin/bash

# Veritas AI Agent - Security Audit Script
# Comprehensive security assessment for production readiness

set -euo pipefail

# Configuration
AUDIT_DIR="/var/log/veritas/security"
REPORT_FILE="$AUDIT_DIR/security_audit_$(date +%Y%m%d_%H%M%S).json"
LOG_FILE="$AUDIT_DIR/security_audit_$(date +%Y%m%d_%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Initialize audit results
declare -A AUDIT_RESULTS
declare -A VULNERABILITIES
declare -A RECOMMENDATIONS

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}" | tee -a "$LOG_FILE"
}

# Create directories if they don't exist
mkdir -p "$AUDIT_DIR"

# Function to check if required tools are available
check_dependencies() {
    log "Checking security audit dependencies..."
    
    local missing_deps=()
    
    for cmd in nmap curl openssl jq ss netstat; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        warn "Missing security tools: ${missing_deps[*]}"
        warn "Some security checks may be skipped"
    else
        log "All security tools available"
    fi
}

# Function to audit network security
audit_network_security() {
    log "Auditing network security..."
    
    # Check open ports
    local open_ports=$(ss -tuln | grep LISTEN | wc -l)
    AUDIT_RESULTS["open_ports"]=$open_ports
    
    if [ "$open_ports" -gt 10 ]; then
        VULNERABILITIES["network"]="Too many open ports detected: $open_ports"
        RECOMMENDATIONS["network"]="Review and close unnecessary ports"
    else
        log "✓ Network port count acceptable: $open_ports"
    fi
    
    # Check for common vulnerable ports
    local vulnerable_ports=("22" "21" "23" "25" "53" "80" "443" "3306" "5432" "6379" "27017")
    local found_vulnerable=()
    
    for port in "${vulnerable_ports[@]}"; do
        if ss -tuln | grep ":$port " > /dev/null; then
            found_vulnerable+=("$port")
        fi
    done
    
    if [ ${#found_vulnerable[@]} -gt 0 ]; then
        warn "Potentially vulnerable ports open: ${found_vulnerable[*]}"
        RECOMMENDATIONS["network_ports"]="Ensure proper security for ports: ${found_vulnerable[*]}"
    fi
    
    # Check firewall status
    if command -v ufw &> /dev/null; then
        if ufw status | grep -q "Status: active"; then
            log "✓ UFW firewall is active"
            AUDIT_RESULTS["firewall_status"]="active"
        else
            VULNERABILITIES["firewall"]="UFW firewall is not active"
            RECOMMENDATIONS["firewall"]="Enable UFW firewall"
        fi
    elif command -v iptables &> /dev/null; then
        local iptables_rules=$(iptables -L | wc -l)
        if [ "$iptables_rules" -gt 10 ]; then
            log "✓ iptables firewall has rules configured"
            AUDIT_RESULTS["firewall_status"]="configured"
        else
            warn "iptables firewall may not be properly configured"
            RECOMMENDATIONS["firewall"]="Review iptables configuration"
        fi
    else
        warn "No firewall detected"
        RECOMMENDATIONS["firewall"]="Install and configure a firewall"
    fi
}

# Function to audit SSL/TLS configuration
audit_ssl_tls() {
    log "Auditing SSL/TLS configuration..."
    
    # Check for HTTPS endpoints
    local https_endpoints=("api.veritas.ai" "localhost:3000" "localhost:8080")
    
    for endpoint in "${https_endpoints[@]}"; do
        if curl -s -I "https://$endpoint" > /dev/null 2>&1; then
            # Check SSL certificate
            local cert_info=$(echo | openssl s_client -connect "$endpoint:443" -servername "$endpoint" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || true)
            
            if [ -n "$cert_info" ]; then
                log "✓ SSL certificate found for $endpoint"
                AUDIT_RESULTS["ssl_$endpoint"]="valid"
            else
                warn "SSL certificate issues for $endpoint"
                VULNERABILITIES["ssl_$endpoint"]="SSL certificate problems"
            fi
        fi
    done
    
    # Check for weak SSL/TLS protocols
    local weak_protocols=("SSLv2" "SSLv3" "TLSv1.0" "TLSv1.1")
    
    for protocol in "${weak_protocols[@]}"; do
        if openssl s_client -connect "api.veritas.ai:443" -"$protocol" < /dev/null 2>&1 | grep -q "Connected"; then
            VULNERABILITIES["ssl_protocols"]="Weak protocol $protocol is enabled"
            RECOMMENDATIONS["ssl_protocols"]="Disable weak SSL/TLS protocols"
        fi
    done
}

# Function to audit file permissions
audit_file_permissions() {
    log "Auditing file permissions..."
    
    # Check for world-writable files
    local world_writable=$(find /etc/veritas /var/log/veritas /opt/veritas -type f -perm -002 2>/dev/null | wc -l)
    AUDIT_RESULTS["world_writable_files"]=$world_writable
    
    if [ "$world_writable" -gt 0 ]; then
        VULNERABILITIES["file_permissions"]="Found $world_writable world-writable files"
        RECOMMENDATIONS["file_permissions"]="Remove world-write permissions from sensitive files"
    else
        log "✓ No world-writable files found"
    fi
    
    # Check for files with excessive permissions
    local excessive_perms=$(find /etc/veritas /var/log/veritas /opt/veritas -type f -perm -777 2>/dev/null | wc -l)
    
    if [ "$excessive_perms" -gt 0 ]; then
        VULNERABILITIES["excessive_permissions"]="Found $excessive_perms files with excessive permissions"
        RECOMMENDATIONS["excessive_permissions"]="Review and fix file permissions"
    fi
    
    # Check for sensitive files
    local sensitive_files=(
        "/etc/veritas/secrets.yaml"
        "/etc/veritas/config.yaml"
        "/var/log/veritas/*.log"
    )
    
    for file in "${sensitive_files[@]}"; do
        if [ -f "$file" ]; then
            local perms=$(stat -c %a "$file")
            if [ "$perms" = "600" ] || [ "$perms" = "640" ]; then
                log "✓ Proper permissions on $file: $perms"
            else
                warn "Insecure permissions on $file: $perms"
                RECOMMENDATIONS["sensitive_files"]="Set proper permissions on sensitive files"
            fi
        fi
    done
}

# Function to audit user security
audit_user_security() {
    log "Auditing user security..."
    
    # Check for users with UID 0 (root)
    local root_users=$(awk -F: '$3 == 0 {print $1}' /etc/passwd | wc -l)
    AUDIT_RESULTS["root_users"]=$root_users
    
    if [ "$root_users" -gt 1 ]; then
        VULNERABILITIES["root_users"]="Multiple users with UID 0"
        RECOMMENDATIONS["root_users"]="Review users with root privileges"
    else
        log "✓ Only one root user found"
    fi
    
    # Check for users without passwords
    local no_password=$(awk -F: '$2 == "" {print $1}' /etc/shadow 2>/dev/null | wc -l)
    
    if [ "$no_password" -gt 0 ]; then
        VULNERABILITIES["no_password"]="Found $no_password users without passwords"
        RECOMMENDATIONS["no_password"]="Set passwords for all users"
    else
        log "✓ All users have passwords"
    fi
    
    # Check for expired passwords
    local expired_passwords=$(awk -F: '$5 != "" && $5 < '$(date +%s)' {print $1}' /etc/shadow 2>/dev/null | wc -l)
    
    if [ "$expired_passwords" -gt 0 ]; then
        warn "Found $expired_passwords users with expired passwords"
        RECOMMENDATIONS["expired_passwords"]="Update expired passwords"
    fi
}

# Function to audit service security
audit_service_security() {
    log "Auditing service security..."
    
    # Check for running services
    local services=("veritas-backend" "veritas-data-pipeline" "postgresql" "redis" "nginx")
    
    for service in "${services[@]}"; do
        if systemctl is-active --quiet "$service"; then
            log "✓ Service $service is running"
            AUDIT_RESULTS["service_$service"]="running"
        else
            warn "Service $service is not running"
            AUDIT_RESULTS["service_$service"]="stopped"
        fi
    done
    
    # Check for unnecessary services
    local unnecessary_services=("telnet" "rsh" "rlogin" "rexec" "tftp")
    
    for service in "${unnecessary_services[@]}"; do
        if systemctl is-enabled --quiet "$service" 2>/dev/null; then
            VULNERABILITIES["unnecessary_services"]="Unnecessary service $service is enabled"
            RECOMMENDATIONS["unnecessary_services"]="Disable unnecessary services"
        fi
    done
}

# Function to audit database security
audit_database_security() {
    log "Auditing database security..."
    
    # Check PostgreSQL configuration
    if command -v psql &> /dev/null; then
        # Check if PostgreSQL is listening on localhost only
        local pg_listen=$(ss -tuln | grep ":5432 " | wc -l)
        
        if [ "$pg_listen" -gt 0 ]; then
            log "✓ PostgreSQL is listening on port 5432"
            
            # Check if it's bound to localhost only
            if ss -tuln | grep ":5432 " | grep -q "127.0.0.1"; then
                log "✓ PostgreSQL bound to localhost only"
                AUDIT_RESULTS["postgres_binding"]="secure"
            else
                VULNERABILITIES["postgres_binding"]="PostgreSQL may be accessible from external networks"
                RECOMMENDATIONS["postgres_binding"]="Bind PostgreSQL to localhost only"
            fi
        fi
    fi
    
    # Check Redis configuration
    if command -v redis-cli &> /dev/null; then
        local redis_listen=$(ss -tuln | grep ":6379 " | wc -l)
        
        if [ "$redis_listen" -gt 0 ]; then
            log "✓ Redis is listening on port 6379"
            
            if ss -tuln | grep ":6379 " | grep -q "127.0.0.1"; then
                log "✓ Redis bound to localhost only"
                AUDIT_RESULTS["redis_binding"]="secure"
            else
                VULNERABILITIES["redis_binding"]="Redis may be accessible from external networks"
                RECOMMENDATIONS["redis_binding"]="Bind Redis to localhost only"
            fi
        fi
    fi
}

# Function to audit application security
audit_application_security() {
    log "Auditing application security..."
    
    # Check for environment variables
    local env_file="/etc/veritas/.env"
    if [ -f "$env_file" ]; then
        # Check for hardcoded secrets
        if grep -q "password\|secret\|key\|token" "$env_file"; then
            warn "Potential secrets found in environment file"
            RECOMMENDATIONS["env_secrets"]="Review environment file for hardcoded secrets"
        fi
        
        # Check file permissions
        local env_perms=$(stat -c %a "$env_file")
        if [ "$env_perms" != "600" ]; then
            VULNERABILITIES["env_permissions"]="Environment file has insecure permissions: $env_perms"
            RECOMMENDATIONS["env_permissions"]="Set environment file permissions to 600"
        fi
    fi
    
    # Check for log files with sensitive information
    local log_files=("/var/log/veritas/*.log")
    for log_file in $log_files; do
        if [ -f "$log_file" ]; then
            if grep -q "password\|secret\|key\|token" "$log_file" 2>/dev/null; then
                VULNERABILITIES["log_secrets"]="Sensitive information found in log files"
                RECOMMENDATIONS["log_secrets"]="Review and clean log files"
            fi
        fi
    done
    
    # Check for running processes
    local veritas_processes=$(pgrep -f "veritas" | wc -l)
    AUDIT_RESULTS["veritas_processes"]=$veritas_processes
    
    if [ "$veritas_processes" -eq 0 ]; then
        warn "No Veritas processes found running"
    else
        log "✓ Found $veritas_processes Veritas processes running"
    fi
}

# Function to audit dependency security
audit_dependency_security() {
    log "Auditing dependency security..."
    
    # Check for known vulnerabilities in Node.js dependencies
    if [ -f "package.json" ]; then
        if command -v npm &> /dev/null; then
            log "Checking Node.js dependencies for vulnerabilities..."
            if npm audit --audit-level=moderate 2>/dev/null | grep -q "found"; then
                VULNERABILITIES["npm_vulnerabilities"]="NPM audit found vulnerabilities"
                RECOMMENDATIONS["npm_vulnerabilities"]="Run 'npm audit fix' to resolve vulnerabilities"
            else
                log "✓ No critical NPM vulnerabilities found"
            fi
        fi
    fi
    
    # Check for known vulnerabilities in Python dependencies
    if [ -f "pyproject.toml" ]; then
        if command -v safety &> /dev/null; then
            log "Checking Python dependencies for vulnerabilities..."
            if safety check 2>/dev/null | grep -q "VULNERABILITY"; then
                VULNERABILITIES["python_vulnerabilities"]="Safety check found vulnerabilities"
                RECOMMENDATIONS["python_vulnerabilities"]="Update vulnerable Python packages"
            else
                log "✓ No critical Python vulnerabilities found"
            fi
        fi
    fi
}

# Function to generate security report
generate_report() {
    log "Generating security audit report..."
    
    local report_data=$(cat <<EOF
{
  "audit_timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "audit_version": "1.0",
  "system_info": {
    "hostname": "$(hostname)",
    "os": "$(uname -s)",
    "kernel": "$(uname -r)"
  },
  "audit_results": $(printf '%s\n' "${AUDIT_RESULTS[@]}" | jq -R . | jq -s .),
  "vulnerabilities": $(printf '%s\n' "${VULNERABILITIES[@]}" | jq -R . | jq -s .),
  "recommendations": $(printf '%s\n' "${RECOMMENDATIONS[@]}" | jq -R . | jq -s .),
  "summary": {
    "total_vulnerabilities": ${#VULNERABILITIES[@]},
    "total_recommendations": ${#RECOMMENDATIONS[@]},
    "risk_level": "$(if [ ${#VULNERABILITIES[@]} -gt 5 ]; then echo "HIGH"; elif [ ${#VULNERABILITIES[@]} -gt 2 ]; then echo "MEDIUM"; else echo "LOW"; fi)"
  }
}
EOF
)
    
    echo "$report_data" > "$REPORT_FILE"
    log "Security audit report saved to: $REPORT_FILE"
}

# Function to display summary
display_summary() {
    echo ""
    echo "=== VERITAS AI AGENT SECURITY AUDIT SUMMARY ==="
    echo "Timestamp: $(date)"
    echo "Hostname: $(hostname)"
    echo ""
    
    echo "📊 AUDIT RESULTS:"
    for key in "${!AUDIT_RESULTS[@]}"; do
        echo "  • $key: ${AUDIT_RESULTS[$key]}"
    done
    
    echo ""
    echo "🚨 VULNERABILITIES FOUND: ${#VULNERABILITIES[@]}"
    for key in "${!VULNERABILITIES[@]}"; do
        echo "  • $key: ${VULNERABILITIES[$key]}"
    done
    
    echo ""
    echo "💡 RECOMMENDATIONS: ${#RECOMMENDATIONS[@]}"
    for key in "${!RECOMMENDATIONS[@]}"; do
        echo "  • $key: ${RECOMMENDATIONS[$key]}"
    done
    
    echo ""
    local risk_level="LOW"
    if [ ${#VULNERABILITIES[@]} -gt 5 ]; then
        risk_level="HIGH"
    elif [ ${#VULNERABILITIES[@]} -gt 2 ]; then
        risk_level="MEDIUM"
    fi
    
    echo "⚠️  OVERALL RISK LEVEL: $risk_level"
    
    if [ ${#VULNERABILITIES[@]} -gt 0 ]; then
        echo ""
        echo "🔧 IMMEDIATE ACTIONS REQUIRED:"
        echo "  1. Review all vulnerabilities listed above"
        echo "  2. Implement security recommendations"
        echo "  3. Re-run security audit after fixes"
        echo "  4. Consider penetration testing"
    else
        echo ""
        echo "✅ No critical vulnerabilities found!"
        echo "   Continue with regular security monitoring"
    fi
}

# Main audit function
perform_security_audit() {
    log "Starting Veritas AI Agent security audit..."
    
    check_dependencies
    
    # Perform all security audits
    audit_network_security
    audit_ssl_tls
    audit_file_permissions
    audit_user_security
    audit_service_security
    audit_database_security
    audit_application_security
    audit_dependency_security
    
    # Generate report and display summary
    generate_report
    display_summary
    
    log "Security audit completed successfully"
}

# Show usage information
show_usage() {
    echo "Veritas AI Agent - Security Audit Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  audit              Perform full security audit"
    echo "  quick              Perform quick security check"
    echo "  report             Generate report from last audit"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "The script will:"
    echo "  • Audit network security and open ports"
    echo "  • Check SSL/TLS configuration"
    echo "  • Review file permissions"
    echo "  • Audit user security"
    echo "  • Check service configurations"
    echo "  • Audit database security"
    echo "  • Review application security"
    echo "  • Check for dependency vulnerabilities"
    echo ""
    echo "Reports are saved to: $AUDIT_DIR"
}

# Main script logic
case "${1:-}" in
    "audit")
        perform_security_audit
        ;;
    "quick")
        log "Performing quick security check..."
        check_dependencies
        audit_network_security
        audit_service_security
        display_summary
        ;;
    "report")
        if [ -f "$REPORT_FILE" ]; then
            cat "$REPORT_FILE" | jq .
        else
            error "No audit report found. Run 'audit' first."
        fi
        ;;
    "-h"|"--help"|"")
        show_usage
        ;;
    *)
        error "Unknown option: $1"
        show_usage
        exit 1
        ;;
esac 