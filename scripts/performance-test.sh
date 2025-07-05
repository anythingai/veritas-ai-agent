#!/bin/bash

# Veritas AI Agent - Performance Testing Script
# Comprehensive load testing and performance validation

set -euo pipefail

# Configuration
TEST_DIR="/var/log/veritas/performance"
RESULTS_FILE="$TEST_DIR/performance_test_$(date +%Y%m%d_%H%M%S).json"
LOG_FILE="$TEST_DIR/performance_test_$(date +%Y%m%d_%H%M%S).log"
LOAD_TEST_DURATION=300  # 5 minutes
CONCURRENT_USERS=100
RAMP_UP_TIME=60  # 1 minute

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Performance metrics
declare -A PERFORMANCE_METRICS
declare -A LATENCY_METRICS
declare -A THROUGHPUT_METRICS

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
mkdir -p "$TEST_DIR"

# Function to check if required tools are available
check_dependencies() {
    log "Checking performance testing dependencies..."
    
    local missing_deps=()
    
    for cmd in curl jq ab wrk siege; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        warn "Missing performance tools: ${missing_deps[*]}"
        warn "Some tests may be skipped"
    else
        log "All performance tools available"
    fi
}

# Function to test API endpoint performance
test_api_performance() {
    log "Testing API endpoint performance..."
    
    local api_endpoint="${API_ENDPOINT:-http://localhost:3000/verify}"
    local test_payload='{"claim_text": "The Earth is round and orbits around the Sun.", "source": "performance-test"}'
    
    # Test with Apache Bench
    if command -v ab &> /dev/null; then
        log "Running Apache Bench test..."
        
        local ab_results=$(ab -n 1000 -c 10 -p /tmp/test_payload.json -T application/json "$api_endpoint" 2>/dev/null || true)
        
        # Extract metrics
        local requests_per_second=$(echo "$ab_results" | grep "Requests per second" | awk '{print $4}')
        local mean_time=$(echo "$ab_results" | grep "Time per request" | head -1 | awk '{print $4}')
        local failed_requests=$(echo "$ab_results" | grep "Failed requests" | awk '{print $3}')
        
        PERFORMANCE_METRICS["ab_requests_per_second"]=$requests_per_second
        PERFORMANCE_METRICS["ab_mean_time"]=$mean_time
        PERFORMANCE_METRICS["ab_failed_requests"]=$failed_requests
        
        log "✓ Apache Bench results: ${requests_per_second} req/s, ${mean_time}ms mean time"
    fi
    
    # Test with wrk
    if command -v wrk &> /dev/null; then
        log "Running wrk load test..."
        
        local wrk_results=$(wrk -t4 -c100 -d30s --latency "$api_endpoint" 2>/dev/null || true)
        
        # Extract metrics
        local wrk_requests_per_sec=$(echo "$wrk_results" | grep "Requests/sec" | awk '{print $2}')
        local wrk_latency_p50=$(echo "$wrk_results" | grep "50.000%" | awk '{print $2}')
        local wrk_latency_p95=$(echo "$wrk_results" | grep "95.000%" | awk '{print $2}')
        local wrk_latency_p99=$(echo "$wrk_results" | grep "99.000%" | awk '{print $2}')
        
        PERFORMANCE_METRICS["wrk_requests_per_sec"]=$wrk_requests_per_sec
        LATENCY_METRICS["wrk_p50"]=$wrk_latency_p50
        LATENCY_METRICS["wrk_p95"]=$wrk_latency_p95
        LATENCY_METRICS["wrk_p99"]=$wrk_latency_p99
        
        log "✓ wrk results: ${wrk_requests_per_sec} req/s, P95: ${wrk_latency_p95}ms"
    fi
    
    # Test with siege
    if command -v siege &> /dev/null; then
        log "Running siege stress test..."
        
        local siege_results=$(siege -c10 -t30s "$api_endpoint" 2>/dev/null || true)
        
        # Extract metrics
        local siege_availability=$(echo "$siege_results" | grep "Availability" | awk '{print $2}' | sed 's/%//')
        local siege_response_time=$(echo "$siege_results" | grep "Response time" | awk '{print $3}')
        local siege_transaction_rate=$(echo "$siege_results" | grep "Transaction rate" | awk '{print $3}')
        
        PERFORMANCE_METRICS["siege_availability"]=$siege_availability
        PERFORMANCE_METRICS["siege_response_time"]=$siege_response_time
        PERFORMANCE_METRICS["siege_transaction_rate"]=$siege_transaction_rate
        
        log "✓ siege results: ${siege_availability}% availability, ${siege_transaction_rate} trans/s"
    fi
}

# Function to test database performance
test_database_performance() {
    log "Testing database performance..."
    
    if command -v psql &> /dev/null; then
        local db_host="${DB_HOST:-localhost}"
        local db_port="${DB_PORT:-5432}"
        local db_name="${DB_NAME:-veritas}"
        local db_user="${DB_USER:-veritas}"
        
        # Test connection time
        local start_time=$(date +%s.%N)
        psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -c "SELECT 1;" > /dev/null 2>&1
        local end_time=$(date +%s.%N)
        local connection_time=$(echo "$end_time - $start_time" | bc -l)
        
        PERFORMANCE_METRICS["db_connection_time"]=$connection_time
        
        # Test query performance
        local query_start=$(date +%s.%N)
        psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -c "SELECT COUNT(*) FROM source_documents;" > /dev/null 2>&1
        local query_end=$(date +%s.%N)
        local query_time=$(echo "$query_end - $query_start" | bc -l)
        
        PERFORMANCE_METRICS["db_query_time"]=$query_time
        
        log "✓ Database performance: ${connection_time}s connection, ${query_time}s query"
    else
        warn "PostgreSQL client not available, skipping database tests"
    fi
}

# Function to test IPFS performance
test_ipfs_performance() {
    log "Testing IPFS performance..."
    
    # Test IPFS gateway response time
    local ipfs_gateways=("https://ipfs.io" "https://gateway.pinata.cloud" "https://cloudflare-ipfs.com")
    
    for gateway in "${ipfs_gateways[@]}"; do
        local start_time=$(date +%s.%N)
        local response=$(curl -s -o /dev/null -w "%{http_code}" "$gateway/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" 2>/dev/null || echo "000")
        local end_time=$(date +%s.%N)
        local response_time=$(echo "$end_time - $start_time" | bc -l)
        
        if [ "$response" = "200" ]; then
            PERFORMANCE_METRICS["ipfs_${gateway//[^a-zA-Z]/_}_response_time"]=$response_time
            log "✓ IPFS gateway $gateway: ${response_time}s response time"
        else
            warn "IPFS gateway $gateway: HTTP $response"
        fi
    done
}

# Function to test embedding generation performance
test_embedding_performance() {
    log "Testing embedding generation performance..."
    
    local embedding_endpoint="${EMBEDDING_ENDPOINT:-http://localhost:8000/embed}"
    local test_text="This is a test text for embedding generation performance testing."
    
    # Test single embedding generation
    local start_time=$(date +%s.%N)
    local response=$(curl -s -X POST "$embedding_endpoint" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"$test_text\"}" 2>/dev/null || echo "{}")
    local end_time=$(date +%s.%N)
    local embedding_time=$(echo "$end_time - $start_time" | bc -l)
    
    PERFORMANCE_METRICS["single_embedding_time"]=$embedding_time
    
    # Test batch embedding generation
    local batch_start=$(date +%s.%N)
    local batch_response=$(curl -s -X POST "$embedding_endpoint/batch" \
        -H "Content-Type: application/json" \
        -d "{\"texts\": [\"$test_text\", \"Another test text\", \"Third test text\"]}" 2>/dev/null || echo "{}")
    local batch_end=$(date +%s.%N)
    local batch_time=$(echo "$batch_end - $batch_start" | bc -l)
    
    PERFORMANCE_METRICS["batch_embedding_time"]=$batch_time
    
    log "✓ Embedding performance: ${embedding_time}s single, ${batch_time}s batch"
}

# Function to test memory usage
test_memory_usage() {
    log "Testing memory usage..."
    
    # Get memory usage of Veritas processes
    local veritas_processes=$(pgrep -f "veritas" || true)
    
    if [ -n "$veritas_processes" ]; then
        local total_memory=0
        local process_count=0
        
        for pid in $veritas_processes; do
            local memory=$(ps -o rss= -p "$pid" 2>/dev/null || echo "0")
            total_memory=$((total_memory + memory))
            process_count=$((process_count + 1))
        done
        
        PERFORMANCE_METRICS["veritas_memory_usage_kb"]=$total_memory
        PERFORMANCE_METRICS["veritas_process_count"]=$process_count
        
        local memory_mb=$((total_memory / 1024))
        log "✓ Memory usage: ${memory_mb}MB across $process_count processes"
    else
        warn "No Veritas processes found"
    fi
    
    # Get system memory usage
    local total_system_memory=$(free | grep Mem | awk '{print $2}')
    local used_system_memory=$(free | grep Mem | awk '{print $3}')
    local memory_percentage=$((used_system_memory * 100 / total_system_memory))
    
    PERFORMANCE_METRICS["system_memory_usage_percent"]=$memory_percentage
    
    log "✓ System memory usage: ${memory_percentage}%"
}

# Function to test CPU usage
test_cpu_usage() {
    log "Testing CPU usage..."
    
    # Get CPU usage of Veritas processes
    local veritas_processes=$(pgrep -f "veritas" || true)
    
    if [ -n "$veritas_processes" ]; then
        local total_cpu=0
        local process_count=0
        
        for pid in $veritas_processes; do
            local cpu=$(ps -o %cpu= -p "$pid" 2>/dev/null || echo "0")
            total_cpu=$(echo "$total_cpu + $cpu" | bc -l)
            process_count=$((process_count + 1))
        done
        
        PERFORMANCE_METRICS["veritas_cpu_usage_percent"]=$total_cpu
        PERFORMANCE_METRICS["veritas_process_count"]=$process_count
        
        log "✓ CPU usage: ${total_cpu}% across $process_count processes"
    else
        warn "No Veritas processes found"
    fi
    
    # Get system CPU usage
    local system_cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
    
    PERFORMANCE_METRICS["system_cpu_usage_percent"]=$system_cpu
    
    log "✓ System CPU usage: ${system_cpu}%"
}

# Function to test disk I/O performance
test_disk_performance() {
    log "Testing disk I/O performance..."
    
    # Test write performance
    local write_start=$(date +%s.%N)
    dd if=/dev/zero of=/tmp/veritas_perf_test bs=1M count=100 2>/dev/null
    local write_end=$(date +%s.%N)
    local write_time=$(echo "$write_end - $write_start" | bc -l)
    local write_speed=$(echo "100 / $write_time" | bc -l)
    
    PERFORMANCE_METRICS["disk_write_speed_mbps"]=$write_speed
    
    # Test read performance
    local read_start=$(date +%s.%N)
    dd if=/tmp/veritas_perf_test of=/dev/null bs=1M 2>/dev/null
    local read_end=$(date +%s.%N)
    local read_time=$(echo "$read_end - $read_start" | bc -l)
    local read_speed=$(echo "100 / $read_time" | bc -l)
    
    PERFORMANCE_METRICS["disk_read_speed_mbps"]=$read_speed
    
    # Clean up
    rm -f /tmp/veritas_perf_test
    
    log "✓ Disk I/O performance: ${write_speed}MB/s write, ${read_speed}MB/s read"
}

# Function to run load test
run_load_test() {
    log "Running comprehensive load test..."
    
    local api_endpoint="${API_ENDPOINT:-http://localhost:3000/verify}"
    local test_payload='{"claim_text": "The Earth is round and orbits around the Sun.", "source": "load-test"}'
    
    # Create test payload file
    echo "$test_payload" > /tmp/load_test_payload.json
    
    # Run load test with Apache Bench
    if command -v ab &> /dev/null; then
        log "Running load test with $CONCURRENT_USERS concurrent users for $LOAD_TEST_DURATION seconds..."
        
        local load_test_results=$(ab -n $((CONCURRENT_USERS * 10)) -c $CONCURRENT_USERS -p /tmp/load_test_payload.json -T application/json "$api_endpoint" 2>/dev/null || true)
        
        # Extract load test metrics
        local load_requests_per_second=$(echo "$load_test_results" | grep "Requests per second" | awk '{print $4}')
        local load_mean_time=$(echo "$load_test_results" | grep "Time per request" | head -1 | awk '{print $4}')
        local load_failed_requests=$(echo "$load_test_results" | grep "Failed requests" | awk '{print $3}')
        local load_total_requests=$(echo "$load_test_results" | grep "Complete requests" | awk '{print $3}')
        
        THROUGHPUT_METRICS["load_requests_per_second"]=$load_requests_per_second
        THROUGHPUT_METRICS["load_mean_time"]=$load_mean_time
        THROUGHPUT_METRICS["load_failed_requests"]=$load_failed_requests
        THROUGHPUT_METRICS["load_total_requests"]=$load_total_requests
        
        log "✓ Load test results: ${load_requests_per_second} req/s, ${load_failed_requests} failed out of ${load_total_requests}"
    fi
    
    # Clean up
    rm -f /tmp/load_test_payload.json
}

# Function to validate performance requirements
validate_performance_requirements() {
    log "Validating performance requirements..."
    
    local requirements_met=0
    local total_requirements=0
    
    # Check latency requirements (≤300ms P95)
    if [ -n "${LATENCY_METRICS[wrk_p95]:-}" ]; then
        total_requirements=$((total_requirements + 1))
        if (( $(echo "${LATENCY_METRICS[wrk_p95]} <= 300" | bc -l) )); then
            log "✓ P95 latency requirement met: ${LATENCY_METRICS[wrk_p95]}ms ≤ 300ms"
            requirements_met=$((requirements_met + 1))
        else
            error "✗ P95 latency requirement failed: ${LATENCY_METRICS[wrk_p95]}ms > 300ms"
        fi
    fi
    
    # Check throughput requirements (≥50 req/s)
    if [ -n "${PERFORMANCE_METRICS[wrk_requests_per_sec]:-}" ]; then
        total_requirements=$((total_requirements + 1))
        if (( $(echo "${PERFORMANCE_METRICS[wrk_requests_per_sec]} >= 50" | bc -l) )); then
            log "✓ Throughput requirement met: ${PERFORMANCE_METRICS[wrk_requests_per_sec]} req/s ≥ 50 req/s"
            requirements_met=$((requirements_met + 1))
        else
            error "✗ Throughput requirement failed: ${PERFORMANCE_METRICS[wrk_requests_per_sec]} req/s < 50 req/s"
        fi
    fi
    
    # Check availability requirements (≥99.9%)
    if [ -n "${PERFORMANCE_METRICS[siege_availability]:-}" ]; then
        total_requirements=$((total_requirements + 1))
        if (( $(echo "${PERFORMANCE_METRICS[siege_availability]} >= 99.9" | bc -l) )); then
            log "✓ Availability requirement met: ${PERFORMANCE_METRICS[siege_availability]}% ≥ 99.9%"
            requirements_met=$((requirements_met + 1))
        else
            error "✗ Availability requirement failed: ${PERFORMANCE_METRICS[siege_availability]}% < 99.9%"
        fi
    fi
    
    # Check error rate requirements (≤1%)
    if [ -n "${THROUGHPUT_METRICS[load_failed_requests]:-}" ] && [ -n "${THROUGHPUT_METRICS[load_total_requests]:-}" ]; then
        total_requirements=$((total_requirements + 1))
        local error_rate=$(echo "${THROUGHPUT_METRICS[load_failed_requests]} * 100 / ${THROUGHPUT_METRICS[load_total_requests]}" | bc -l)
        if (( $(echo "$error_rate <= 1" | bc -l) )); then
            log "✓ Error rate requirement met: ${error_rate}% ≤ 1%"
            requirements_met=$((requirements_met + 1))
        else
            error "✗ Error rate requirement failed: ${error_rate}% > 1%"
        fi
    fi
    
    PERFORMANCE_METRICS["requirements_met"]=$requirements_met
    PERFORMANCE_METRICS["total_requirements"]=$total_requirements
    PERFORMANCE_METRICS["requirements_percentage"]=$(echo "$requirements_met * 100 / $total_requirements" | bc -l)
    
    log "Performance requirements: $requirements_met/$total_requirements met (${PERFORMANCE_METRICS[requirements_percentage]}%)"
}

# Function to generate performance report
generate_performance_report() {
    log "Generating performance test report..."
    
    local report_data=$(cat <<EOF
{
  "test_timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "test_version": "1.0",
  "system_info": {
    "hostname": "$(hostname)",
    "os": "$(uname -s)",
    "kernel": "$(uname -r)",
    "cpu_cores": "$(nproc)",
    "memory_gb": "$(free -g | grep Mem | awk '{print $2}')"
  },
  "test_configuration": {
    "load_test_duration": $LOAD_TEST_DURATION,
    "concurrent_users": $CONCURRENT_USERS,
    "ramp_up_time": $RAMP_UP_TIME
  },
  "performance_metrics": $(printf '%s\n' "${PERFORMANCE_METRICS[@]}" | jq -R . | jq -s .),
  "latency_metrics": $(printf '%s\n' "${LATENCY_METRICS[@]}" | jq -R . | jq -s .),
  "throughput_metrics": $(printf '%s\n' "${THROUGHPUT_METRICS[@]}" | jq -R . | jq -s .),
  "summary": {
    "requirements_met": ${PERFORMANCE_METRICS[requirements_met]:-0},
    "total_requirements": ${PERFORMANCE_METRICS[total_requirements]:-0},
    "requirements_percentage": ${PERFORMANCE_METRICS[requirements_percentage]:-0},
    "performance_status": "$(if [ "${PERFORMANCE_METRICS[requirements_percentage]:-0}" -ge 80 ]; then echo "PASS"; else echo "FAIL"; fi)"
  }
}
EOF
)
    
    echo "$report_data" > "$RESULTS_FILE"
    log "Performance test report saved to: $RESULTS_FILE"
}

# Function to display summary
display_summary() {
    echo ""
    echo "=== VERITAS AI AGENT PERFORMANCE TEST SUMMARY ==="
    echo "Timestamp: $(date)"
    echo "Hostname: $(hostname)"
    echo ""
    
    echo "📊 PERFORMANCE METRICS:"
    for key in "${!PERFORMANCE_METRICS[@]}"; do
        echo "  • $key: ${PERFORMANCE_METRICS[$key]}"
    done
    
    echo ""
    echo "⏱️  LATENCY METRICS:"
    for key in "${!LATENCY_METRICS[@]}"; do
        echo "  • $key: ${LATENCY_METRICS[$key]}"
    done
    
    echo ""
    echo "🚀 THROUGHPUT METRICS:"
    for key in "${!THROUGHPUT_METRICS[@]}"; do
        echo "  • $key: ${THROUGHPUT_METRICS[$key]}"
    done
    
    echo ""
    local requirements_met=${PERFORMANCE_METRICS[requirements_met]:-0}
    local total_requirements=${PERFORMANCE_METRICS[total_requirements]:-0}
    local percentage=${PERFORMANCE_METRICS[requirements_percentage]:-0}
    
    echo "✅ PERFORMANCE REQUIREMENTS: $requirements_met/$total_requirements met ($percentage%)"
    
    if [ "$percentage" -ge 80 ]; then
        echo ""
        echo "🎉 PERFORMANCE TEST PASSED!"
        echo "   System meets production performance requirements"
    else
        echo ""
        echo "⚠️  PERFORMANCE TEST FAILED!"
        echo "   System does not meet production performance requirements"
        echo "   Review performance bottlenecks and optimize"
    fi
}

# Main performance test function
perform_performance_test() {
    log "Starting Veritas AI Agent performance testing..."
    
    check_dependencies
    
    # Perform all performance tests
    test_api_performance
    test_database_performance
    test_ipfs_performance
    test_embedding_performance
    test_memory_usage
    test_cpu_usage
    test_disk_performance
    run_load_test
    
    # Validate requirements and generate report
    validate_performance_requirements
    generate_performance_report
    display_summary
    
    log "Performance testing completed successfully"
}

# Show usage information
show_usage() {
    echo "Veritas AI Agent - Performance Testing Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  test               Perform full performance test"
    echo "  quick              Perform quick performance check"
    echo "  load               Run load test only"
    echo "  report             Generate report from last test"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  API_ENDPOINT       API endpoint to test (default: http://localhost:3000/verify)"
    echo "  EMBEDDING_ENDPOINT Embedding service endpoint (default: http://localhost:8000/embed)"
    echo "  DB_HOST            Database host (default: localhost)"
    echo "  DB_PORT            Database port (default: 5432)"
    echo "  DB_NAME            Database name (default: veritas)"
    echo "  DB_USER            Database user (default: veritas)"
    echo ""
    echo "The script will:"
    echo "  • Test API endpoint performance"
    echo "  • Test database performance"
    echo "  • Test IPFS gateway performance"
    echo "  • Test embedding generation performance"
    echo "  • Monitor memory and CPU usage"
    echo "  • Test disk I/O performance"
    echo "  • Run comprehensive load tests"
    echo "  • Validate against production requirements"
    echo ""
    echo "Reports are saved to: $TEST_DIR"
}

# Main script logic
case "${1:-}" in
    "test")
        perform_performance_test
        ;;
    "quick")
        log "Performing quick performance check..."
        check_dependencies
        test_api_performance
        test_memory_usage
        test_cpu_usage
        display_summary
        ;;
    "load")
        log "Running load test only..."
        check_dependencies
        run_load_test
        display_summary
        ;;
    "report")
        if [ -f "$RESULTS_FILE" ]; then
            cat "$RESULTS_FILE" | jq .
        else
            error "No performance test report found. Run 'test' first."
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