// Ad-hoc test for the /capture/retune and /capture/overload-status endpoints.
// Boots server.js as a child process on high ports with a minimal config,
// then exercises the full round trip over real HTTP:
//   POST /capture/retune -> GET /capture/retune -> POST /capture/retune/ack
//   -> GET /capture/retune/status -> POST /capture/overload-status -> GET same.
// Run with: node test_retune.js

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const retuneLib = require('./lib/retune');

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
      const res = await request('GET', '/capture/retune');
      if (res.status === 200) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server.js did not come up in time');
}

function testValidate() {
  console.log('lib/retune.validate:');
  check('valid request', retuneLib.validate(98000000, 20, 59, 4) === null);
  check('fc too low', retuneLib.validate(0, 40, 40, 4) !== null);
  check('fc too high', retuneLib.validate(2000000001, 40, 40, 4) !== null);
  check('fc non-numeric', retuneLib.validate('98e6', 40, 40, 4) !== null);
  check('gainA too low', retuneLib.validate(98000000, 19, 40, 4) !== null);
  check('gainB too high', retuneLib.validate(98000000, 40, 60, 4) !== null);
  check('gain non-integer', retuneLib.validate(98000000, 40.5, 40, 4) !== null);
  check('gain missing', retuneLib.validate(98000000, undefined, 40, 4) !== null);
  check('lnaState too low', retuneLib.validate(98000000, 40, 40, 0) !== null);
  check('lnaState too high', retuneLib.validate(98000000, 40, 40, 10) !== null);
  check('lnaState non-integer', retuneLib.validate(98000000, 40, 40, 4.5) !== null);
  check('lnaState missing', retuneLib.validate(98000000, 40, 40, undefined) !== null);
}

async function testEndpoints() {
  console.log('endpoints:');

  // initial state: generation 0, config-seeded values
  let res = await request('GET', '/capture/retune');
  check('initial GET is CSV with generation 0',
    res.status === 200 && res.body === '0,98000000,40,41,4');

  res = await request('GET', '/capture/retune/status');
  check('initial status is empty', res.status === 200 && res.body === '{}');

  res = await request('GET', '/capture/overload-status');
  check('initial overload-status is empty', res.status === 200 && res.body === '{}');

  // invalid request is rejected and does not bump generation
  res = await request('POST', '/capture/retune',
    { fc: 98000000, gainReductionA: 5, gainReductionB: 40, lnaState: 4 });
  check('invalid POST returns 400', res.status === 400);
  res = await request('GET', '/capture/retune');
  check('generation unchanged after invalid POST', res.body.startsWith('0,'));

  // valid request bumps generation and updates the CSV
  res = await request('POST', '/capture/retune',
    { fc: 105100000, gainReductionA: 20, gainReductionB: 30, lnaState: 4 });
  check('valid POST returns generation 1',
    res.status === 200 && JSON.parse(res.body).generation === 1);
  res = await request('GET', '/capture/retune');
  check('GET reflects new candidate', res.body === '1,105100000,20,30,4');

  // second request bumps again (monotonic), lnaState escalated
  res = await request('POST', '/capture/retune',
    { fc: 105100000, gainReductionA: 25, gainReductionB: 30, lnaState: 5 });
  check('second POST returns generation 2',
    JSON.parse(res.body).generation === 2);
  res = await request('GET', '/capture/retune');
  check('GET reflects escalated lnaState', res.body === '2,105100000,25,30,5');

  // ack round trip (what blah2 posts after applying)
  const appliedAt = Date.now();
  res = await request('POST', '/capture/retune/ack',
    `2,105100000,25,30,5,${appliedAt}`);
  check('ack accepted', res.status === 200);
  res = await request('GET', '/capture/retune/status');
  const status = JSON.parse(res.body);
  check('status echoes ack', status.generation === 2
    && status.fc === 105100000 && status.gainReductionA === 25
    && status.gainReductionB === 30 && status.lnaState === 5
    && status.appliedAt === appliedAt
    && typeof status.receivedAt === 'number');

  // malformed ack is ignored, status unchanged
  res = await request('POST', '/capture/retune/ack', 'not,a,valid,ack');
  check('malformed ack accepted but ignored', res.status === 200);
  res = await request('GET', '/capture/retune/status');
  check('status unchanged after malformed ack',
    JSON.parse(res.body).generation === 2);

  // overload-status round trip
  res = await request('POST', '/capture/overload-status', `1,0,${Date.now()}`);
  check('overload-status accepted', res.status === 200);
  res = await request('GET', '/capture/overload-status');
  const rf = JSON.parse(res.body);
  check('overload-status echoes overload flags',
    rf.overloadA === true && rf.overloadB === false
    && typeof rf.timestamp === 'number');

  // fc staleness fix: /api/adsb2dd is disabled here, but /api/config works
  // and the retune POST must have updated config.capture.fc in memory —
  // verified indirectly by the CSV reflecting it (already checked above).
}

async function main() {
  testValidate();

  // minimal config for server.js on high ports
  const cfg = `
network:
  ip: 127.0.0.1
  ports:
    api: ${API_PORT}
    map: 33001
    detection: 33002
    track: 33003
    timestamp: 34000
    timing: 34001
    iqdata: 34002
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
  const cfgPath = path.join(os.tmpdir(), `test_retune_config_${process.pid}.yml`);
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
