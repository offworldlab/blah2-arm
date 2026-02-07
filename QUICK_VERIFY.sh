#!/bin/bash
# Quick Deployment Verification for radar3
# Run this immediately after deploying PR #28

RADAR_URL="https://radar3.retnode.com"
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Deployment Verification - radar3${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Test 1: Diagnostic mode active
echo -e "${YELLOW}[1/6]${NC} Checking diagnostic mode..."
MODE=$(curl -s ${RADAR_URL}/api/adsb2dd | jq -r '.method // "null"')
if [ "$MODE" = "diagnostic" ]; then
  echo -e "      ${GREEN}✓${NC} Diagnostic mode: ACTIVE"
else
  echo -e "      ${RED}✗${NC} Diagnostic mode: NOT ACTIVE (got: $MODE)"
  echo
  echo "Fix: Check config.yml has diagnostic_mode: true"
  exit 1
fi

# Test 2: Both methods return data
echo -e "${YELLOW}[2/6]${NC} Checking aircraft counts..."
COUNTS=$(curl -s ${RADAR_URL}/api/adsb2dd | jq '.comparison.total_aircraft')
LEGACY=$(echo $COUNTS | jq -r '.legacy')
NEW=$(echo $COUNTS | jq -r '.new')
BOTH=$(echo $COUNTS | jq -r '.both')

echo "      Legacy: $LEGACY aircraft"
echo "      New: $NEW aircraft"
echo "      Both: $BOTH aircraft"

if [ "$LEGACY" -gt 0 ] && [ "$NEW" -gt 0 ]; then
  echo -e "      ${GREEN}✓${NC} Both methods returning data"
else
  if [ "$LEGACY" -eq 0 ]; then
    echo -e "      ${YELLOW}⚠${NC}  Legacy method empty (adsb2dd may need 30s initialization)"
  fi
  if [ "$NEW" -eq 0 ]; then
    echo -e "      ${RED}✗${NC} New method empty (tar1090 connection issue?)"
  fi
fi

# Test 3: Doppler sign error detected
echo -e "${YELLOW}[3/6]${NC} Checking for doppler sign error..."
DOPPLER_DIFF=$(curl -s ${RADAR_URL}/api/adsb2dd | jq -r '.comparison.avg_doppler_diff // "null"')
DELAY_DIFF=$(curl -s ${RADAR_URL}/api/adsb2dd | jq -r '.comparison.avg_delay_diff // "null"')

echo "      Avg doppler diff: ${DOPPLER_DIFF} Hz"
echo "      Avg delay diff: ${DELAY_DIFF} km"

if [ "$DOPPLER_DIFF" != "null" ] && (( $(echo "$DOPPLER_DIFF > 500" | bc -l) )); then
  echo -e "      ${GREEN}✓${NC} Doppler sign error DETECTED (high difference)"
elif [ "$DOPPLER_DIFF" = "null" ]; then
  echo -e "      ${YELLOW}⚠${NC}  No comparison data (need matching aircraft)"
else
  echo -e "      ${YELLOW}⚠${NC}  Low doppler difference (unexpected)"
fi

# Test 4: Check specific discrepancy
echo -e "${YELLOW}[4/6]${NC} Examining top discrepancy..."
DISCREPANCY=$(curl -s ${RADAR_URL}/api/adsb2dd | jq '.comparison.largest_discrepancies[0]')
if [ "$DISCREPANCY" != "null" ]; then
  HEX=$(echo $DISCREPANCY | jq -r '.hex')
  FLIGHT=$(echo $DISCREPANCY | jq -r '.flight')
  DOP_LEGACY=$(echo $DISCREPANCY | jq -r '.doppler_legacy')
  DOP_NEW=$(echo $DISCREPANCY | jq -r '.doppler_new')

  echo "      Aircraft: $HEX ($FLIGHT)"
  echo "      Doppler legacy: $DOP_LEGACY Hz"
  echo "      Doppler new: $DOP_NEW Hz"

  # Check for sign flip
  if [ "$DOP_LEGACY" != "null" ] && [ "$DOP_NEW" != "null" ]; then
    LEGACY_SIGN=$(echo "$DOP_LEGACY < 0" | bc -l)
    NEW_SIGN=$(echo "$DOP_NEW < 0" | bc -l)

    if [ "$LEGACY_SIGN" != "$NEW_SIGN" ]; then
      echo -e "      ${GREEN}✓${NC} SIGN ERROR CONFIRMED (opposite signs)"
    else
      echo -e "      ${YELLOW}⚠${NC}  Same signs (unexpected)"
    fi
  fi
else
  echo -e "      ${YELLOW}⚠${NC}  No discrepancies to analyze"
fi

# Test 5: Response time
echo -e "${YELLOW}[5/6]${NC} Checking response time..."
START=$(date +%s%N)
curl -s ${RADAR_URL}/api/adsb2dd > /dev/null
END=$(date +%s%N)
RESPONSE_TIME=$(( (END - START) / 1000000 ))

echo "      Response time: ${RESPONSE_TIME}ms"
if [ "$RESPONSE_TIME" -lt 500 ]; then
  echo -e "      ${GREEN}✓${NC} Response time acceptable"
else
  echo -e "      ${YELLOW}⚠${NC}  Response time high (diagnostic mode is 2x slower)"
fi

# Test 6: Visual verification reminder
echo -e "${YELLOW}[6/6]${NC} Visual verification..."
echo "      Open: ${RADAR_URL}/display/maxhold"
echo "      Expected: Green ADSB dots MISALIGNED with orange radar dots"
echo -e "      ${YELLOW}→${NC} Manual check required"

echo
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Summary${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$MODE" = "diagnostic" ] && [ "$LEGACY" -gt 0 ] && [ "$NEW" -gt 0 ]; then
  echo -e "${GREEN}✓ DEPLOYMENT SUCCESSFUL${NC}"
  echo
  echo "Diagnostic mode is active and detecting the bug:"
  echo "  • Doppler difference: ${DOPPLER_DIFF} Hz (sign error)"
  echo "  • Delay difference: ${DELAY_DIFF} km (offset)"
  echo
  echo "Next steps:"
  echo "  1. Check visual alignment at $RADAR_URL/display/maxhold"
  echo "  2. Collect diagnostic snapshots (see DEPLOYMENT_VERIFICATION.md)"
  echo "  3. Use data to fix doppler sign error in bistatic.js"
  echo
  echo "Monitor with:"
  echo "  watch -n 30 'curl -s ${RADAR_URL}/api/adsb2dd | jq .comparison'"
else
  echo -e "${RED}⚠ ISSUES DETECTED${NC}"
  echo
  echo "Check the output above and review DEPLOYMENT_VERIFICATION.md"
fi

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
