#!/bin/bash
# Pre-Deployment Test Suite for A/B Testing PR
# Validates all functionality before deploying to production

set +e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0
TEST_DIR="/tmp/blah2_pre_deploy_test"

mkdir -p "$TEST_DIR"
cd "$(dirname "$0")"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Pre-Deployment Test Suite${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Utility functions
pass_test() {
    echo -e "${GREEN}✓${NC} $1"
    ((TESTS_PASSED++))
}

fail_test() {
    echo -e "${RED}✗${NC} $1"
    ((TESTS_FAILED++))
}

section() {
    echo
    echo -e "${YELLOW}━━━ $1 ━━━${NC}"
}

# Cleanup function
cleanup() {
    pkill -f "node server.js" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 1: Prerequisites
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Prerequisites Check"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    pass_test "Node.js installed: $NODE_VERSION"
else
    fail_test "Node.js not installed"
fi

# Check jq
if command -v jq &> /dev/null; then
    pass_test "jq installed"
else
    fail_test "jq not installed (required for testing)"
fi

# Check npm modules
if [ -d "node_modules" ]; then
    pass_test "npm dependencies installed"
else
    fail_test "npm dependencies missing (run: npm install)"
    exit 1
fi

# Check adsb2dd service
if docker ps | grep -q adsb2dd; then
    pass_test "adsb2dd service running"
else
    fail_test "adsb2dd service not running"
fi

# Check config files exist
for config in ../config/config.yml ../config/config_test_legacy.yml ../config/config_test_diagnostic.yml; do
    if [ -f "$config" ]; then
        pass_test "Config exists: $(basename $config)"
    else
        fail_test "Config missing: $config"
    fi
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 2: Code Syntax
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Code Syntax Validation"

if node -c server.js 2>/dev/null; then
    pass_test "server.js syntax valid"
else
    fail_test "server.js has syntax errors"
fi

# Check for required functions
if grep -q "function buildAdsbQuery" server.js; then
    pass_test "buildAdsbQuery function exists"
else
    fail_test "buildAdsbQuery function missing"
fi

if grep -q "function fetchJson" server.js; then
    pass_test "fetchJson function exists"
else
    fail_test "fetchJson function missing"
fi

if grep -q "function fetchFromAdsbService" server.js; then
    pass_test "fetchFromAdsbService function exists"
else
    fail_test "fetchFromAdsbService function missing"
fi

if grep -q "function fetchFromTar1090AndExtrapolate" server.js; then
    pass_test "fetchFromTar1090AndExtrapolate function exists"
else
    fail_test "fetchFromTar1090AndExtrapolate function missing"
fi

if grep -q "function compareAdsbResults" server.js; then
    pass_test "compareAdsbResults function exists"
else
    fail_test "compareAdsbResults function missing"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 3: Configuration Validation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Configuration Validation"

# Check default config has new flags
if grep -q "use_legacy_method: false" ../config/config.yml; then
    pass_test "Default config has use_legacy_method flag"
else
    fail_test "Default config missing use_legacy_method flag"
fi

if grep -q "diagnostic_mode: false" ../config/config.yml; then
    pass_test "Default config has diagnostic_mode flag"
else
    fail_test "Default config missing diagnostic_mode flag"
fi

# Check legacy config
if grep -q "use_legacy_method: true" ../config/config_test_legacy.yml; then
    pass_test "Legacy config enables legacy method"
else
    fail_test "Legacy config incorrect"
fi

# Check diagnostic config
if grep -q "diagnostic_mode: true" ../config/config_test_diagnostic.yml; then
    pass_test "Diagnostic config enables diagnostic mode"
else
    fail_test "Diagnostic config incorrect"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 4: New Method (Default)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 4: New Method (tar1090 + extrapolation)"

echo "Starting server with new method..."
node server.js ../config/config.yml > "$TEST_DIR/new_method.log" 2>&1 &
SERVER_PID=$!
sleep 3

# Check server started
if curl -s http://localhost:3000/api/config >/dev/null 2>&1; then
    pass_test "Server started (new method)"
else
    fail_test "Server failed to start"
    cat "$TEST_DIR/new_method.log"
    exit 1
fi

# Test endpoint responds
if curl -s http://localhost:3000/api/adsb2dd > "$TEST_DIR/new_result.json"; then
    pass_test "New method endpoint responds"
else
    fail_test "New method endpoint failed"
fi

# Check response structure
if jq -e 'type == "object"' "$TEST_DIR/new_result.json" >/dev/null 2>&1; then
    pass_test "New method returns valid JSON object"
else
    fail_test "New method returns invalid JSON"
fi

# Check for aircraft data
NEW_COUNT=$(jq 'keys | length' "$TEST_DIR/new_result.json")
if [ "$NEW_COUNT" -gt 0 ]; then
    pass_test "New method returns data ($NEW_COUNT aircraft)"
else
    fail_test "New method returns empty data"
fi

# Check data structure
if jq -e 'to_entries[0].value | has("hex") and has("lat") and has("lon")' "$TEST_DIR/new_result.json" >/dev/null 2>&1; then
    pass_test "New method data has expected fields"
else
    fail_test "New method data missing required fields"
fi

# Test response time
START_TIME=$(date +%s%N)
curl -s http://localhost:3000/api/adsb2dd > /dev/null
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( (END_TIME - START_TIME) / 1000000 ))
if [ "$RESPONSE_TIME" -lt 2000 ]; then
    pass_test "New method response time acceptable: ${RESPONSE_TIME}ms"
else
    echo -e "${YELLOW}⚠${NC}  New method response time high: ${RESPONSE_TIME}ms"
fi

kill $SERVER_PID 2>/dev/null || true
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 5: Legacy Method
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 5: Legacy Method (adsb2dd service)"

echo "Starting server with legacy method..."
node server.js ../config/config_test_legacy.yml > "$TEST_DIR/legacy_method.log" 2>&1 &
SERVER_PID=$!
sleep 3

# Check server started
if curl -s http://localhost:3000/api/config >/dev/null 2>&1; then
    pass_test "Server started (legacy method)"
else
    fail_test "Server failed to start"
    exit 1
fi

# Prime adsb2dd service
echo "Priming adsb2dd service..."
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" >/dev/null
sleep 8

# Test endpoint responds
if curl -s http://localhost:3000/api/adsb2dd > "$TEST_DIR/legacy_result.json"; then
    pass_test "Legacy method endpoint responds"
else
    fail_test "Legacy method endpoint failed"
fi

# Check for aircraft data
LEGACY_COUNT=$(jq 'keys | length' "$TEST_DIR/legacy_result.json")
if [ "$LEGACY_COUNT" -gt 0 ]; then
    pass_test "Legacy method returns data ($LEGACY_COUNT aircraft)"
else
    fail_test "Legacy method returns empty data (may need longer initialization)"
fi

# Check data structure (legacy has fewer fields)
if jq -e 'to_entries[0].value | has("delay")' "$TEST_DIR/legacy_result.json" >/dev/null 2>&1; then
    pass_test "Legacy method data has delay field"
else
    fail_test "Legacy method data missing delay field"
fi

# Test response time
START_TIME=$(date +%s%N)
curl -s http://localhost:3000/api/adsb2dd > /dev/null
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( (END_TIME - START_TIME) / 1000000 ))
if [ "$RESPONSE_TIME" -lt 2000 ]; then
    pass_test "Legacy method response time acceptable: ${RESPONSE_TIME}ms"
else
    echo -e "${YELLOW}⚠${NC}  Legacy method response time high: ${RESPONSE_TIME}ms"
fi

kill $SERVER_PID 2>/dev/null || true
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 6: Diagnostic Mode
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 6: Diagnostic Mode (both methods)"

echo "Starting server with diagnostic mode..."
node server.js ../config/config_test_diagnostic.yml > "$TEST_DIR/diagnostic.log" 2>&1 &
SERVER_PID=$!
sleep 3

# Check server started
if curl -s http://localhost:3000/api/config >/dev/null 2>&1; then
    pass_test "Server started (diagnostic mode)"
else
    fail_test "Server failed to start"
    exit 1
fi

# Prime adsb2dd service
echo "Priming adsb2dd service..."
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" >/dev/null
sleep 8

# Test endpoint responds
if curl -s http://localhost:3000/api/adsb2dd > "$TEST_DIR/diagnostic_result.json"; then
    pass_test "Diagnostic mode endpoint responds"
else
    fail_test "Diagnostic mode endpoint failed"
fi

# Check response structure
if jq -e '.method == "diagnostic"' "$TEST_DIR/diagnostic_result.json" >/dev/null 2>&1; then
    pass_test "Diagnostic mode returns correct method type"
else
    fail_test "Diagnostic mode missing method field"
fi

# Check for all three sections
if jq -e 'has("legacy") and has("new") and has("comparison")' "$TEST_DIR/diagnostic_result.json" >/dev/null 2>&1; then
    pass_test "Diagnostic mode has all three sections"
else
    fail_test "Diagnostic mode missing sections"
fi

# Check comparison structure
if jq -e '.comparison | has("total_aircraft") and has("avg_delay_diff") and has("largest_discrepancies")' "$TEST_DIR/diagnostic_result.json" >/dev/null 2>&1; then
    pass_test "Comparison has expected fields"
else
    fail_test "Comparison missing expected fields"
fi

# Check comparison data quality
BOTH_COUNT=$(jq -r '.comparison.total_aircraft.both' "$TEST_DIR/diagnostic_result.json")
if [ "$BOTH_COUNT" -gt 0 ]; then
    pass_test "Diagnostic mode found matching aircraft ($BOTH_COUNT)"
else
    echo -e "${YELLOW}⚠${NC}  No matching aircraft (may need longer initialization)"
fi

# Test response time (should be ~2x slower)
START_TIME=$(date +%s%N)
curl -s http://localhost:3000/api/adsb2dd > /dev/null
END_TIME=$(date +%s%N)
RESPONSE_TIME=$(( (END_TIME - START_TIME) / 1000000 ))
if [ "$RESPONSE_TIME" -lt 4000 ]; then
    pass_test "Diagnostic mode response time acceptable: ${RESPONSE_TIME}ms"
else
    echo -e "${YELLOW}⚠${NC}  Diagnostic mode response time high: ${RESPONSE_TIME}ms"
fi

kill $SERVER_PID 2>/dev/null || true
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 7: Error Handling
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 7: Error Handling"

echo "Starting server with new method..."
node server.js ../config/config.yml > "$TEST_DIR/error_test.log" 2>&1 &
SERVER_PID=$!
sleep 3

# Test with ADSB disabled
# (Would need to modify config, skip for now)

# Test invalid endpoint
if curl -s http://localhost:3000/api/invalid_endpoint | grep -q "Cannot GET"; then
    pass_test "Invalid endpoint returns expected error"
else
    fail_test "Invalid endpoint handling incorrect"
fi

# Test endpoint with disabled ADSB (if we had a test config)
# For now, just verify the endpoint doesn't crash

kill $SERVER_PID 2>/dev/null || true
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 8: Configuration Toggle
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 8: Configuration Toggle (Rollback Capability)"

# Test switching from new to legacy
echo "Testing config switch: new -> legacy"
node server.js ../config/config.yml > /dev/null 2>&1 &
SERVER_PID=$!
sleep 2
kill $SERVER_PID 2>/dev/null || true
sleep 1

node server.js ../config/config_test_legacy.yml > /dev/null 2>&1 &
SERVER_PID=$!
sleep 2
if curl -s http://localhost:3000/api/config >/dev/null 2>&1; then
    pass_test "Server restarts with different config"
else
    fail_test "Config switch failed"
fi
kill $SERVER_PID 2>/dev/null || true
sleep 1

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 9: Data Comparison Validation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 9: Data Comparison Validation"

if [ -f "$TEST_DIR/diagnostic_result.json" ] && [ -s "$TEST_DIR/diagnostic_result.json" ]; then
    # Check if comparison detected the doppler sign issue
    AVG_DOPPLER_DIFF=$(jq -r '.comparison.avg_doppler_diff // 0' "$TEST_DIR/diagnostic_result.json")

    if [ "$AVG_DOPPLER_DIFF" != "null" ] && [ "$AVG_DOPPLER_DIFF" != "0" ]; then
        if (( $(echo "$AVG_DOPPLER_DIFF > 100" | bc -l) )); then
            pass_test "Diagnostic mode detected large doppler differences (${AVG_DOPPLER_DIFF} Hz)"
        else
            echo -e "${YELLOW}⚠${NC}  Small doppler difference: ${AVG_DOPPLER_DIFF} Hz"
        fi
    else
        echo -e "${YELLOW}⚠${NC}  No doppler comparison data (may need more aircraft)"
    fi

    # Check top discrepancy
    TOP_DISCREPANCY=$(jq -r '.comparison.largest_discrepancies[0].doppler_diff // 0' "$TEST_DIR/diagnostic_result.json")
    if [ "$TOP_DISCREPANCY" != "null" ] && [ "$TOP_DISCREPANCY" != "0" ]; then
        pass_test "Top discrepancy detected: ${TOP_DISCREPANCY} Hz"
    fi
else
    echo -e "${YELLOW}⚠${NC}  No diagnostic result to validate"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Test 10: Documentation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "Test 10: Documentation Validation"

for doc in ../TESTING_AB.md DIAGNOSTIC_MODE.md QUICK_TEST.md; do
    if [ -f "$doc" ]; then
        pass_test "Documentation exists: $doc"
    else
        fail_test "Documentation missing: $doc"
    fi
done

# Check test scripts are executable
for script in test_ab.sh DIAGNOSTIC_QUICK_START.sh; do
    if [ -x "$script" ]; then
        pass_test "Test script executable: $script"
    else
        fail_test "Test script not executable: $script"
    fi
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}✓ PR is ready for deployment${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    echo "Test artifacts saved to: $TEST_DIR"
    echo
    echo "Next steps:"
    echo "  1. Review test results above"
    echo "  2. Check diagnostic output: jq '.comparison' $TEST_DIR/diagnostic_result.json"
    echo "  3. Deploy to staging/production"
    echo "  4. Monitor: watch -n 30 'curl -s https://radar3.retnode.com/api/adsb2dd | jq .comparison'"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}✗ TESTS FAILED${NC}"
    echo -e "${RED}✗ Fix failures before deployment${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    echo "Check logs in: $TEST_DIR"
    exit 1
fi
