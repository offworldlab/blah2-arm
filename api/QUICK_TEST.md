# Quick Local Testing Guide

## Prerequisites

✅ Dependencies installed:
```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm/api
npm install
```

✅ adsb2dd service running:
```bash
docker ps | grep adsb2dd
# Should show: adsb2dd-test running
```

## Test 1: New Method (tar1090 + extrapolation)

```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm/api

# Start server with new method (default)
node server.js ../config/config.yml &
SERVER_PID=$!

# Wait for startup
sleep 2

# Test endpoint
curl -s http://localhost:3000/api/adsb2dd | jq 'keys | length'
# Expected: ~50-100 aircraft

# Sample aircraft
curl -s http://localhost:3000/api/adsb2dd | jq 'to_entries[0]'

# Stop server
kill $SERVER_PID
```

## Test 2: Legacy Method (adsb2dd service)

**IMPORTANT:** adsb2dd requires TWO calls - first initializes, second returns data.

```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm/api

# Start server with legacy method
node server.js ../config/config_test_legacy.yml &
SERVER_PID=$!

# Wait for startup
sleep 2

# First call (initializes adsb2dd)
curl -s http://localhost:3000/api/adsb2dd > /dev/null
echo "First call done (initialization)"

# Wait for adsb2dd to fetch data
sleep 3

# Second call (returns data)
curl -s http://localhost:3000/api/adsb2dd | jq 'keys | length'
# Expected: ~50-100 aircraft

# Sample aircraft
curl -s http://localhost:3000/api/adsb2dd | jq 'to_entries[0]'

# Stop server
kill $SERVER_PID
```

## Test 3: Compare Both Methods

```bash
cd /Users/jonnyspicer/repos/retina/blah2-arm/api

# Test new method
node server.js ../config/config.yml >/dev/null 2>&1 &
NEW_PID=$!
sleep 2
curl -s http://localhost:3000/api/adsb2dd > /tmp/new_method.json
kill $NEW_PID
sleep 1

# Test legacy method
node server.js ../config/config_test_legacy.yml >/dev/null 2>&1 &
LEGACY_PID=$!
sleep 2
curl -s http://localhost:3000/api/adsb2dd > /dev/null  # Initialize
sleep 3
curl -s http://localhost:3000/api/adsb2dd > /tmp/legacy_method.json  # Get data
kill $LEGACY_PID

# Compare counts
echo "New method: $(jq 'keys | length' /tmp/new_method.json) aircraft"
echo "Legacy method: $(jq 'keys | length' /tmp/legacy_method.json) aircraft"

# Compare same aircraft
AIRCRAFT_HEX=$(jq -r 'keys[0]' /tmp/new_method.json)
echo
echo "Comparing aircraft: $AIRCRAFT_HEX"
echo "New method:"
jq ".\"$AIRCRAFT_HEX\" | {delay, doppler}" /tmp/new_method.json
echo "Legacy method:"
jq ".\"$AIRCRAFT_HEX\" | {delay, doppler}" /tmp/legacy_method.json 2>/dev/null || echo "  (not found)"
```

## Test 4: Direct adsb2dd Service Test

Verify the adsb2dd service works correctly:

```bash
# First call (initialize)
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" >/dev/null

# Wait
sleep 3

# Second call (get data)
curl -s "http://localhost:49155/api/dd?server=http://sfo1.retnode.com&rx=37.7644,-122.3954,23&tx=37.49917,-121.87222,783&fc=503" | jq 'to_entries[0]'

# Expected format:
# {
#   "key": "a12345",
#   "value": {
#     "timestamp": 1234567890.123,
#     "flight": "UAL123  ",
#     "delay": "45.32",
#     "doppler": "-123.5"  (optional, may not be present)
#   }
# }
```

## Expected Output Formats

### New Method
```json
{
  "a12345": {
    "hex": "a12345",
    "flight": "UAL123  ",
    "timestamp": 1770503510.208,
    "lat": 37.7644,
    "lon": -122.3954,
    "alt_geom": 5000,
    "alt_baro": 4800,
    "gs": 250.5,
    "track": 45.2,
    "delay": 45.35,
    "doppler": -123.8,
    "extrapolated": true
  }
}
```

### Legacy Method
```json
{
  "a12345": {
    "timestamp": 1770503510.208,
    "flight": "UAL123  ",
    "delay": "45.32"
  }
}
```

**Note**: Legacy method may not include doppler field.

## Troubleshooting

### "No aircraft data returned"
- adsb2dd needs to be called TWICE (first initializes)
- Wait 3+ seconds between calls
- Check tar1090 has data: `curl http://sfo1.retnode.com/data/aircraft.json | jq '.aircraft | length'`

### Port already in use
```bash
# Kill any running node processes
pkill -f "node server.js"

# Or kill specific PID
kill $SERVER_PID
```

### adsb2dd service not running
```bash
cd /Users/jonnyspicer/repos/retina/local-radar-test
docker compose up -d
```

## Next Steps

After successful local testing:

1. **Deploy to radar3** with `use_legacy_method: true`
2. **Visual verification**: Check if green ADSB dots align with orange radar dots
3. **Switch to new method**: Set `use_legacy_method: false`
4. **Compare**: Identify any alignment differences

See `TESTING_AB.md` for detailed deployment testing instructions.
