# Remote Deployment Verification

## Verify radar3 deployment from your local machine ONLY

**No SSH required. No scripts on production.**

All commands below run on your **local machine** and query radar3 remotely via HTTPS.

---

## Quick Verification (1 minute)

Copy and paste these commands into your **local terminal**:

### 1. Check diagnostic mode is active
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.method'
```

**Expected**: `"diagnostic"`
**Means**: ✅ Diagnostic mode is running

---

### 2. Check both methods return data
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.total_aircraft'
```

**Expected**:
```json
{
  "legacy": 45,
  "new": 52,
  "both": 42,
  "legacy_only": 3,
  "new_only": 10
}
```

**What to check**:
- ✅ `legacy > 30`: Legacy method working
- ✅ `new > 30`: New method working
- ✅ `both > 30`: Good overlap for comparison

⚠️ If `legacy = 0`, wait 30 seconds (adsb2dd initialization) and retry

---

### 3. Check for the doppler sign error
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison | {avg_delay_diff, avg_doppler_diff}'
```

**Expected**:
```json
{
  "avg_delay_diff": 3.38,
  "avg_doppler_diff": 717.26
}
```

**What to check**:
- ✅ `avg_doppler_diff > 500`: **BUG DETECTED** (sign error present)
- ✅ `avg_delay_diff 2-5`: Delay offset present

**If `avg_doppler_diff < 50`**: Bug not detected (unexpected)

---

### 4. Verify sign flip in specific aircraft
```bash
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.largest_discrepancies[0] | {hex, flight, doppler_legacy, doppler_new}'
```

**Expected** (notice opposite signs):
```json
{
  "hex": "a2fe8f",
  "flight": "SKW3789 ",
  "doppler_legacy": -594.90,
  "doppler_new": 600.55
}
```

**Critical check**:
- ✅ **Opposite signs** (one negative, one positive) = **SIGN ERROR CONFIRMED**

---

### 5. Visual verification (browser)

Open in your **local browser**:
```
https://radar3.retnode.com/display/maxhold
```

**What to look for**:
- 🔴 **Green ADSB dots NOT aligned** with orange radar dots
- Green dots in wrong positions relative to orange

**This confirms the bug visually**

---

## Continuous Monitoring (from local machine)

### Watch comparison update every 30 seconds
```bash
watch -n 30 'curl -s https://radar3.retnode.com/api/adsb2dd | jq ".comparison | {aircraft: .total_aircraft.both, delay: .avg_delay_diff, doppler: .avg_doppler_diff}"'
```

Press `Ctrl+C` to stop.

**Healthy output**:
```json
{
  "aircraft": 42,
  "delay": 3.38,
  "doppler": 717.26
}
```

- Aircraft count fluctuates (30-60)
- Delay stays ~3-4 km
- Doppler stays ~600-800 Hz

---

## Collect Diagnostic Data (from local machine)

### Save 20 snapshots over 10 minutes
```bash
cd /tmp
for i in {1..20}; do
  echo "Snapshot $i/20"
  curl -s https://radar3.retnode.com/api/adsb2dd >> radar3_diagnostic.jsonl
  sleep 30
done
echo "Done! Saved to /tmp/radar3_diagnostic.jsonl"
```

### Analyze the snapshots
```bash
jq -s 'map(.comparison) | {
  avg_delay: (map(.avg_delay_diff) | add / length),
  avg_doppler: (map(.avg_doppler_diff) | add / length),
  samples: length
}' /tmp/radar3_diagnostic.jsonl
```

**Expected**:
```json
{
  "avg_delay": 3.45,
  "avg_doppler": 735.82,
  "samples": 20
}
```

**Save this file** for later comparison after fixing the bug.

---

## Automated Quick Check Script (runs locally)

The `QUICK_VERIFY.sh` script **already runs locally** - it only uses curl to query radar3:

```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm
bash QUICK_VERIFY.sh
```

This script:
- ✅ Runs on your local machine
- ✅ Queries radar3 via HTTPS
- ✅ Never SSHs to production
- ✅ Gives pass/fail summary

**Safe to run anytime.**

---

## Troubleshooting (all from local machine)

### Issue: Diagnostic mode not active

**Check config was deployed**:
```bash
# This assumes you have docker context or kubectl access
# If not, skip this and just verify the endpoint works
curl -s https://radar3.retnode.com/api/config | jq '.truth.adsb | {diagnostic_mode, use_legacy_method}'
```

**Expected**:
```json
{
  "diagnostic_mode": true,
  "use_legacy_method": false
}
```

**If diagnostic_mode is false**: Config wasn't deployed correctly

---

### Issue: Legacy method returns 0 aircraft

**Wait and retry**:
```bash
echo "Waiting for adsb2dd initialization (30 seconds)..."
sleep 30
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.total_aircraft.legacy'
```

**Expected**: Should now be > 0

**If still 0**: adsb2dd service may be down (would need to check logs via deployment system)

---

### Issue: Both methods return 0 aircraft

**Check tar1090 directly**:
```bash
curl -s https://sfo1.retnode.com/data/aircraft.json | jq '.aircraft | length'
```

**Expected**: > 0

**If 0**: tar1090 is down or not receiving data

---

### Issue: Endpoint returns `{}`

**Check endpoint is responding**:
```bash
curl -s -w "\nHTTP: %{http_code}\n" https://radar3.retnode.com/api/adsb2dd | head -5
```

**Expected**: Shows JSON data + `HTTP: 200`

**If HTTP 400 or 500**: Service error (would need logs)

---

## Success Checklist (all checkable from local machine)

Run these commands **from your local terminal**:

```bash
# 1. Check diagnostic mode
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.method'
# Expected: "diagnostic" ✅

# 2. Check aircraft counts
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.total_aircraft | {legacy, new, both}'
# Expected: all > 30 ✅

# 3. Check doppler difference
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.avg_doppler_diff'
# Expected: > 500 ✅

# 4. Check sign flip
curl -s https://radar3.retnode.com/api/adsb2dd | jq '.comparison.largest_discrepancies[0] | {doppler_legacy, doppler_new}'
# Expected: opposite signs ✅

# 5. Visual check
open https://radar3.retnode.com/display/maxhold
# Expected: dots misaligned ✅
```

**If all pass**: ✅ Deployment successful, diagnostic mode working!

---

## One-Line Verification

Copy-paste this single command for complete check:

```bash
echo "=== Diagnostic Mode Status ===" && \
curl -s https://radar3.retnode.com/api/adsb2dd | jq '{
  mode: .method,
  aircraft: .comparison.total_aircraft,
  differences: {
    delay_km: .comparison.avg_delay_diff,
    doppler_hz: .comparison.avg_doppler_diff
  },
  top_discrepancy: .comparison.largest_discrepancies[0] | {
    hex, flight,
    doppler_legacy,
    doppler_new,
    sign_error: ((.doppler_legacy < 0) != (.doppler_new < 0))
  }
}'
```

**Expected output**:
```json
{
  "mode": "diagnostic",
  "aircraft": {
    "legacy": 45,
    "new": 52,
    "both": 42
  },
  "differences": {
    "delay_km": 3.38,
    "doppler_hz": 717.26
  },
  "top_discrepancy": {
    "hex": "a2fe8f",
    "flight": "SKW3789",
    "doppler_legacy": -594.9,
    "doppler_new": 600.55,
    "sign_error": true
  }
}
```

**Look for**:
- ✅ `"mode": "diagnostic"`
- ✅ `"aircraft.both" > 30`
- ✅ `"doppler_hz" > 500`
- ✅ `"sign_error": true`

---

## After Deployment Workflow

**From your local machine**:

1. **Immediate check** (1 minute):
   ```bash
   bash QUICK_VERIFY.sh
   ```

2. **Visual verification** (30 seconds):
   ```
   Open https://radar3.retnode.com/display/maxhold
   Check: dots misaligned (expected)
   ```

3. **Collect diagnostics** (10 minutes):
   ```bash
   # Run the snapshot collection script above
   # Saves to /tmp/radar3_diagnostic.jsonl
   ```

4. **Monitor over time** (optional):
   ```bash
   watch -n 30 'curl -s https://radar3.retnode.com/api/adsb2dd | jq .comparison'
   ```

**All from your laptop. No production access needed.**

---

## What You're Looking For

### ✅ SUCCESS indicators:
1. Diagnostic mode active (`"diagnostic"`)
2. Both methods returning 30-60 aircraft
3. **High doppler difference** (500-800 Hz)
4. **Opposite doppler signs** in discrepancies
5. **Visual misalignment** on maxhold display

### ❌ FAILURE indicators:
1. Mode is not "diagnostic" → Config not deployed
2. Legacy = 0 after 1 minute → adsb2dd down
3. New = 0 → tar1090 connection issue
4. Low doppler diff (<50 Hz) → Bug not detected (unexpected)
5. Endpoint returns `{}` → Service error

---

## Response Time Check

From your local machine:
```bash
time curl -s https://radar3.retnode.com/api/adsb2dd > /dev/null
```

**Expected**: 0.5 - 2 seconds (diagnostic mode is slower)

**If > 5 seconds**: Performance issue (may need to disable diagnostic mode)

---

## Summary

**You can verify the entire deployment using only:**
1. `curl` commands from your local terminal
2. `jq` to parse JSON responses
3. Your browser to check visual alignment

**No SSH required. No scripts on production. All queries are read-only HTTPS requests.**

The deployment is successful if:
- Diagnostic mode is active
- Both methods return data
- Doppler difference is high (500-800 Hz)
- Visual dots are misaligned

This confirms the bug exists and diagnostic mode is capturing it for analysis!
