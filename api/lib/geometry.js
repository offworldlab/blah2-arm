/**
 * Bistatic radar geometry calculations
 */

function haversineDistance(pos1, pos2) {
  const R = 6371000; // Earth radius in meters
  
  const lat1Rad = pos1.lat * Math.PI / 180;
  const lat2Rad = pos2.lat * Math.PI / 180;
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLon = (pos2.lon - pos1.lon) * Math.PI / 180;
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c; // meters
}

function calculateBistaticDelay(aircraftPos, rxPos, txPos) {
  let dRxAircraft = haversineDistance(rxPos, aircraftPos);
  let dTxAircraft = haversineDistance(txPos, aircraftPos);
  let dRxTx = haversineDistance(rxPos, txPos);
  
  const altRx = rxPos.alt || 0;
  const altTx = txPos.alt || 0;
  const altAircraft = aircraftPos.alt || 0;
  
  dRxAircraft = Math.sqrt(dRxAircraft**2 + (altAircraft - altRx)**2);
  dTxAircraft = Math.sqrt(dTxAircraft**2 + (altAircraft - altTx)**2);
  dRxTx = Math.sqrt(dRxTx**2 + (altTx - altRx)**2);
  
  const bistaticRange = dRxAircraft + dTxAircraft - dRxTx;
  
  return bistaticRange / 1000; // Convert to kilometers
}

function calculateBearing(pos1, pos2) {
  const lat1 = pos1.lat * Math.PI / 180;
  const lat2 = pos2.lat * Math.PI / 180;
  const dLon = (pos2.lon - pos1.lon) * Math.PI / 180;
  
  const x = Math.sin(dLon) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - 
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  
  return Math.atan2(x, y);
}

function calculateBistaticDoppler(aircraftPos, aircraftVel, rxPos, txPos, frequency) {
  const gsMs = (aircraftVel.gs || 0) * 0.514444;
  const trackRad = (aircraftVel.track || 0) * Math.PI / 180;
  
  const vx = gsMs * Math.sin(trackRad);
  const vy = gsMs * Math.cos(trackRad);
  
  const bearingToRx = calculateBearing(aircraftPos, rxPos);
  const bearingToTx = calculateBearing(aircraftPos, txPos);
  
  const vRadialRx = -(vx * Math.sin(bearingToRx) + vy * Math.cos(bearingToRx));
  const vRadialTx = -(vx * Math.sin(bearingToTx) + vy * Math.cos(bearingToTx));
  
  const c = 299792458;
  const doppler = (vRadialRx + vRadialTx) * frequency / c;
  
  return doppler;
}

module.exports = {
  haversineDistance,
  calculateBistaticDelay,
  calculateBistaticDoppler
};
