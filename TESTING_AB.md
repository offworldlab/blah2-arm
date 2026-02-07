# A/B Testing Guide: Legacy vs New ADSB Method

## Overview

This guide explains how to test the legacy adsb2dd service method against the new tar1090+extrapolation method to diagnose ADSB dot alignment issues.

## What Was Implemented

### Configuration Flag
- **File**: `blah2-arm/config/config.yml`
- **Flag**: `truth.adsb.use_legacy_method`
  - `false` (default): Use new tar1090 + extrapolation method
  - `true`: Use old adsb2dd service method

### Code Changes
- **File**: `blah2-arm/api/server.js`
- Refactored `/api/adsb2dd` endpoint to support both methods
- Added three new functions:
  - `buildAdsbQuery()`: Constructs adsb2dd API query string
  - `fetchJson()`: HTTP helper with timeout handling
  - `fetchFromAdsbService()`: Legacy method using adsb2dd service
  - `fetchFromTar1090AndExtrapolate()`: New method (refactored from original)

## Prerequisites

For legacy method testing, ensure adsb2dd service is running:

```bash
docker ps | grep adsb2dd
```

Expected output:
```
adsb2dd    ghcr.io/offworldlabs/adsb2dd:v0.1.3    Up X hours
```

If not running, check `retina-node/docker-compose.yml` (lines 130-137).

## Testing Locally

### Test 1: Legacy Method

1. **Start API with legacy config:**
   ```bash
   cd /Users/jonnyspicer/repos/retina/blah2-arm/api
   node server.js ../config/config_test_legacy.yml
   ```

2. **Test endpoint:**
   ```bash
   curl -s http://localhost:3000/api/adsb2dd | jq -r 'to_entries[0].value | keys'
   ```

3. **Expected output:**
   ```json
   ["delay", "doppler", "flight", "timestamp"]
   ```

### Test 2: New Method

1. **Start API with default config:**
   ```bash
   cd /Users/jonnyspicer/repos/retina/blah2-arm/api
   node server.js ../config/config.yml
   ```

2. **Test endpoint:**
   ```bash
   curl -s http://localhost:3000/api/adsb2dd | jq -r 'to_entries[0].value | keys'
   ```

3. **Expected output:**
   ```json
   ["delay", "doppler", "extrapolated", "flight", "gs", "hex", "lat", "lon", ...]
   ```

### Test 3: Compare Outputs

1. **Capture legacy data:**
   ```bash
   curl -s http://localhost:3000/api/adsb2dd > legacy_output.json
   ```

2. **Switch to new method and capture:**
   ```bash
   # Restart server with config.yml
   curl -s http://localhost:3000/api/adsb2dd > new_output.json
   ```

3. **Compare specific aircraft:**
   ```bash
   # Compare delay/doppler for specific hex
   jq '.["a12345"]' legacy_output.json
   jq '.["a12345"]' new_output.json
   ```

## Testing on radar3

### Visual Verification - Legacy Method

1. **Deploy with legacy method:**
   ```bash
   # On radar3, update config.yml:
   truth:
     adsb:
       use_legacy_method: true

   # Restart services
   docker compose restart blah2_api
   ```

2. **Check visualization:**
   - Open: https://radar3.retnode.com/display/maxhold
   - Verify: Green ADSB dots overlay orange radar dots
   - Check: Multiple aircraft align correctly

### Visual Verification - New Method

1. **Deploy with new method:**
   ```bash
   # Update config.yml:
   truth:
     adsb:
       use_legacy_method: false

   # Restart services
   docker compose restart blah2_api
   ```

2. **Check visualization:**
   - Open: https://radar3.retnode.com/display/maxhold
   - Compare: Do ADSB dots align with radar dots?
   - Note: Any offset or misalignment patterns

## Diagnostic Analysis

### If Legacy Method Works

The issue is in the tar1090+extrapolation implementation. Possible causes:

1. **Position Extrapolation Bug**
   - Check: `blah2-arm/api/lib/extrapolation.js`
   - Verify: Velocity vector calculations
   - Test: Aircraft with different speeds/headings

2. **Bistatic Calculation Differences**
   - Check: `blah2-arm/api/bistatic.js`
   - Compare: Against adsb2dd implementation
   - Focus: Coordinate transformations

3. **Timestamp Calculation Error**
   - Check: `seen_pos` field interpretation
   - Verify: Time synchronization between systems
   - Test: With known aircraft at specific times

4. **Coordinate System Mismatch**
   - Verify: LLA to ENU conversions
   - Check: Altitude datum (geom vs baro)
   - Compare: Reference frames used

### If Both Methods Fail

The issue is NOT in the calculation method. Possible causes:

1. Configuration differences between nodes
2. Visualization code issues
3. Data freshness/caching problems
4. Network connectivity issues

## Expected Data Formats

### Legacy Method Response
```json
{
  "a12345": {
    "delay": 45.32,
    "doppler": -123.5,
    "flight": "UAL123",
    "timestamp": 1234567890.123
  }
}
```

### New Method Response
```json
{
  "a12345": {
    "delay": 45.35,
    "doppler": -123.8,
    "extrapolated": true,
    "flight": "UAL123",
    "gs": 450.2,
    "hex": "a12345",
    "lat": 37.7644,
    "lon": -122.3954,
    "timestamp": 1234567890.123
  }
}
```

## Rollback

If issues arise:

```bash
# Revert to new method (default)
truth:
  adsb:
    use_legacy_method: false

docker compose restart blah2_api
```

## Success Criteria

- ✅ Both methods work independently
- ✅ Legacy method shows correct alignment on radar3
- ✅ New method alignment issue reproduced locally
- ✅ Root cause identified through comparison
- ✅ Clear path forward for fixing new method

## Next Steps

Based on testing results:

1. **If Legacy Works**: Focus on debugging the new method
   - Add detailed logging to extrapolation code
   - Compare intermediate calculation results
   - Test with single aircraft at known position

2. **If Both Fail**: Investigate system-level issues
   - Check network latency
   - Verify data freshness
   - Review visualization code
   - Test on different nodes

## Logging

Enable detailed logging by modifying server.js temporarily:

```javascript
// In fetchFromAdsbService()
console.log('[LEGACY] Query:', api_query);
console.log('[LEGACY] Response:', JSON.stringify(response).slice(0, 200));

// In fetchFromTar1090AndExtrapolate()
console.log('[NEW] Aircraft count:', aircraft.length);
console.log('[NEW] Detection timestamp:', detectionTimestamp);
console.log('[NEW] Result sample:', JSON.stringify(synchronized).slice(0, 200));
```

Check logs:
```bash
docker compose logs -f blah2_api
```
