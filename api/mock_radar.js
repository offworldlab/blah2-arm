// Mock radar data generator for testing frontend without radar hardware
// This simulates the map data that would come from the radar processor

function generateMockMapData(detectionPositions = []) {
  // Create a 100x100 delay-doppler map
  const delayBins = 100;
  const dopplerBins = 100;

  // Delay range: -10 to 400 km (realistic for aircraft)
  const delayMin = -10;
  const delayMax = 400;
  const delayStep = (delayMax - delayMin) / delayBins;

  // Doppler range: -200 to 200 Hz (realistic for aircraft)
  const dopplerMin = -200;
  const dopplerMax = 200;
  const dopplerStep = (dopplerMax - dopplerMin) / dopplerBins;

  // Generate delay and doppler axes
  const delay = [];
  for (let i = 0; i < delayBins; i++) {
    delay.push(delayMin + i * delayStep);
  }

  const doppler = [];
  for (let i = 0; i < dopplerBins; i++) {
    doppler.push(dopplerMin + i * dopplerStep);
  }

  // Generate random heatmap data with hotspots at detection locations
  const data = [];
  for (let i = 0; i < dopplerBins; i++) {
    const row = [];
    for (let j = 0; j < delayBins; j++) {
      // Base noise level
      let value = Math.random() * 0.5;

      // Add hotspots at each detection location
      for (const detection of detectionPositions) {
        // Convert detection delay/doppler to bin indices
        const detectionDelayBin = (detection.delay - delayMin) / delayStep;
        const detectionDopplerBin = (detection.doppler - dopplerMin) / dopplerStep;

        // Calculate distance from current bin to detection
        const dist = Math.sqrt(
          Math.pow(j - detectionDelayBin, 2) +
          Math.pow(i - detectionDopplerBin, 2)
        );

        // Add Gaussian hotspot at detection location
        if (dist < 10) {
          value += 12 * Math.exp(-dist / 4);
        }
      }

      row.push(value);
    }
    data.push(row);
  }

  return {
    nRows: dopplerBins,
    nCols: delayBins,
    delay: delay,
    doppler: doppler,
    data: data,
    maxPower: 10.0
  };
}

function generateMockDetections() {
  // Generate a few random detections in realistic ranges
  const numDetections = 3 + Math.floor(Math.random() * 5);

  const delays = [];
  const dopplers = [];
  const snrs = [];

  for (let i = 0; i < numDetections; i++) {
    delays.push(Math.random() * 300 + 20);  // 20 to 320 km
    dopplers.push(Math.random() * 300 - 150);  // -150 to 150 Hz
    snrs.push(20 + Math.random() * 15);  // 20-35 dB
  }

  return {
    timestamp: Date.now(),
    delay: delays,
    doppler: dopplers,
    snr: snrs,
    adsb: delays.map(() => null)  // No ADSB association for mock detections
  };
}

module.exports = {
  generateMockMapData,
  generateMockDetections
};
