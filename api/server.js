const express = require('express');
const net = require("net");
const fs = require('fs');
const yaml = require('js-yaml');
const dns = require('dns');
const http = require('http');
const bistatic = require('./bistatic.js');
const { extrapolateAdsbData } = require('./lib/extrapolation');

// parse config file
var config;
try {
  const file = process.argv[2];
  config = yaml.load(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('Error reading or parsing the YAML file:', e);
}

var stash_map = require('./stash/maxhold.js');
var stash_detection = require('./stash/detection.js');
var stash_iqdata = require('./stash/iqdata.js');
var stash_timing = require('./stash/timing.js');

// TCP client for forwarding detections to external tracker
let trackerSocket = null;
let trackerConnected = false;

function connectToTracker() {
  if (!config.network.tracker_forward?.enabled) return;

  const host = config.network.tracker_forward.host;
  const port = config.network.tracker_forward.port;

  trackerSocket = new net.Socket();

  trackerSocket.connect(port, host, () => {
    console.log(`Connected to tracker at ${host}:${port}`);
    trackerConnected = true;
  });

  trackerSocket.on('error', (err) => {
    console.error(`Tracker connection error: ${err.message}`);
    trackerConnected = false;
  });

  trackerSocket.on('close', () => {
    console.log('Tracker connection closed, reconnecting in 5s...');
    trackerConnected = false;
    setTimeout(connectToTracker, 5000);
  });
}

function forwardToTracker(data) {
  if (trackerConnected && trackerSocket) {
    trackerSocket.write(data);
  }
}

// Initialize tracker connection
connectToTracker();

// constants
const PORT = config.network.ports.api;
// Use '::' for IPv6 dual-stack to support mDNS .local access from IPv6 clients
// (config.network.ip is used by blah2 core for internal TCP connections, not API listen)
const HOST = '::';
var map = '';
var detection = '';
var track = '';
var timestamp = '';
var timing = '';
var iqdata = '';
var data_map;
var data_detection;
var data_tracker;
var data_timestamp;
var data_timing;
var data_iqdata;
var capture = false;

// api server
const app = express();
// header on all requests
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
  next();
});
app.get('/', (req, res) => {
  res.send('Hello World');
});
app.get('/api/map', (req, res) => {
  res.send(map);
});
app.get('/api/detection', (req, res) => {
  res.send(detection);
});
app.get('/api/tracker', (req, res) => {
  res.send(track);
});
app.get('/api/timestamp', (req, res) => {
  res.send(timestamp);
});
app.get('/api/timing', (req, res) => {
  res.send(timing);
});
app.get('/api/iqdata', (req, res) => {
  res.send(iqdata);
});
app.get('/api/config', (req, res) => {
  res.send(config);
});

// stash API
app.get('/stash/map', (req, res) => {
  res.send(stash_map.get_data_map());
});
app.get('/stash/detection', (req, res) => {
  res.send(stash_detection.get_data_detection());
});
app.get('/stash/iqdata', (req, res) => {
  res.send(stash_iqdata.get_data_iqdata());
});
app.get('/stash/timing', (req, res) => {
  res.send(stash_timing.get_data_timing());
});

// read state of capture
app.get('/capture', (req, res) => {
  res.send(capture);
});
// toggle state of capture
app.get('/capture/toggle', (req, res) => {
  capture = !capture;
  res.send('{}');
});
app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});

// tcp listener map
const server_map = net.createServer((socket)=>{
    socket.on("data",(msg)=>{
        data_map = data_map + msg.toString();
        if (data_map.slice(-1) === "}")
        {
          map = data_map;
          data_map = '';
        }
    });
    socket.on("close",()=>{
        console.log("Connection closed.");
    })
});
server_map.listen(config.network.ports.map);

// tcp listener detection
let processingDetection = false;
const server_detection = net.createServer((socket)=>{
  socket.on("data", async (msg)=>{
      data_detection = data_detection + msg.toString();
      if (data_detection.slice(-1) === "}" && !processingDetection)
      {
        processingDetection = true;
        try {
          const det = JSON.parse(data_detection);
          if (config.truth.adsb.enabled) {
            const aircraft = await getCachedAircraft();
            det.adsb = det.delay.map((delay, idx) => {
              const doppler = det.doppler[idx];
              let bestMatch = null;
              let bestScore = Infinity;
              for (const ac of aircraft) {
                if (!ac.lat || !ac.lon || (!ac.alt_geom && !ac.alt_baro)) continue;
                const expected_delay = bistatic.computeBistaticDelay(ac,
                  config.location.rx, config.location.tx);
                const expected_doppler = bistatic.computeBistaticDoppler(ac,
                  config.location.rx, config.location.tx, config.capture.fc);
                if (expected_delay === null || expected_doppler === null) continue;
                const delay_err = Math.abs(delay - expected_delay);
                const doppler_err = Math.abs(doppler - expected_doppler);
                const delay_tol = config.truth.adsb.delay_tolerance || 2.0;
                const doppler_tol = config.truth.adsb.doppler_tolerance || 5.0;
                if (delay_err < delay_tol && doppler_err < doppler_tol) {
                  const score = delay_err / delay_tol + doppler_err / doppler_tol;
                  if (score < bestScore) {
                    bestScore = score;
                    bestMatch = {
                      hex: ac.hex,
                      lat: ac.lat,
                      lon: ac.lon,
                      alt: ac.alt_geom ?? ac.alt_baro,
                      gs: ac.gs,
                      track: ac.track,
                      expected_delay: Math.round(expected_delay * 100) / 100,
                      expected_doppler: Math.round(expected_doppler * 100) / 100,
                      delay_residual: Math.round((delay - expected_delay) * 100) / 100,
                      doppler_residual: Math.round((doppler - expected_doppler) * 100) / 100
                    };
                  }
                }
              }
              return bestMatch;
            });
          }
          detection = JSON.stringify(det);
          // Forward to external tracker if enabled
          forwardToTracker(detection);
        } catch (e) {
          console.error('Detection processing error:', e.message);
          detection = data_detection;
        } finally {
          data_detection = '';
          processingDetection = false;
        }
      }
  });
  socket.on("close",()=>{
      console.log("Connection closed.");
  })
});
server_detection.listen(config.network.ports.detection);

// tcp listener tracker
const server_tracker = net.createServer((socket)=>{
  socket.on("data",(msg)=>{
      data_tracker = data_tracker + msg.toString();
      if (data_tracker.slice(-1) === "}")
      {
        track = data_tracker;
        data_tracker = '';
      }
  });
  socket.on("close",()=>{
      console.log("Connection closed.");
  })
});
server_tracker.listen(config.network.ports.track);

// tcp listener timestamp
const server_timestamp = net.createServer((socket)=>{
  socket.on("data",(msg)=>{
    data_timestamp = data_timestamp + msg.toString();
    timestamp = data_timestamp;
    data_timestamp = '';
  });
  socket.on("close",()=>{
      console.log("Connection closed.");
  })
});
server_timestamp.listen(config.network.ports.timestamp);

// tcp listener timing
const server_timing = net.createServer((socket)=>{
  socket.on("data",(msg)=>{
    data_timing = data_timing + msg.toString();
    if (data_timing.slice(-1) === "}")
    {
      timing = data_timing;
      data_timing = '';
    }
  });
  socket.on("close",()=>{
      console.log("Connection closed.");
  })
});
server_timing.listen(config.network.ports.timing);

// tcp listener iqdata metadata
const server_iqdata = net.createServer((socket)=>{
  socket.on("data",(msg)=>{
    data_iqdata = data_iqdata + msg.toString();
    if (data_iqdata.slice(-1) === "}")
    {
      iqdata = data_iqdata;
      data_iqdata = '';
    }
  });
  socket.on("close",()=>{
      console.log("Connection closed.");
  })
});
server_iqdata.listen(config.network.ports.iqdata);

let aircraftCache = [];
let lastFetchTime = 0;
const CACHE_INTERVAL = 1000;
const HTTP_TIMEOUT = 5000;

async function fetchADSB() {
  if (!config.truth.adsb.enabled) {
    return [];
  }
  const tar1090_url = `http://${config.truth.adsb.tar1090}/data/aircraft.json`;
  return new Promise((resolve) => {
    const req = http.get(tar1090_url, { timeout: HTTP_TIMEOUT }, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.aircraft || []);
        } catch (e) {
          console.error('Error parsing tar1090 response:', e.message);
          resolve([]);
        }
      });
    }).on('error', (err) => {
      console.error('Error fetching from tar1090:', err.message);
      resolve([]);
    });
    req.on('timeout', () => {
      req.destroy();
      console.error('tar1090 request timeout after', HTTP_TIMEOUT, 'ms');
      resolve([]);
    });
  });
}

async function getCachedAircraft() {
  const now = Date.now();
  if (now - lastFetchTime > CACHE_INTERVAL) {
    aircraftCache = await fetchADSB();
    lastFetchTime = now;
  }
  return aircraftCache;
}

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received.');
  process.exit(0);
});

function buildAdsbQuery(api_url, config) {
  const rx_str = `${config.location.rx.latitude},${config.location.rx.longitude},${config.location.rx.altitude}`;
  const tx_str = `${config.location.tx.latitude},${config.location.tx.longitude},${config.location.tx.altitude}`;
  const fc_mhz = Math.round(config.capture.fc / 1000000);
  const server_url = `http://${config.truth.adsb.tar1090}`;

  const params = new URLSearchParams({
    server: server_url,
    rx: rx_str,
    tx: tx_str,
    fc: fc_mhz
  });

  return `${api_url}?${params.toString()}`;
}

async function fetchJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: HTTP_TIMEOUT }, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          console.error('Error parsing response:', e.message);
          resolve({});
        }
      });
    }).on('error', (err) => {
      console.error('HTTP request error:', err.message);
      resolve({});
    });

    req.on('timeout', () => {
      req.destroy();
      console.error('Request timeout after', HTTP_TIMEOUT, 'ms');
      resolve({});
    });
  });
}

async function fetchFromAdsbService() {
  const api_url = "http://" + config.truth.adsb.adsb2dd + "/api/dd";
  const api_query = buildAdsbQuery(api_url, config);
  const response = await fetchJson(api_query);
  return response;
}

function compareAdsbResults(legacyData, newData) {
  const legacyHexes = new Set(Object.keys(legacyData));
  const newHexes = new Set(Object.keys(newData));
  
  const bothHexes = [...legacyHexes].filter(hex => newHexes.has(hex));
  
  let totalDelayDiff = 0;
  let totalDopplerDiff = 0;
  let delayCount = 0;
  let dopplerCount = 0;
  
  const discrepancies = [];
  
  for (const hex of bothHexes) {
    const legacy = legacyData[hex];
    const newAc = newData[hex];
    
    const legacyDelay = parseFloat(legacy.delay);
    const newDelay = parseFloat(newAc.delay);
    const legacyDoppler = legacy.doppler ? parseFloat(legacy.doppler) : null;
    const newDoppler = newAc.doppler || null;
    
    if (!isNaN(legacyDelay) && !isNaN(newDelay)) {
      const delayDiff = Math.abs(newDelay - legacyDelay);
      totalDelayDiff += delayDiff;
      delayCount++;
      
      let dopplerDiff = null;
      if (legacyDoppler !== null && newDoppler !== null && !isNaN(legacyDoppler) && !isNaN(newDoppler)) {
        dopplerDiff = Math.abs(newDoppler - legacyDoppler);
        totalDopplerDiff += dopplerDiff;
        dopplerCount++;
      }
      
      discrepancies.push({
        hex: hex,
        flight: newAc.flight || legacy.flight || '',
        delay_legacy: Math.round(legacyDelay * 100) / 100,
        delay_new: Math.round(newDelay * 100) / 100,
        delay_diff: Math.round(delayDiff * 100) / 100,
        doppler_legacy: legacyDoppler !== null ? Math.round(legacyDoppler * 100) / 100 : null,
        doppler_new: newDoppler !== null ? Math.round(newDoppler * 100) / 100 : null,
        doppler_diff: dopplerDiff !== null ? Math.round(dopplerDiff * 100) / 100 : null
      });
    }
  }
  
  discrepancies.sort((a, b) => b.delay_diff - a.delay_diff);
  
  return {
    total_aircraft: {
      legacy: legacyHexes.size,
      new: newHexes.size,
      both: bothHexes.length,
      legacy_only: legacyHexes.size - bothHexes.length,
      new_only: newHexes.size - bothHexes.length
    },
    avg_delay_diff: delayCount > 0 ? Math.round((totalDelayDiff / delayCount) * 100) / 100 : null,
    avg_doppler_diff: dopplerCount > 0 ? Math.round((totalDopplerDiff / dopplerCount) * 100) / 100 : null,
    largest_discrepancies: discrepancies.slice(0, 10)
  };
}

async function fetchFromTar1090AndExtrapolate() {
  const aircraft = await getCachedAircraft();

  let detectionTimestamp = Date.now() / 1000;
  try {
    if (detection) {
      const detectionData = JSON.parse(detection);
      if (detectionData.timestamp) {
        detectionTimestamp = detectionData.timestamp / 1000;
      }
    }
  } catch (e) {
    console.error('Error parsing detection timestamp:', e.message);
  }

  const adsbData = {};
  for (const ac of aircraft) {
    if (!ac.hex) continue;

    const timestamp = Date.now() / 1000 - (ac.seen_pos || 0);

    adsbData[ac.hex] = {
      hex: ac.hex,
      flight: ac.flight || '',
      timestamp: timestamp,
      lat: ac.lat,
      lon: ac.lon,
      alt_geom: ac.alt_geom,
      alt_baro: ac.alt_baro,
      gs: ac.gs,
      track: ac.track,
      geom_rate: ac.geom_rate
    };
  }

  const rxPos = {
    lat: config.location.rx.latitude,
    lon: config.location.rx.longitude,
    alt: config.location.rx.altitude
  };
  const txPos = {
    lat: config.location.tx.latitude,
    lon: config.location.tx.longitude,
    alt: config.location.tx.altitude
  };

  const synchronized = extrapolateAdsbData(
    adsbData,
    detectionTimestamp,
    rxPos,
    txPos,
    config.capture.fc
  );

  return synchronized;
}

app.get('/api/adsb2dd', async (req, res) => {
  if (!config.truth.adsb.enabled) {
    return res.status(400).end();
  }

  try {
    let result = {};

    if (config.truth.adsb.diagnostic_mode) {
      const legacyResult = await fetchFromAdsbService();
      const newResult = await fetchFromTar1090AndExtrapolate();
      
      const comparison = compareAdsbResults(legacyResult, newResult);
      
      result = {
        method: 'diagnostic',
        legacy: legacyResult,
        new: newResult,
        comparison: comparison
      };
    } else if (config.truth.adsb.use_legacy_method) {
      result = await fetchFromAdsbService();
    } else {
      result = await fetchFromTar1090AndExtrapolate();
    }

    res.json(result);
  } catch (error) {
    console.error('Error in /api/adsb2dd:', error);
    res.json({});
  }
});
