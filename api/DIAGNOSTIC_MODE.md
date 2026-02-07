# Diagnostic Mode: Side-by-Side Method Comparison

## Overview

Diagnostic mode runs **both** the legacy adsb2dd service method and the new tar1090+extrapolation method simultaneously, returning results for direct comparison. This enables real-time identification of discrepancies without needing to restart services or correlate data across different time windows.

## Configuration

Enable diagnostic mode in `config.yml`:

```yaml
truth:
  adsb:
    enabled: true
    tar1090: 'sfo1.retnode.com'
    adsb2dd: 'localhost:49155'
    use_legacy_method: false      # Ignored when diagnostic_mode is true
    diagnostic_mode: true          # Enable side-by-side comparison
    delay_tolerance: 2.0
    doppler_tolerance: 5.0
```

**Note**: When `diagnostic_mode: true`, the `use_legacy_method` flag is ignored - both methods always run.

## Output Format

The `/api/adsb2dd` endpoint returns a diagnostic object with three sections:

```json
{
  "method": "diagnostic",
  "legacy": {
    "a2fe8f": {
      "timestamp": 1770504373.802,
      "flight": "SKW3789 ",
      "delay": "102.98506",
      "doppler": "-594.90424"
    }
  },
  "new": {
    "a2fe8f": {
      "hex": "a2fe8f",
      "flight": "SKW3789 ",
      "timestamp": 1770504375.659,
      "lat": 38.288,
      "lon": -121.987,
      "delay": 115.397,
      "doppler": 600.551,
      "extrapolated": true
    }
  },
  "comparison": {
    "total_aircraft": {
      "legacy": 38,
      "new": 57,
      "both": 38,
      "legacy_only": 0,
      "new_only": 19
    },
    "avg_delay_diff": 3.38,
    "avg_doppler_diff": 717.26,
    "largest_discrepancies": [
      {
        "hex": "a2fe8f",
        "flight": "SKW3789 ",
        "delay_legacy": 102.99,
        "delay_new": 115.40,
        "delay_diff": 12.41,
        "doppler_legacy": -594.90,
        "doppler_new": 600.55,
        "doppler_diff": 1195.45
      }
    ]
  }
}
```

### Comparison Metrics

- **total_aircraft**: Count breakdown
  - `legacy`: Aircraft from legacy method
  - `new`: Aircraft from new method
  - `both`: Aircraft present in both results
  - `legacy_only`: Aircraft only in legacy
  - `new_only`: Aircraft only in new

- **avg_delay_diff**: Average absolute delay difference (km) across all matching aircraft
- **avg_doppler_diff**: Average absolute doppler difference (Hz) across all matching aircraft
- **largest_discrepancies**: Top 10 aircraft with largest delay differences

## Local Testing

### Quick Test

```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm/api

# Start server with diagnostic config
node server.js ../config/config_test_diagnostic.yml &
SERVER_PID=$!

# Wait for startup
sleep 2

# Prime adsb2dd service (important!)
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" >/dev/null

# Wait for adsb2dd to fetch data
sleep 5

# Get diagnostic comparison
curl -s http://localhost:3000/api/adsb2dd | jq '.comparison'

# Stop server
kill $SERVER_PID
```

### Detailed Analysis

```bash
# Save full diagnostic output
curl -s http://localhost:3000/api/adsb2dd > /tmp/diagnostic.json

# View comparison summary
jq '.comparison' /tmp/diagnostic.json

# Compare specific aircraft
AIRCRAFT_HEX=$(jq -r '.comparison.largest_discrepancies[0].hex' /tmp/diagnostic.json)
echo "Comparing aircraft: $AIRCRAFT_HEX"
echo "Legacy:"
jq ".legacy[\"$AIRCRAFT_HEX\"]" /tmp/diagnostic.json
echo "New:"
jq ".new[\"$AIRCRAFT_HEX\"]" /tmp/diagnostic.json

# Find aircraft only in one method
jq '.legacy | keys - (.new | keys)' /tmp/diagnostic.json  # legacy_only
jq '.new | keys - (.legacy | keys)' /tmp/diagnostic.json  # new_only
```

### Automated Monitoring

Monitor diagnostic results over time:

```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm/api

# Start server
node server.js ../config/config_test_diagnostic.yml &

# Prime adsb2dd
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" >/dev/null
sleep 5

# Monitor every 10 seconds
watch -n 10 'curl -s http://localhost:3000/api/adsb2dd | jq ".comparison | {aircraft: .total_aircraft, delay_diff: .avg_delay_diff, doppler_diff: .avg_doppler_diff}"'
```

## Production Deployment

### On radar3

1. **Update config.yml**:
   ```yaml
   truth:
     adsb:
       diagnostic_mode: true
   ```

2. **Restart service**:
   ```bash
   docker compose restart blah2_api
   ```

3. **Monitor results**:
   ```bash
   # View comparison every 30 seconds
   watch -n 30 'curl -s https://radar3.retnode.com/api/adsb2dd | jq .comparison'
   ```

4. **Save diagnostic snapshots**:
   ```bash
   # Capture diagnostic data
   for i in {1..20}; do
     curl -s https://radar3.retnode.com/api/adsb2dd >> diagnostic_radar3.jsonl
     sleep 30
   done

   # Analyze average discrepancies
   jq -s 'map(.comparison) | {
     avg_delay: (map(.avg_delay_diff) | add / length),
     avg_doppler: (map(.avg_doppler_diff) | add / length)
   }' diagnostic_radar3.jsonl
   ```

## Initial Findings

From local testing, diagnostic mode revealed:

### 🔴 Critical Issue: Doppler Sign Flip

**Observation**: Nearly all aircraft show **opposite signs** for doppler:
- Legacy: -594.90 Hz
- New: +600.55 Hz

**Impact**: This is a **systematic error** affecting all doppler calculations in the new method.

**Likely Cause**: Sign error in bistatic doppler calculation (`bistatic.js`), possibly:
1. Velocity vector direction reversed
2. Transmitter/receiver positions swapped in calculation
3. Line-of-sight vector computed incorrectly

### ⚠️ Secondary Issue: Delay Offset

**Observation**: Consistent delay differences (~3-4 km average, up to 12 km for some aircraft)

**Possible Causes**:
1. Position extrapolation errors (velocity integration)
2. Timestamp calculation differences
3. Coordinate system transformation issues
4. Altitude datum differences (geom vs baro)

### Aircraft Coverage Difference

**Observation**:
- Legacy: 38 aircraft
- New: 57 aircraft
- Both: 38 aircraft
- New only: 19 aircraft

**Explanation**: New method sees more aircraft because:
- Direct tar1090 access may have lower filtering
- Legacy adsb2dd may filter out aircraft without complete data
- Not necessarily a bug - just different coverage

## Performance Considerations

### Resource Impact

Diagnostic mode runs **both** calculations per request:
- **CPU**: ~2x processing load
- **Latency**: ~2x response time (legacy + new + comparison)
- **Network**: 2x external API calls (tar1090 + adsb2dd)

### Recommendations

1. **Use for debugging only** - not for continuous production
2. **Enable temporarily** when diagnosing issues
3. **Collect samples** (10-20 snapshots) then disable
4. **Monitor performance** - watch for increased latency/errors

### Initialization Delay

The legacy adsb2dd service requires initialization:
- **First call**: Returns empty results
- **Second call**: Returns data (after ~3-5 seconds)

**Impact on diagnostic mode**: First few diagnostic calls may show:
- `legacy: 0 aircraft`
- `new: N aircraft`
- `both: 0`

**Solution**: Wait 5-10 seconds after enabling diagnostic mode before analyzing results.

## Troubleshooting

### Issue: Legacy shows 0 aircraft

**Cause**: adsb2dd not initialized or service down

**Fix**:
```bash
# Check adsb2dd service
docker ps | grep adsb2dd

# Prime adsb2dd manually
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503"

# Wait and retry
sleep 5
curl http://localhost:3000/api/adsb2dd
```

### Issue: Both methods show different aircraft sets

**Expected**: Normal - methods may filter differently or have timing differences

**Check**:
```bash
# Identify aircraft only in one method
jq '.comparison.total_aircraft' /tmp/diagnostic.json
```

### Issue: High delay/doppler differences

**Expected**: This is the bug we're diagnosing!

**Action**:
1. Save diagnostic snapshots
2. Analyze patterns in discrepancies
3. Check specific aircraft with known positions
4. Review bistatic calculation code

### Issue: Performance degradation

**Symptom**: Slow response times, timeouts

**Cause**: Running both methods doubles processing load

**Fix**:
```bash
# Disable diagnostic mode
# In config.yml:
diagnostic_mode: false

# Restart service
docker compose restart blah2_api
```

## Next Steps

Based on diagnostic mode findings:

### 1. Fix Doppler Sign Issue

**File**: `blah2-arm/api/bistatic.js`

**Action**:
- Review `computeBistaticDoppler()` function
- Check velocity vector calculation
- Verify transmitter/receiver position usage
- Compare against working adsb2dd implementation

### 2. Investigate Delay Offset

**Files**:
- `blah2-arm/api/lib/extrapolation.js`
- `blah2-arm/api/bistatic.js`

**Action**:
- Verify position extrapolation algorithm
- Check timestamp calculation from `seen_pos`
- Compare altitude handling (geom vs baro)
- Validate coordinate transformations

### 3. Validate Fix

**Process**:
1. Apply fix to new method
2. Re-enable diagnostic mode
3. Verify avg_delay_diff < 1 km
4. Verify avg_doppler_diff < 10 Hz
5. Check doppler signs match

### 4. Production Deploy

Once validated:
1. Disable diagnostic mode
2. Set `use_legacy_method: false`
3. Deploy to radar3
4. Visual verification in tar1090

## Files

- **Config**: `blah2-arm/config/config_test_diagnostic.yml`
- **Implementation**: `blah2-arm/api/server.js` (lines 386-431)
- **Comparison Logic**: `compareAdsbResults()` function
- **Test Guide**: This document
