/**
 * ADSB position extrapolation for timestamp synchronization
 */

const { calculateBistaticDelay, calculateBistaticDoppler } = require('./geometry');

function extrapolatePosition(aircraft, targetTimestamp) {
  const dt = targetTimestamp - (aircraft.timestamp || 0);
  
  if (Math.abs(dt) > 5.0 || !aircraft.gs || aircraft.track === null || aircraft.track === undefined) {
    return null;
  }
  
  const velocityMs = aircraft.gs * 0.514444;
  const trackRad = aircraft.track * Math.PI / 180;
  
  const dx = velocityMs * Math.sin(trackRad) * dt;
  const dy = velocityMs * Math.cos(trackRad) * dt;
  const dz = (aircraft.geom_rate || 0) * 0.00508 * dt;
  
  const latRad = aircraft.lat * Math.PI / 180;
  const newLat = aircraft.lat + (dy / 111320);
  const newLon = aircraft.lon + (dx / (111320 * Math.cos(latRad)));
  const newAlt = (aircraft.alt_geom || 0) + dz;
  
  return {
    lat: newLat,
    lon: newLon,
    alt: newAlt
  };
}

function extrapolateAdsbData(adsbData, detectionTimestamp, rxPos, txPos, frequency) {
  const synchronized = {};
  let stats = { total: 0, extrapolated: 0, failed: 0 };
  
  for (const [hexId, aircraft] of Object.entries(adsbData)) {
    stats.total++;
    
    const extrapolatedPos = extrapolatePosition(aircraft, detectionTimestamp);
    
    if (extrapolatedPos) {
      stats.extrapolated++;
      
      const syncAircraft = { ...aircraft };
      syncAircraft.lat = extrapolatedPos.lat;
      syncAircraft.lon = extrapolatedPos.lon;
      syncAircraft.alt_geom = extrapolatedPos.alt;
      syncAircraft.timestamp = detectionTimestamp;
      syncAircraft.extrapolated = true;
      
      if (rxPos && txPos) {
        syncAircraft.delay = calculateBistaticDelay(extrapolatedPos, rxPos, txPos);
        
        if (frequency) {
          const velocity = {
            gs: aircraft.gs || 0,
            track: aircraft.track || 0,
            geom_rate: aircraft.geom_rate || 0
          };
          syncAircraft.doppler = calculateBistaticDoppler(
            extrapolatedPos, velocity, rxPos, txPos, frequency
          );
        }
      }
      
      synchronized[hexId] = syncAircraft;
    } else {
      stats.failed++;
      synchronized[hexId] = aircraft;
    }
  }
  
  if (stats.total > 0) {
    const successRate = (stats.extrapolated / stats.total * 100).toFixed(1);
    console.log(`ADSB extrapolation: ${stats.extrapolated}/${stats.total} ` +
                `(${successRate}%) succeeded, ${stats.failed} failed`);
  }
  
  return synchronized;
}

module.exports = {
  extrapolatePosition,
  extrapolateAdsbData
};
