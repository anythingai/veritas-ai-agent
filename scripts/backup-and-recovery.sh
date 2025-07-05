#!/bin/bash

# Veritas AI Agent - Backup and Disaster Recovery Script
# This script handles automated backups and recovery procedures

set -euo pipefail

# Configuration
BACKUP_DIR="/backups/veritas"
LOG_DIR="/var/log/veritas"
RETENTION_DAYS=30
DATE_FORMAT=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/backup_$DATE_FORMAT.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Create directories if they don't exist
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# Function to check if required tools are available
check_dependencies() {
    log "Checking dependencies..."
    
    local missing_deps=()
    
    for cmd in pg_dump psql curl jq; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        error "Missing dependencies: ${missing_deps[*]}"
        exit 1
    fi
    
    log "All dependencies available"
}

# Function to backup PostgreSQL database
backup_database() {
    log "Starting database backup..."
    
    local db_backup_file="$BACKUP_DIR/database_$DATE_FORMAT.sql"
    local db_backup_compressed="$db_backup_file.gz"
    
    # Database connection parameters
    local DB_HOST="${DB_HOST:-localhost}"
    local DB_PORT="${DB_PORT:-5432}"
    local DB_NAME="${DB_NAME:-veritas}"
    local DB_USER="${DB_USER:-veritas}"
    
    # Create database backup
    if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        --verbose --clean --create --if-exists > "$db_backup_file" 2>> "$LOG_FILE"; then
        log "Database backup created: $db_backup_file"
        
        # Compress backup
        if gzip "$db_backup_file"; then
            log "Database backup compressed: $db_backup_compressed"
            
            # Verify backup integrity
            if gunzip -t "$db_backup_compressed"; then
                log "Database backup integrity verified"
            else
                error "Database backup integrity check failed"
                return 1
            fi
        else
            error "Failed to compress database backup"
            return 1
        fi
    else
        error "Database backup failed"
        return 1
    fi
}

# Function to backup IPFS data
backup_ipfs_data() {
    log "Starting IPFS data backup..."
    
    local ipfs_backup_file="$BACKUP_DIR/ipfs_cids_$DATE_FORMAT.json"
    
    # Get list of pinned CIDs from IPFS
    if curl -s -X POST "http://localhost:5001/api/v0/pin/ls" \
        -H "Content-Type: application/json" \
        -d '{"type": "recursive"}' > "$ipfs_backup_file" 2>> "$LOG_FILE"; then
        log "IPFS CIDs backup created: $ipfs_backup_file"
        
        # Verify backup contains valid JSON
        if jq empty "$ipfs_backup_file" 2>/dev/null; then
            log "IPFS backup integrity verified"
        else
            error "IPFS backup integrity check failed"
            return 1
        fi
    else
        error "IPFS backup failed"
        return 1
    fi
}

# Function to backup configuration files
backup_config() {
    log "Starting configuration backup..."
    
    local config_backup_dir="$BACKUP_DIR/config_$DATE_FORMAT"
    mkdir -p "$config_backup_dir"
    
    # Backup important configuration files
    local config_files=(
        "/etc/veritas/config.yaml"
        "/etc/veritas/secrets.yaml"
        "/etc/nginx/nginx.conf"
        "/etc/systemd/system/veritas-*.service"
    )
    
    for config_file in "${config_files[@]}"; do
        if [ -f "$config_file" ]; then
            cp "$config_file" "$config_backup_dir/" 2>> "$LOG_FILE" || warn "Failed to backup $config_file"
        fi
    done
    
    # Create configuration manifest
    find "$config_backup_dir" -type f -exec sha256sum {} \; > "$config_backup_dir/manifest.txt"
    
    log "Configuration backup created: $config_backup_dir"
}

# Function to backup logs
backup_logs() {
    log "Starting logs backup..."
    
    local logs_backup_file="$BACKUP_DIR/logs_$DATE_FORMAT.tar.gz"
    
    # Backup recent logs (last 7 days)
    if find /var/log/veritas -name "*.log" -mtime -7 -exec tar -czf "$logs_backup_file" {} + 2>> "$LOG_FILE"; then
        log "Logs backup created: $logs_backup_file"
    else
        warn "Logs backup failed or no logs found"
    fi
}

# Function to verify backup integrity
verify_backups() {
    log "Verifying backup integrity..."
    
    local backup_files=(
        "$BACKUP_DIR/database_$DATE_FORMAT.sql.gz"
        "$BACKUP_DIR/ipfs_cids_$DATE_FORMAT.json"
        "$BACKUP_DIR/config_$DATE_FORMAT"
    )
    
    for backup_file in "${backup_files[@]}"; do
        if [ -f "$backup_file" ] || [ -d "$backup_file" ]; then
            log "✓ Backup verified: $backup_file"
        else
            error "✗ Backup missing: $backup_file"
            return 1
        fi
    done
    
    log "All backups verified successfully"
}

# Function to clean old backups
cleanup_old_backups() {
    log "Cleaning up old backups (older than $RETENTION_DAYS days)..."
    
    local deleted_count=0
    
    # Remove old database backups
    find "$BACKUP_DIR" -name "database_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    deleted_count=$((deleted_count + $(find "$BACKUP_DIR" -name "database_*.sql.gz" -mtime +$RETENTION_DAYS | wc -l)))
    
    # Remove old IPFS backups
    find "$BACKUP_DIR" -name "ipfs_cids_*.json" -mtime +$RETENTION_DAYS -delete
    deleted_count=$((deleted_count + $(find "$BACKUP_DIR" -name "ipfs_cids_*.json" -mtime +$RETENTION_DAYS | wc -l)))
    
    # Remove old config backups
    find "$BACKUP_DIR" -name "config_*" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} +
    deleted_count=$((deleted_count + $(find "$BACKUP_DIR" -name "config_*" -type d -mtime +$RETENTION_DAYS | wc -l)))
    
    # Remove old log backups
    find "$BACKUP_DIR" -name "logs_*.tar.gz" -mtime +$RETENTION_DAYS -delete
    deleted_count=$((deleted_count + $(find "$BACKUP_DIR" -name "logs_*.tar.gz" -mtime +$RETENTION_DAYS | wc -l)))
    
    log "Cleaned up $deleted_count old backup files"
}

# Function to restore database from backup
restore_database() {
    local backup_file="$1"
    
    if [ ! -f "$backup_file" ]; then
        error "Backup file not found: $backup_file"
        return 1
    fi
    
    log "Starting database restore from: $backup_file"
    
    # Database connection parameters
    local DB_HOST="${DB_HOST:-localhost}"
    local DB_PORT="${DB_PORT:-5432}"
    local DB_NAME="${DB_NAME:-veritas}"
    local DB_USER="${DB_USER:-veritas}"
    
    # Stop services that might be using the database
    log "Stopping Veritas services..."
    systemctl stop veritas-backend veritas-data-pipeline 2>/dev/null || true
    
    # Restore database
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -c "$backup_file" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" 2>> "$LOG_FILE"
    else
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$backup_file" 2>> "$LOG_FILE"
    fi
    
    if [ $? -eq 0 ]; then
        log "Database restore completed successfully"
        
        # Restart services
        log "Restarting Veritas services..."
        systemctl start veritas-backend veritas-data-pipeline 2>/dev/null || true
    else
        error "Database restore failed"
        return 1
    fi
}

# Function to restore IPFS data
restore_ipfs_data() {
    local backup_file="$1"
    
    if [ ! -f "$backup_file" ]; then
        error "IPFS backup file not found: $backup_file"
        return 1
    fi
    
    log "Starting IPFS data restore from: $backup_file"
    
    # Parse CIDs from backup and pin them
    local cid_count=0
    
    while IFS= read -r cid; do
        if curl -s -X POST "http://localhost:5001/api/v0/pin/add" \
            -H "Content-Type: application/json" \
            -d "{\"arg\": \"$cid\"}" > /dev/null 2>> "$LOG_FILE"; then
            cid_count=$((cid_count + 1))
        else
            warn "Failed to pin CID: $cid"
        fi
    done < <(jq -r '.Keys[].Hash' "$backup_file" 2>/dev/null)
    
    log "IPFS restore completed: $cid_count CIDs pinned"
}

# Function to test backup restore
test_restore() {
    log "Testing backup restore functionality..."
    
    # Find the most recent backup
    local latest_db_backup=$(find "$BACKUP_DIR" -name "database_*.sql.gz" -type f | sort | tail -n 1)
    local latest_ipfs_backup=$(find "$BACKUP_DIR" -name "ipfs_cids_*.json" -type f | sort | tail -n 1)
    
    if [ -n "$latest_db_backup" ]; then
        log "Testing database restore with: $latest_db_backup"
        # Create a test database for restore testing
        createdb -h localhost -U veritas veritas_test_restore 2>/dev/null || true
        gunzip -c "$latest_db_backup" | psql -h localhost -U veritas -d veritas_test_restore > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            log "✓ Database restore test successful"
            dropdb -h localhost -U veritas veritas_test_restore 2>/dev/null || true
        else
            error "✗ Database restore test failed"
        fi
    fi
    
    if [ -n "$latest_ipfs_backup" ]; then
        log "Testing IPFS backup integrity: $latest_ipfs_backup"
        if jq empty "$latest_ipfs_backup" 2>/dev/null; then
            log "✓ IPFS backup integrity test successful"
        else
            error "✗ IPFS backup integrity test failed"
        fi
    fi
}

# Main backup function
perform_backup() {
    log "Starting Veritas AI Agent backup process..."
    
    check_dependencies
    
    # Perform all backup operations
    backup_database
    backup_ipfs_data
    backup_config
    backup_logs
    
    # Verify backups
    verify_backups
    
    # Clean up old backups
    cleanup_old_backups
    
    # Test restore functionality
    test_restore
    
    log "Backup process completed successfully"
}

# Main restore function
perform_restore() {
    local db_backup="$1"
    local ipfs_backup="$2"
    
    log "Starting Veritas AI Agent restore process..."
    
    check_dependencies
    
    if [ -n "$db_backup" ]; then
        restore_database "$db_backup"
    fi
    
    if [ -n "$ipfs_backup" ]; then
        restore_ipfs_data "$ipfs_backup"
    fi
    
    log "Restore process completed successfully"
}

# Show usage information
show_usage() {
    echo "Veritas AI Agent - Backup and Disaster Recovery Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  backup              Perform full backup"
    echo "  restore <db_file> [ipfs_file]  Restore from backup files"
    echo "  test                Test backup restore functionality"
    echo "  cleanup             Clean up old backups"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  DB_HOST             Database host (default: localhost)"
    echo "  DB_PORT             Database port (default: 5432)"
    echo "  DB_NAME             Database name (default: veritas)"
    echo "  DB_USER             Database user (default: veritas)"
    echo "  BACKUP_DIR          Backup directory (default: /backups/veritas)"
    echo "  RETENTION_DAYS      Days to keep backups (default: 30)"
}

# Main script logic
case "${1:-}" in
    "backup")
        perform_backup
        ;;
    "restore")
        if [ -z "${2:-}" ]; then
            error "Database backup file required for restore"
            show_usage
            exit 1
        fi
        perform_restore "$2" "${3:-}"
        ;;
    "test")
        test_restore
        ;;
    "cleanup")
        cleanup_old_backups
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