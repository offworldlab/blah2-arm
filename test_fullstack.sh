#!/bin/bash
# Full-stack integration test for blah2
# Tests API and frontend compatibility before deployment

set -e  # Exit on error

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Full-Stack Integration Test - blah2${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# 1. Start services
echo -e "${YELLOW}[1/8]${NC} Starting Docker services..."
docker compose up -d
echo "      Waiting for services to initialize..."
sleep 15

# 2. Wait for API to be ready
echo -e "${YELLOW}[2/8]${NC} Waiting for API to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:3000/api/config > /dev/null 2>&1; then
    echo -e "      ${GREEN}✓${NC} API ready after $i seconds"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "      ${RED}✗${NC} API failed to start after 30 seconds"
    exit 1
  fi
  sleep 1
done

# 3. Test /api/adsb2dd endpoint (production endpoint)
echo -e "${YELLOW}[3/8]${NC} Testing /api/adsb2dd (production endpoint)..."

ADSB_RESPONSE=$(curl -s http://localhost:3000/api/adsb2dd)

# For local testing, empty response is OK (no real ADSB data available)
# Just verify the endpoint is accessible and returns valid JSON
if echo "$ADSB_RESPONSE" | jq '.' > /dev/null 2>&1; then
  AIRCRAFT_COUNT=$(echo "$ADSB_RESPONSE" | jq 'keys | length')
  echo -e "      ${GREEN}✓${NC} Endpoint accessible, returns $AIRCRAFT_COUNT aircraft (0 expected for local testing)"
else
  echo -e "      ${RED}✗${NC} Endpoint not accessible or invalid JSON"
  echo "      Response: $ADSB_RESPONSE"
  exit 1
fi

# Check response structure (should NOT have diagnostic format)
if echo "$ADSB_RESPONSE" | jq -e '.method' > /dev/null 2>&1; then
  echo -e "      ${RED}✗${NC} ERROR: Production endpoint returned diagnostic format!"
  echo "      This will break the frontend visualization."
  exit 1
else
  echo -e "      ${GREEN}✓${NC} Returns normal format (not diagnostic)"
fi

# 4. Test /api/adsb2dd/diagnostic endpoint
echo -e "${YELLOW}[4/8]${NC} Testing /api/adsb2dd/diagnostic (debug endpoint)..."

DIAG_RESPONSE=$(curl -s http://localhost:3000/api/adsb2dd/diagnostic)
DIAG_METHOD=$(echo "$DIAG_RESPONSE" | jq -r '.method // "missing"')

if [ "$DIAG_METHOD" = "diagnostic" ]; then
  echo -e "      ${GREEN}✓${NC} Diagnostic endpoint returns correct format"
else
  echo -e "      ${RED}✗${NC} Diagnostic endpoint format incorrect (method: $DIAG_METHOD)"
  exit 1
fi

# Check diagnostic data has required fields
if echo "$DIAG_RESPONSE" | jq -e '.legacy and .new and .comparison' > /dev/null 2>&1; then
  echo -e "      ${GREEN}✓${NC} Diagnostic data has all required fields"
else
  echo -e "      ${RED}✗${NC} Diagnostic data missing required fields"
  exit 1
fi

# 5. Test frontend loads
echo -e "${YELLOW}[5/8]${NC} Testing frontend HTTP response..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:49154/)
if [ "$FRONTEND_STATUS" = "200" ]; then
  echo -e "      ${GREEN}✓${NC} Frontend loads (HTTP 200)"
else
  echo -e "      ${RED}✗${NC} Frontend failed (HTTP $FRONTEND_STATUS)"
  exit 1
fi

# 6. Verify JavaScript files exist
echo -e "${YELLOW}[6/8]${NC} Verifying frontend JavaScript files..."
if [ -f "web/html/js/plot_map.js" ]; then
  echo -e "      ${GREEN}✓${NC} Frontend JavaScript files present"
else
  echo -e "      ${RED}✗${NC} Frontend JavaScript files missing"
  exit 1
fi

# 7. Check for backwards compatibility
echo -e "${YELLOW}[7/8]${NC} Checking backwards compatibility..."

# Ensure diagnostic_mode config is not required
if grep -q "diagnostic_mode" config/config.yml; then
  echo -e "      ${YELLOW}⚠${NC}  Warning: diagnostic_mode still in config (should be removed)"
else
  echo -e "      ${GREEN}✓${NC} No diagnostic_mode config dependency"
fi

# 8. Manual visual verification
echo -e "${YELLOW}[8/8]${NC} Manual visual verification required"
echo "      Please open: ${BOLD}http://localhost:49154/display/maxhold/${NC}"
echo
echo "      Checklist:"
echo "      □ Page loads without errors"
echo "      □ No JavaScript console errors"
echo "      □ Radar heatmap visible"
echo "      □ ADSB green dots visible (if aircraft present)"
echo "      □ Visualization updates over time"
echo

read -p "Does the visualization work correctly? (y/n): " VISUAL_OK

echo
if [ "$VISUAL_OK" = "y" ] || [ "$VISUAL_OK" = "Y" ]; then
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo
  echo "Safe to deploy to production."
  echo
  echo "To test diagnostic endpoint:"
  echo "  curl http://localhost:3000/api/adsb2dd/diagnostic | jq '.comparison'"
  echo
  exit 0
else
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}✗ VISUAL VERIFICATION FAILED${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo
  echo "DO NOT deploy to production."
  echo "Check browser console for errors."
  echo
  exit 1
fi
