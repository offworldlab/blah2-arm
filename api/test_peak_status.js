// Ad-hoc test for the /capture/rf-status endpoint (peak dBFS reporting).
// Boots server.js as a child process on high ports with a minimal config,
// then exercises the full round trip over real HTTP:
//   POST /capture/rf-status -> GET /capture/rf-status
// Run with: node test_peak_status.js

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// must be 3000: the stash modules self-poll the API on a hardcoded port 3000
// and crash the process (no error handler) if nothing is listening there
const API_PORT = 3000;
const BASE = `http://127.0.0.1:${API_PORT}`;

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.error(`  FAIL: ${name}`);
  }
}

function request(method, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(BASE + urlPath, {
      method,
      headers: data === null ? {} : {
        'Content-Type': contentType
          || (typeof body === 'string' ? 'text/plain' : 'application/json'),
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await request('GET', '/capture/rf-status');
      if (res.status === 200) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server.js did not come up in time');
}

async function testEndpoints() {
  console.log('endpoints:');

  let res = await request('GET', '/capture/rf-status');
  check('initial GET is empty', res.status === 200 && res.body === '{}');

  // valid round trip
  res = await request('POST', '/capture/rf-status', '-14.3,-9.8,1234567890');
  check('valid POST accepted', res.status === 200);
  res = await request('GET', '/capture/rf-status');
  const rf = JSON.parse(res.body);
  check('GET reflects posted peak dBFS',
    rf.peakDbfsA === -14.3 && rf.peakDbfsB === -9.8
    && rf.timestamp === 1234567890 && typeof rf.receivedAt === 'number');

  // malformed body (wrong field count) is accepted but ignored
  res = await request('POST', '/capture/rf-status', 'not,valid');
  check('malformed POST (wrong field count) accepted', res.status === 200);
  res = await request('GET', '/capture/rf-status');
  check('state unchanged after malformed POST',
    JSON.parse(res.body).peakDbfsA === -14.3);

  // malformed body (non-numeric) is accepted but ignored
  res = await request('POST', '/capture/rf-status', 'abc,def,ghi');
  check('malformed POST (non-numeric) accepted', res.status === 200);
  res = await request('GET', '/capture/rf-status');
  check('state unchanged after non-numeric POST',
    JSON.parse(res.body).peakDbfsA === -14.3);
}

async function main() {
  // minimal config for server.js on high ports
  const cfg = `
network:
  ip: 127.0.0.1
  ports:
    api: ${API_PORT}
    map: 33011
    detection: 33012
    track: 33013
    timestamp: 34010
    timing: 34011
    iqdata: 34012
capture:
  fc: 98000000
  device:
    gainReduction: [40, 41]
    lnaState: 4
truth:
  adsb:
    enabled: false
    tar1090: ""
    adsb2dd: ""
location:
  rx: {latitude: 0, longitude: 0, altitude: 0}
  tx: {latitude: 0, longitude: 0, altitude: 0}
`;
  const cfgPath = path.join(os.tmpdir(), `test_peak_status_config_${process.pid}.yml`);
  fs.writeFileSync(cfgPath, cfg);

  const server = spawn('node', ['server.js', cfgPath],
    { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitForServer(10000);
    await testEndpoints();
  } finally {
    server.kill();
    fs.unlinkSync(cfgPath);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
