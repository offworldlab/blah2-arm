/**
 * Bistatic radar geometry calculations
 *
 * Delegates to bistatic.js (ECEF/WGS84) for accurate calculations.
 * This module adapts the (lat, lon, alt) interface used by extrapolation.js
 * to the bistatic.js interface.
 *
 * Previously used haversine (spherical Earth) approximation which introduced
 * position-dependent errors and omitted vertical velocity from Doppler.
 */

const bistatic = require('../bistatic');

function calculateBistaticDelay(aircraftPos, rxPos, txPos) {
  const aircraft = {
    lat: aircraftPos.lat,
    lon: aircraftPos.lon,
    alt_geom: aircraftPos.alt  // feet (from extrapolation.js)
  };
  const rx = {
    latitude: rxPos.lat,
    longitude: rxPos.lon,
    altitude: rxPos.alt        // meters (from config)
  };
  const tx = {
    latitude: txPos.lat,
    longitude: txPos.lon,
    altitude: txPos.alt        // meters (from config)
  };

  const result = bistatic.computeBistaticDelay(aircraft, rx, tx);
  return result !== null ? result : 0;
}

function calculateBistaticDoppler(aircraftPos, aircraftVel, rxPos, txPos, frequency) {
  const aircraft = {
    lat: aircraftPos.lat,
    lon: aircraftPos.lon,
    alt_geom: aircraftPos.alt, // feet (from extrapolation.js)
    gs: aircraftVel.gs,
    track: aircraftVel.track,
    geom_rate: aircraftVel.geom_rate
  };
  const rx = {
    latitude: rxPos.lat,
    longitude: rxPos.lon,
    altitude: rxPos.alt        // meters (from config)
  };
  const tx = {
    latitude: txPos.lat,
    longitude: txPos.lon,
    altitude: txPos.alt        // meters (from config)
  };

  const result = bistatic.computeBistaticDoppler(aircraft, rx, tx, frequency);
  return result !== null ? result : 0;
}

module.exports = {
  calculateBistaticDelay,
  calculateBistaticDoppler
};
