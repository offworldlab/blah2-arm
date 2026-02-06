#!/usr/bin/env node
/**
 * Test extrapolation with tar1090-style data format
 */

const { extrapolateAdsbData } = require('./lib/extrapolation');

console.log('='.repeat(70));
console.log('tar1090 Data Format Extrapolation Test');
console.log('='.repeat(70));

// Simulate tar1090 aircraft data format
const adsbData = {
  'a12345': {
    hex: 'a12345',
    flight: 'TEST123',
    timestamp: Date.now() / 1000 - 4,  // 4 seconds ago
    lat: 51.5,
    lon: -0.1,
    alt_geom: 10000,
    gs: 300,
    track: 90,
    geom_rate: 0
  },
  'b67890': {
    hex: 'b67890',
    flight: 'TEST456',
    timestamp: Date.now() / 1000 - 3.5,  // 3.5 seconds ago
    lat: 40.0,
    lon: -74.0,
    alt_geom: 5000,
    gs: 200,
    track: 0,
    geom_rate: 500
  }
};

console.log('\nOriginal aircraft data:');
for (const [hex, ac] of Object.entries(adsbData)) {
  const age = Date.now() / 1000 - ac.timestamp;
  console.log(`  ${hex}: age=${age.toFixed(1)}s, lat=${ac.lat}, lon=${ac.lon}, gs=${ac.gs}, track=${ac.track}`);
}

// Extrapolate to current time
const detectionTimestamp = Date.now() / 1000;
console.log(`\nExtrapolating to detection timestamp: ${detectionTimestamp.toFixed(1)}`);

const rxPos = { lat: 51.0, lon: 0.0, alt: 100 };
const txPos = { lat: 51.5, lon: 0.5, alt: 100 };
const frequency = 100e6;

const synchronized = extrapolateAdsbData(
  adsbData,
  detectionTimestamp,
  rxPos,
  txPos,
  frequency
);

console.log('\nExtrapolated results:');
for (const [hex, ac] of Object.entries(synchronized)) {
  if (ac.extrapolated) {
    console.log(`  ${hex}: ✓ extrapolated, lat=${ac.lat.toFixed(6)}, lon=${ac.lon.toFixed(6)}, delay=${ac.delay.toFixed(2)}km`);
  } else {
    console.log(`  ${hex}: ✗ not extrapolated (missing velocity)`);
  }
}

console.log('='.repeat(70));
