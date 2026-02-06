#!/usr/bin/env node
/**
 * Test timestamp unit conversion (milliseconds to seconds)
 */

const { extrapolatePosition, extrapolateAdsbData } = require('./lib/extrapolation');

console.log('='.repeat(70));
console.log('Timestamp Unit Conversion Test');
console.log('='.repeat(70));

// Simulate adsb2dd data with millisecond timestamps
const adsbData = {
  'a12345': {
    hex: 'a12345',
    flight: 'TEST123',
    timestamp: 1718747745000,  // milliseconds (as returned by adsb2dd)
    lat: 51.5,
    lon: -0.1,
    alt_geom: 10000,
    gs: 300,
    track: 90,
    geom_rate: 0,
    delay: 50.0,
    doppler: 100.0
  }
};

console.log('\nOriginal ADSB data (with millisecond timestamp):');
console.log('  Timestamp:', adsbData['a12345'].timestamp);
console.log('  Expected format: milliseconds (13 digits)');

// Simulate the conversion that happens in server.js
for (const hexId in adsbData) {
  if (adsbData[hexId].timestamp) {
    adsbData[hexId].timestamp = adsbData[hexId].timestamp / 1000;
  }
}

console.log('\nAfter conversion (seconds):');
console.log('  Timestamp:', adsbData['a12345'].timestamp);
console.log('  Expected format: seconds (10 digits)');

// Simulate detection timestamp (in milliseconds, then converted)
const detectionTimestampMs = 1718747749000;  // 4 seconds later
const detectionTimestamp = detectionTimestampMs / 1000;

console.log('\nDetection timestamp:');
console.log('  Original (ms):', detectionTimestampMs);
console.log('  Converted (s):', detectionTimestamp);

// Calculate time delta
const dt = detectionTimestamp - adsbData['a12345'].timestamp;
console.log('\nTime delta:', dt, 'seconds');
console.log('Expected: ~4 seconds');

// Test extrapolation
const aircraft = adsbData['a12345'];
const extrapolated = extrapolatePosition(aircraft, detectionTimestamp);

if (extrapolated) {
  console.log('\n✓ Extrapolation succeeded!');
  console.log('  Original position: lat=' + aircraft.lat.toFixed(6) + ', lon=' + aircraft.lon.toFixed(6));
  console.log('  Extrapolated position: lat=' + extrapolated.lat.toFixed(6) + ', lon=' + extrapolated.lon.toFixed(6));
  console.log('  Delta: Δlat=' + (extrapolated.lat - aircraft.lat).toFixed(6) +
              ', Δlon=' + (extrapolated.lon - aircraft.lon).toFixed(6));

  // Verify the delta makes sense (300 knots ≈ 154 m/s, 4 seconds ≈ 616m ≈ 0.0074° longitude)
  const expectedDeltaLon = 0.007;
  const actualDeltaLon = Math.abs(extrapolated.lon - aircraft.lon);
  if (Math.abs(actualDeltaLon - expectedDeltaLon) < 0.002) {
    console.log('\n✓ Position delta is correct!');
  } else {
    console.log('\n✗ Position delta is incorrect (expected ~' + expectedDeltaLon + ')');
  }
} else {
  console.log('\n✗ Extrapolation failed (dt > 5.0 or missing velocity)');
  console.log('  This indicates the timestamp units are still mismatched!');
}

console.log('='.repeat(70));
