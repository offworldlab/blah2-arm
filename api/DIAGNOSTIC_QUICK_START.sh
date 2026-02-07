#!/bin/bash
# Quick Start: Diagnostic Mode Testing

set -e

cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Diagnostic Mode Quick Start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Check prerequisites
if ! docker ps | grep -q adsb2dd; then
    echo "❌ adsb2dd service not running"
    echo "   Start with: cd ../local-radar-test && docker compose up -d"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "❌ jq not installed"
    echo "   Install with: brew install jq"
    exit 1
fi

echo "✅ Prerequisites OK"
echo

# Kill any existing server
pkill -f "node server.js" 2>/dev/null || true
sleep 1

# Start server
echo "🚀 Starting server with diagnostic mode..."
node server.js ../config/config_test_diagnostic.yml > /tmp/diagnostic_server.log 2>&1 &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# Wait for startup
sleep 2

# Check if server started
if ! curl -s http://localhost:3000/api/config >/dev/null 2>&1; then
    echo "❌ Server failed to start"
    echo "   Check logs: cat /tmp/diagnostic_server.log"
    exit 1
fi

echo "✅ Server started"
echo

# Prime adsb2dd service
echo "⏳ Initializing adsb2dd service..."
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" >/dev/null
echo "   Waiting for data fetch (5 seconds)..."
sleep 5

echo "✅ adsb2dd initialized"
echo

# Test diagnostic endpoint
echo "📊 Fetching diagnostic comparison..."
curl -s http://localhost:3000/api/adsb2dd > /tmp/diagnostic_result.json

# Display summary
echo
echo "━━━ COMPARISON SUMMARY ━━━"
jq '.comparison | {
  aircraft: .total_aircraft,
  avg_delay_diff_km: .avg_delay_diff,
  avg_doppler_diff_hz: .avg_doppler_diff
}' /tmp/diagnostic_result.json

echo
echo "━━━ TOP 5 DISCREPANCIES ━━━"
jq '.comparison.largest_discrepancies[0:5] | .[] | {
  hex,
  flight,
  delay_diff,
  doppler_diff
}' /tmp/diagnostic_result.json

echo
echo "━━━ EXAMPLE AIRCRAFT COMPARISON ━━━"
AIRCRAFT_HEX=$(jq -r '.comparison.largest_discrepancies[0].hex' /tmp/diagnostic_result.json)
echo "Aircraft: $AIRCRAFT_HEX"
echo
echo "Legacy Method:"
jq ".legacy[\"$AIRCRAFT_HEX\"]" /tmp/diagnostic_result.json
echo
echo "New Method:"
jq ".new[\"$AIRCRAFT_HEX\"]" /tmp/diagnostic_result.json

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Diagnostic test complete"
echo
echo "Full results saved to: /tmp/diagnostic_result.json"
echo
echo "To analyze further:"
echo "  jq '.comparison' /tmp/diagnostic_result.json"
echo "  jq '.legacy | keys | length' /tmp/diagnostic_result.json"
echo "  jq '.new | keys | length' /tmp/diagnostic_result.json"
echo
echo "To stop server:"
echo "  kill $SERVER_PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
