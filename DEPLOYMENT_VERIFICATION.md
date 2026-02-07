# Deployment Verification Guide

## What to Check After Deploying PR #28

This guide helps you verify that the A/B testing implementation is working correctly on radar3.

---

## Quick Success Checklist

After deploying, you should see:

- ✅ **Diagnostic mode active**: `/api/adsb2dd` returns 3 sections (legacy, new, comparison)
- ✅ **Both methods return data**: Legacy and new both have 30-60 aircraft
- ✅ **Doppler sign error visible**: avg_doppler_diff > 500 Hz
- ✅ **Delay offset visible**: avg_delay_diff ~3-4 km
- ✅ **Green dots misaligned** on maxhold display (confirms the bug exists)

---

## Step 1: Verify Diagnostic Mode is Active

### Command
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq 'has("method") and .method'
```

### Expected Output
```json
"diagnostic"
```

### What This Means
✅ **"diagnostic"**: Diagnostic mode is enabled and working
❌ **null or different value**: Diagnostic mode not active (check config.yml)

---

## Step 2: Check Data Structure

### Command
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq 'keys'
```

### Expected Output
```json
[
  "comparison",
  "legacy",
  "method",
  "new"
]
```

### What This Means
✅ **All 4 keys present**: Both methods running, comparison working
❌ **Missing keys**: Something failed to execute

---

## Step 3: Verify Both Methods Return Data

### Command
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.total_aircraft'
```

### Expected Output
```json
{
  "legacy": 45,
  "new": 52,
  "both": 42,
  "legacy_only": 3,
  "new_only": 10
}
```

### What to Check
✅ **legacy > 0**: Legacy method (adsb2dd service) is working
✅ **new > 0**: New method (tar1090 + extrapolation) is working
✅ **both > 30**: Good overlap for comparison
⚠️ **legacy = 0**: adsb2dd service may need initialization (wait 30 seconds, retry)
⚠️ **new = 0**: tar1090 connection issue

### Interpretation
- **both**: Number of aircraft present in both methods (used for comparison)
- **legacy_only**: Aircraft only in legacy (different filtering)
- **new_only**: Aircraft only in new (different filtering or timing)

**Normal**: Some difference in counts is expected due to different data sources/timing

---

## Step 4: Confirm the Doppler Sign Error is Detected

### Command
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison | {avg_delay_diff, avg_doppler_diff}'
```

### Expected Output
```json
{
  "avg_delay_diff": 3.38,
  "avg_doppler_diff": 717.26
}
```

### What to Check
✅ **avg_doppler_diff > 500**: The doppler sign error IS present and detected
✅ **avg_delay_diff 2-5**: The delay offset IS present
❌ **avg_doppler_diff < 50**: Bug may already be fixed, or comparison broken
❌ **avg_doppler_diff = null**: No matching aircraft to compare

### Why These Numbers Matter
- **High doppler diff (500-1000 Hz)**: Systematic sign error (values have opposite signs)
- **Moderate delay diff (2-5 km)**: Systematic offset (extrapolation or timing issue)
- **Low differences**: Methods agree (either both wrong or both right)

---

## Step 5: Examine Specific Discrepancies

### Command
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.largest_discrepancies[0]'
```

### Expected Output
```json
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
```

### Critical Check: Doppler Sign Flip

Look at `doppler_legacy` vs `doppler_new`:

✅ **Opposite signs** (one negative, one positive): **SIGN ERROR CONFIRMED**
```
doppler_legacy: -594.90
doppler_new:     600.55
→ Sign error in new method
```

❌ **Same sign**: Sign error not present (unexpected)

### Understanding the Values
- **delay_diff**: Difference in bistatic range (km)
- **doppler_diff**: Difference in bistatic Doppler (Hz)
- Large doppler_diff with opposite signs = systematic sign error

---

## Step 6: Visual Verification (MOST IMPORTANT)

### Open in Browser
```
https://radar3.retnode.com/display/maxhold
```

### What to Look For

**🔴 BEFORE FIX (Expected Now)**:
- **Green ADSB dots** and **orange radar dots** are **NOT aligned**
- Green dots appear in wrong locations relative to orange
- Some green dots may have **no corresponding orange dots**

**✅ AFTER FIX (Goal)**:
- Green ADSB dots **overlay exactly** on orange radar dots
- When aircraft is detected (orange), green dot is in same location
- Perfect alignment across all aircraft

### Take Screenshots
1. **Before fix**: Capture current misalignment
2. **After fix**: Compare to verify improvement

This is the ultimate test - if dots align, the bug is fixed.

---

## Step 7: Monitor Over Time

### Continuous Monitoring
```bash
# Watch comparison stats update every 30 seconds
watch -n 30 'curl -s https://radar3.retnode.com/api/adsb2dd | jq ".comparison | {aircraft: .total_aircraft.both, delay: .avg_delay_diff, doppler: .avg_doppler_diff}"'
```

### Expected Behavior
- Aircraft counts fluctuate (aircraft come and go)
- avg_delay_diff stays relatively stable (~3-4 km)
- avg_doppler_diff stays high (~600-800 Hz)

### Red Flags
⚠️ **avg_doppler_diff drops to near zero**: Something changed unexpectedly
⚠️ **both = 0 for extended period**: No matching aircraft (unusual)
⚠️ **Endpoint stops responding**: Service crashed

---

## Step 8: Collect Diagnostic Snapshots

### Capture Data for Analysis
```bash
# Collect 20 snapshots over 10 minutes
for i in {1..20}; do
  echo "Snapshot $i"
  curl -s https://radar3.retnode.com/api/adsb2dd >> diagnostic_radar3.jsonl
  sleep 30
done

# Analyze average discrepancies
jq -s 'map(.comparison) | {
  avg_delay: (map(.avg_delay_diff) | add / length),
  avg_doppler: (map(.avg_doppler_diff) | add / length),
  samples: length
}' diagnostic_radar3.jsonl
```

### What Good Data Looks Like
```json
{
  "avg_delay": 3.45,
  "avg_doppler": 735.82,
  "samples": 20
}
```

Save this baseline for comparison after fixing the bug.

---

## Troubleshooting

### Issue: Diagnostic mode not active

**Symptom**: `.method != "diagnostic"`

**Check**:
```bash
# SSH to radar3
ssh radar3

# Check config
docker exec blah2_api cat /opt/blah2/config/config.yml | grep -A 5 "adsb:"
```

**Expected**:
```yaml
adsb:
  diagnostic_mode: true
```

**Fix**:
```bash
# Edit config
vi config/config.yml
# Set diagnostic_mode: true

# Restart
docker compose restart blah2_api
```

---

### Issue: Legacy method returns 0 aircraft

**Symptom**: `.comparison.total_aircraft.legacy = 0`

**Cause**: adsb2dd service needs initialization

**Check**:
```bash
# Check adsb2dd service status
docker ps | grep adsb2dd

# Check adsb2dd logs
docker logs adsb2dd | tail -20
```

**Fix**:
```bash
# Restart adsb2dd service
docker restart adsb2dd

# Wait 30 seconds
sleep 30

# Test again
curl https://radar3.retnode.com/api/adsb2dd | jq '.comparison.total_aircraft'
```

---

### Issue: New method returns 0 aircraft

**Symptom**: `.comparison.total_aircraft.new = 0`

**Cause**: tar1090 connection issue

**Check**:
```bash
# Test tar1090 directly
curl -s https://sfo1.retnode.com/data/aircraft.json | jq '.aircraft | length'
```

**Expected**: Should return > 0

**Fix**: Verify tar1090 URL in config.yml, check network connectivity

---

### Issue: Endpoint returns empty object `{}`

**Symptom**: `curl .../api/adsb2dd` returns `{}`

**Cause**: Error in endpoint code or ADSB disabled

**Check logs**:
```bash
docker logs blah2_api | tail -50
```

**Look for**:
- JavaScript errors
- "Error in /api/adsb2dd"
- Config loading errors

---

### Issue: High CPU usage

**Symptom**: System slow, high CPU load

**Cause**: Diagnostic mode runs both methods (2x CPU)

**Expected**: This is normal for diagnostic mode

**Monitor**:
```bash
# Check CPU usage
docker stats blah2_api

# Should see ~2x normal CPU
```

**Fix if needed**:
```yaml
# Disable diagnostic mode after collecting data
diagnostic_mode: false
```

---

## Success Criteria Summary

After deployment, you should observe:

| Check | Expected Result | What it Confirms |
|-------|----------------|------------------|
| `.method` | `"diagnostic"` | Diagnostic mode enabled |
| `.comparison.total_aircraft.legacy` | `> 30` | Legacy method working |
| `.comparison.total_aircraft.new` | `> 30` | New method working |
| `.comparison.avg_doppler_diff` | `> 500` Hz | Doppler sign error detected |
| `.comparison.avg_delay_diff` | `2-5` km | Delay offset detected |
| Largest discrepancy doppler signs | Opposite | Confirms sign error |
| Visual alignment | Misaligned | Bug still present (expected) |

**If all checks pass**: ✅ Deployment successful, diagnostic mode working, bug confirmed

**Next step**: Use the diagnostic data to identify and fix the doppler sign error in `bistatic.js`

---

## When to Disable Diagnostic Mode

Diagnostic mode is for **temporary debugging**, not permanent use.

**Disable when**:
1. ✅ Collected 20-50 diagnostic snapshots
2. ✅ Confirmed the bug pattern (sign error, offset)
3. ✅ Identified specific discrepancies
4. ✅ Ready to implement the fix

**How to disable**:
```yaml
# config.yml
diagnostic_mode: false
```

This will:
- Stop running legacy method
- Reduce CPU usage by ~50%
- Return to normal operation (new method only)

---

## Timeline

**Immediately after deploy (0-5 minutes)**:
- Verify diagnostic mode active
- Check both methods return data
- Confirm high doppler difference

**First hour**:
- Monitor visual alignment (still misaligned - expected)
- Collect 10-20 snapshots
- Verify consistent discrepancy pattern

**After collecting data**:
- Analyze patterns
- Identify aircraft with worst discrepancies
- Use data to guide bug fix

**After fixing bug**:
- Deploy fix
- Re-enable diagnostic mode
- Verify avg_doppler_diff < 10 Hz
- Verify visual alignment improved
- Disable diagnostic mode

---

## Quick Verification Script

Save this as `verify_deployment.sh`:

```bash
#!/bin/bash
# Quick deployment verification for radar3

echo "━━━ Deployment Verification ━━━"
echo

echo "1. Check diagnostic mode active..."
MODE=$(curl -s https://radar3.retnode.com/api/adsb2dd | jq -r '.method')
if [ "$MODE" = "diagnostic" ]; then
  echo "   ✅ Diagnostic mode: ACTIVE"
else
  echo "   ❌ Diagnostic mode: NOT ACTIVE (got: $MODE)"
  exit 1
fi

echo
echo "2. Check aircraft counts..."
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.total_aircraft'

echo
echo "3. Check discrepancies..."
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison | {avg_delay_diff, avg_doppler_diff}'

echo
echo "4. Check top discrepancy..."
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.largest_discrepancies[0] | {hex, flight, doppler_legacy, doppler_new, doppler_diff}'

echo
echo "━━━ Verification Complete ━━━"
echo
echo "Next steps:"
echo "  1. Check https://radar3.retnode.com/display/maxhold for visual alignment"
echo "  2. Collect diagnostic snapshots (see DEPLOYMENT_VERIFICATION.md)"
echo "  3. Use data to fix doppler sign error in bistatic.js"
```

Run with:
```bash
bash verify_deployment.sh
```

---

## Contact & Support

If verification fails:
1. Check troubleshooting section above
2. Review logs: `docker logs blah2_api`
3. Check PR #28 description for additional context
4. Review DIAGNOSTIC_MODE.md for detailed usage

**Remember**: The goal is to **confirm the bug exists** (high doppler diff, visual misalignment), then use the diagnostic data to guide the fix.
