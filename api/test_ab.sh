#!/bin/bash
# A/B Testing Script for ADSB Methods

set -e

API_PORT=3000
TEST_DIR="/tmp/blah2_ab_test"
mkdir -p "$TEST_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  A/B Testing: Legacy vs New ADSB Method"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Function to wait for API to be ready
wait_for_api() {
    local max_attempts=10
    local attempt=0

    echo "⏳ Waiting for API to be ready..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s http://localhost:$API_PORT/api/config >/dev/null 2>&1; then
            echo "✅ API is ready"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    echo "❌ API failed to start"
    return 1
}

# Function to stop any running server
stop_server() {
    pkill -f "node server.js" 2>/dev/null || true
    sleep 1
}

# Test 1: Legacy Method
echo "━━━ Test 1: Legacy Method ━━━"
echo "Starting server with use_legacy_method: true"
stop_server

node server.js ../config/config_test_legacy.yml > "$TEST_DIR/legacy.log" 2>&1 &
LEGACY_PID=$!
echo "Server PID: $LEGACY_PID"

if wait_for_api; then
    echo "Fetching ADSB data..."
    curl -s "http://localhost:$API_PORT/api/adsb2dd" > "$TEST_DIR/legacy_output.json"

    # Count aircraft
    LEGACY_COUNT=$(jq 'keys | length' "$TEST_DIR/legacy_output.json")
    echo "📡 Aircraft count: $LEGACY_COUNT"

    # Show sample aircraft
    if [ "$LEGACY_COUNT" -gt 0 ]; then
        echo "Sample aircraft (first entry):"
        jq 'to_entries | .[0] | {hex: .key, data: .value}' "$TEST_DIR/legacy_output.json"
    else
        echo "⚠️  No aircraft data returned"
    fi
else
    echo "❌ Legacy method test failed"
fi

echo

# Test 2: New Method
echo "━━━ Test 2: New Method ━━━"
echo "Starting server with use_legacy_method: false"
stop_server

node server.js ../config/config.yml > "$TEST_DIR/new.log" 2>&1 &
NEW_PID=$!
echo "Server PID: $NEW_PID"

if wait_for_api; then
    echo "Fetching ADSB data..."
    curl -s "http://localhost:$API_PORT/api/adsb2dd" > "$TEST_DIR/new_output.json"

    # Count aircraft
    NEW_COUNT=$(jq 'keys | length' "$TEST_DIR/new_output.json")
    echo "📡 Aircraft count: $NEW_COUNT"

    # Show sample aircraft
    if [ "$NEW_COUNT" -gt 0 ]; then
        echo "Sample aircraft (first entry):"
        jq 'to_entries | .[0] | {hex: .key, data: .value}' "$TEST_DIR/new_output.json"
    else
        echo "⚠️  No aircraft data returned"
    fi
else
    echo "❌ New method test failed"
fi

echo

# Comparison
echo "━━━ Comparison Summary ━━━"
echo "Legacy method: $LEGACY_COUNT aircraft"
echo "New method: $NEW_COUNT aircraft"

if [ "$LEGACY_COUNT" -gt 0 ] && [ "$NEW_COUNT" -gt 0 ]; then
    echo
    echo "Comparing delay/doppler for matching aircraft..."

    # Get common aircraft hexes
    jq -r 'keys[]' "$TEST_DIR/legacy_output.json" | sort > "$TEST_DIR/legacy_hexes.txt"
    jq -r 'keys[]' "$TEST_DIR/new_output.json" | sort > "$TEST_DIR/new_hexes.txt"

    comm -12 "$TEST_DIR/legacy_hexes.txt" "$TEST_DIR/new_hexes.txt" | head -3 | while read hex; do
        echo
        echo "Aircraft: $hex"
        echo "  Legacy:"
        jq ".\"$hex\" | {delay, doppler}" "$TEST_DIR/legacy_output.json"
        echo "  New:"
        jq ".\"$hex\" | {delay, doppler}" "$TEST_DIR/new_output.json"

        # Calculate difference
        LEGACY_DELAY=$(jq -r ".\"$hex\".delay" "$TEST_DIR/legacy_output.json")
        NEW_DELAY=$(jq -r ".\"$hex\".delay" "$TEST_DIR/new_output.json")
        LEGACY_DOPPLER=$(jq -r ".\"$hex\".doppler" "$TEST_DIR/legacy_output.json")
        NEW_DOPPLER=$(jq -r ".\"$hex\".doppler" "$TEST_DIR/new_output.json")

        DELAY_DIFF=$(echo "$NEW_DELAY - $LEGACY_DELAY" | bc -l 2>/dev/null || echo "N/A")
        DOPPLER_DIFF=$(echo "$NEW_DOPPLER - $LEGACY_DOPPLER" | bc -l 2>/dev/null || echo "N/A")

        echo "  Δ Delay: $DELAY_DIFF km"
        echo "  Δ Doppler: $DOPPLER_DIFF Hz"
    done
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test results saved to: $TEST_DIR"
echo "  - legacy_output.json"
echo "  - new_output.json"
echo "  - legacy.log"
echo "  - new.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Cleanup
stop_server
