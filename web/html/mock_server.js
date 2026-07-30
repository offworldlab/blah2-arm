// Standalone mock server for visually testing web/html changes without
// Docker, SDR hardware, or a real ADS-B feed. Simulates a live radar feed:
// a noisy heatmap, a moving detection blob, and a moving "aircraft" track.
//   node mock_server.js
//   then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const PORT = 3000;

const delay = Array.from({ length: 60 }, (_, i) => i * 2);       // 0..118
const doppler = Array.from({ length: 60 }, (_, i) => -60 + i * 2); // -60..58

function buildHeatmap(t) {
  // background clutter near zero-doppler + a moving "target" blob
  const targetDelayIdx = 10 + Math.round(10 + 8 * Math.sin(t / 1500));
  const targetDopplerIdx = 30 + Math.round(8 * Math.cos(t / 1200));
  return doppler.map((_, di) =>
    delay.map((_, ri) => {
      const clutter = Math.exp(-((di - 30) ** 2) / 8) * 6; // zero-doppler clutter ridge
      const noise = Math.random() * 1.5;
      const dist2 = (ri - targetDelayIdx) ** 2 + (di - targetDopplerIdx) ** 2;
      const target = 12 * Math.exp(-dist2 / 4);
      return clutter + noise + target;
    })
  );
}

function buildDetection(t) {
  const targetDelay = delay[10 + Math.round(10 + 8 * Math.sin(t / 1500))];
  const targetDoppler = doppler[30 + Math.round(8 * Math.cos(t / 1200))];
  return { nRows: 1, delay: [targetDelay], doppler: [targetDoppler] };
}

function buildAdsb(t) {
  // object keyed by aircraft id, matching real /api/adsb2dd shape
  return {
    TEST123: {
      delay: 40 + 15 * Math.sin(t / 2000),
      doppler: 20 + 10 * Math.cos(t / 1800),
      flight: 'TEST123'
    },
    TEST456: {
      delay: 80 + 10 * Math.cos(t / 2500),
      doppler: -20 + 8 * Math.sin(t / 2200),
      flight: 'TEST456'
    }
  };
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const t = Date.now();

  if (url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ truth: { adsb: { enabled: true } } }));
    return;
  }
  if (url === '/api/timestamp') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(t)); // changes every request -> drives the poll loop
    return;
  }
  if (url === '/api/map') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ nRows: 1, delay, doppler, data: buildHeatmap(t), maxPower: 18 }));
    return;
  }
  if (url === '/api/detection') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildDetection(t)));
    return;
  }
  if (url === '/api/adsb2dd') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildAdsb(t)));
    return;
  }

  const filePath = path.join(root, url === '/' ? 'index.html' : url);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Mock server running at http://localhost:${PORT}`);
});
