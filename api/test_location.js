// Tests for location.js — the guard that decides whether ADS-B truth runs.
//
// A correctness gate rather than a convenience: when it wrongly says yes,
// lla2ecef produces NaN geometry and the association silently matches nothing.

const assert = require('assert');
const { hasLocation, isPosition, isCoordinate } = require('./location.js');

const REAL = {
  location: {
    rx: { latitude: 42.241528, longitude: -72.648361, altitude: 619.2 },
    tx: { latitude: 42.084722, longitude: -72.703333, altitude: 446.0 }
  }
};

const NULLED = {
  location: {
    rx: { latitude: null, longitude: null, altitude: null, name: null },
    tx: { latitude: null, longitude: null, altitude: null, name: null }
  }
};

function testAConfiguredNodeHasALocation() {
  assert.strictEqual(hasLocation(REAL), true);
  console.log('  ✓ a configured node has a location');
}

function testTheShippedNullDefaultHasNone() {
  assert.strictEqual(hasLocation(NULLED), false);
  console.log('  ✓ the shipped null default has no location');
}

function testHalfALocationIsNone() {
  // A receiver with no illuminator gives no bistatic geometry at all.
  assert.strictEqual(
    hasLocation({ location: { rx: REAL.location.rx, tx: NULLED.location.tx } }), false);
  assert.strictEqual(
    hasLocation({ location: { rx: NULLED.location.rx, tx: REAL.location.tx } }), false);
  console.log('  ✓ half a location is not a location');
}

function testAMissingAltitudeIsNotSeaLevel() {
  const noAlt = JSON.parse(JSON.stringify(REAL));
  delete noAlt.location.rx.altitude;
  assert.strictEqual(hasLocation(noAlt), false);
  console.log('  ✓ a missing altitude is a partial config, not sea level');
}

function testNullIslandIsARealPlace() {
  // 0,0 set by an owner is a choice. A truthiness check would strand that node.
  assert.strictEqual(hasLocation({
    location: {
      rx: { latitude: 0, longitude: 0, altitude: 0 },
      tx: { latitude: 0, longitude: 0, altitude: 0 }
    }
  }), true);
  console.log('  ✓ 0,0,0 counts as configured');
}

function testMalformedConfigsDoNotThrow() {
  // Called on every detection frame, so throwing here takes out the API
  // everything else on the node polls.
  for (const bad of [undefined, null, {}, { location: null }, { location: {} },
                     { location: { rx: null, tx: null } },
                     { location: { rx: 'nope', tx: 'nope' } }]) {
    assert.strictEqual(hasLocation(bad), false);
  }
  console.log('  ✓ malformed configs return false rather than throwing');
}

function testNonNumericCoordinatesAreRejected() {
  // A string survives a null check but becomes NaN in lla2ecef, which is the
  // silent failure this guard exists to prevent.
  assert.strictEqual(isCoordinate('not a number'), false);
  assert.strictEqual(isCoordinate(NaN), false);
  assert.strictEqual(isCoordinate(0), true);
  assert.strictEqual(isPosition({ latitude: 1, longitude: 'x', altitude: 3 }), false);
  console.log('  ✓ non-numeric coordinates are rejected');
}

function runTests() {
  console.log('Testing location.js');
  try {
    testAConfiguredNodeHasALocation();
    testTheShippedNullDefaultHasNone();
    testHalfALocationIsNone();
    testAMissingAltitudeIsNotSeaLevel();
    testNullIslandIsARealPlace();
    testMalformedConfigsDoNotThrow();
    testNonNumericCoordinatesAreRejected();
    console.log('\nAll tests passed! ✓');
  } catch (e) {
    console.error('\nTest failed:');
    console.error(e.message);
    process.exit(1);
  }
}

runTests();
