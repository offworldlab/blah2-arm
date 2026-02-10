var timestamp = -1;
var nRows = 3;
var host = window.location.hostname;
var isLocalHost = is_localhost(host);
var range_x = [];
var range_y = [];

// === Match Tracking State ===
var matchTracker = {};    // per-aircraft hex: { buffer: [], idx: 0, confirmed: false, avgDelayOff: 0, avgDopplerOff: 0, lastSeen: 0 }
var frameCounter = 0;
var adsbRaw = {};         // keyed ADSB data preserved from fetch
var MATCH_CONFIG = {
  delayThreshold: 5,          // km - max delay distance for candidate match
  dopplerThreshold: 25,       // Hz - max doppler distance for candidate match
  windowSize: 10,             // frames in sliding window
  minMatches: 5,              // min matches needed in window
  staleFrames: 3,             // frames without ADSB data before pruning
  maxOffsetDelayStd: 2,       // km - max std dev of delay offset for confirmed
  maxOffsetDopplerStd: 10,    // Hz - max std dev of doppler offset for confirmed
  maxMotionDelayErr: 2,       // km - max avg frame-to-frame delay motion mismatch
  maxMotionDopplerErr: 10,    // Hz - max avg frame-to-frame doppler motion mismatch
  minMotionSamples: 2         // need at least this many motion comparisons
};

// setup API
var urlTimestamp;
var urlDetection;
var adsbData = {};
var urlAdsbLink;
var urlConfig;
if (isLocalHost) {
  urlTimestamp = '//' + host + ':3000/api/timestamp';
} else {
  urlTimestamp = '/api/timestamp';
}
if (isLocalHost) {
  urlDetection = '//' + host + ':3000/api/detection';
} else {
  urlDetection = '/api/detection';
}
if (isLocalHost) {
  urlMap = '//' + host + ':3000' + urlMap;
} else {
  // urlMap is already relative (e.g. '/api/map')
}
if (isLocalHost) {
  urlAdsbLink = '//' + host + ':3000/api/adsb2dd';
} else {
  urlAdsbLink = '/api/adsb2dd';
}
if (isLocalHost) {
  urlConfig = '//' + host + ':3000/api/config';
} else {
  urlConfig = '/api/config';
}

// get truth flag
var isTruth = false;
$.getJSON(urlConfig, function () { })
.done(function (data_config) {
  if (data_config.truth.adsb.enabled === true) {
    isTruth = true;
    $.getJSON(urlAdsbLink, function () { })
    .done(function (data) {
      adsbData = data;
    })
  }
});

// setup plotly
var layout = {
  autosize: true,
  margin: {
    l: 50,
    r: 50,
    b: 50,
    t: 10,
    pad: 0
  },
  hoverlabel: {
    namelength: 0
  },
  plot_bgcolor: "rgba(0,0,0,0)",
  paper_bgcolor: "rgba(0,0,0,0)",
  annotations: [],
  displayModeBar: false,
  xaxis: {
    title: {
      text: 'Bistatic Range (km)',
      font: {
        size: 24
      }
    },
    ticks: '',
    side: 'bottom'
  },
  yaxis: {
    title: {
      text: 'Bistatic Doppler (Hz)',
      font: {
        size: 24
      }
    },
    ticks: '',
    ticksuffix: ' ',
    autosize: false,
    categoryorder: "total descending"
  },
  showlegend: false
};
var config = {
  responsive: true,
  displayModeBar: false
  //scrollZoom: true
}

// setup plotly data
var data = [
  {
    z: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    colorscale: 'Jet',
    type: 'heatmap'
  }
];
var detection = [];
var adsb = {};

Plotly.newPlot('data', data, layout, config);

// === Match Tracking Functions ===

function updateMatchTracker(detectionData, adsbDataKeyed) {
  frameCounter++;

  var activeHexes = {};

  for (var hex in adsbDataKeyed) {
    var ac = adsbDataKeyed[hex];
    if (!('doppler' in ac)) continue;

    activeHexes[hex] = true;
    var acDelay = ac.delay;
    var acDoppler = ac.doppler;

    // Find nearest detection within threshold
    var bestDist = Infinity;
    var bestDelayOff = 0;
    var bestDopplerOff = 0;
    var bestDetIdx = -1;
    var matched = false;

    if (detectionData && detectionData.delay) {
      for (var i = 0; i < detectionData.delay.length; i++) {
        var dDelay = detectionData.delay[i] - acDelay;
        var dDoppler = detectionData.doppler[i] - acDoppler;

        // Check within threshold box
        if (Math.abs(dDelay) <= MATCH_CONFIG.delayThreshold &&
            Math.abs(dDoppler) <= MATCH_CONFIG.dopplerThreshold) {
          var dist = Math.abs(dDelay) / MATCH_CONFIG.delayThreshold +
                     Math.abs(dDoppler) / MATCH_CONFIG.dopplerThreshold;
          if (dist < bestDist) {
            bestDist = dist;
            bestDelayOff = dDelay;
            bestDopplerOff = dDoppler;
            bestDetIdx = i;
            matched = true;
          }
        }
      }
    }

    // Initialize tracker for new aircraft
    if (!matchTracker[hex]) {
      matchTracker[hex] = {
        buffer: new Array(MATCH_CONFIG.windowSize).fill(null),
        idx: 0,
        confirmed: false,
        avgDelayOff: 0,
        avgDopplerOff: 0,
        stdDelayOff: Infinity,
        stdDopplerOff: Infinity,
        avgMotionDelayErr: Infinity,
        avgMotionDopplerErr: Infinity,
        matchCount: 0,
        motionSamples: 0,
        lastSeen: frameCounter,
        flight: ac.flight || hex,
        prevAdsb: null,
        prevDet: null
      };
    }

    var tracker = matchTracker[hex];
    tracker.lastSeen = frameCounter;
    tracker.flight = ac.flight || hex;

    // Compute motion correlation: compare how ADSB moved vs how matched detection moved
    var motionDelayErr = null;
    var motionDopplerErr = null;
    if (matched && tracker.prevAdsb && tracker.prevDet) {
      var adsbMotionDelay = acDelay - tracker.prevAdsb.delay;
      var adsbMotionDoppler = acDoppler - tracker.prevAdsb.doppler;
      var detMotionDelay = detectionData.delay[bestDetIdx] - tracker.prevDet.delay;
      var detMotionDoppler = detectionData.doppler[bestDetIdx] - tracker.prevDet.doppler;
      motionDelayErr = Math.abs(adsbMotionDelay - detMotionDelay);
      motionDopplerErr = Math.abs(adsbMotionDoppler - detMotionDoppler);
    }

    // Record match result in circular buffer
    if (matched) {
      tracker.buffer[tracker.idx] = {
        dDelay: bestDelayOff,
        dDoppler: bestDopplerOff,
        motionDelayErr: motionDelayErr,
        motionDopplerErr: motionDopplerErr
      };
      tracker.prevAdsb = { delay: acDelay, doppler: acDoppler };
      tracker.prevDet = { delay: detectionData.delay[bestDetIdx], doppler: detectionData.doppler[bestDetIdx] };
    } else {
      tracker.buffer[tracker.idx] = null;
      tracker.prevAdsb = { delay: acDelay, doppler: acDoppler };
      tracker.prevDet = null;
    }
    tracker.idx = (tracker.idx + 1) % MATCH_CONFIG.windowSize;

    // Compute running stats over window
    var count = 0;
    var sumDelay = 0, sumDoppler = 0;
    var delays = [], dopplers = [];
    var motionCount = 0, sumMotionDelayErr = 0, sumMotionDopplerErr = 0;

    for (var j = 0; j < MATCH_CONFIG.windowSize; j++) {
      var entry = tracker.buffer[j];
      if (entry !== null) {
        count++;
        sumDelay += entry.dDelay;
        sumDoppler += entry.dDoppler;
        delays.push(entry.dDelay);
        dopplers.push(entry.dDoppler);
        if (entry.motionDelayErr !== null) {
          motionCount++;
          sumMotionDelayErr += entry.motionDelayErr;
          sumMotionDopplerErr += entry.motionDopplerErr;
        }
      }
    }

    tracker.matchCount = count;
    tracker.motionSamples = motionCount;
    tracker.avgDelayOff = count > 0 ? sumDelay / count : 0;
    tracker.avgDopplerOff = count > 0 ? sumDoppler / count : 0;

    // Offset consistency: standard deviation
    if (count > 1) {
      var varDelay = 0, varDoppler = 0;
      for (var j = 0; j < delays.length; j++) {
        varDelay += (delays[j] - tracker.avgDelayOff) * (delays[j] - tracker.avgDelayOff);
        varDoppler += (dopplers[j] - tracker.avgDopplerOff) * (dopplers[j] - tracker.avgDopplerOff);
      }
      tracker.stdDelayOff = Math.sqrt(varDelay / (count - 1));
      tracker.stdDopplerOff = Math.sqrt(varDoppler / (count - 1));
    } else {
      tracker.stdDelayOff = Infinity;
      tracker.stdDopplerOff = Infinity;
    }

    // Motion correlation: average frame-to-frame motion mismatch
    if (motionCount > 0) {
      tracker.avgMotionDelayErr = sumMotionDelayErr / motionCount;
      tracker.avgMotionDopplerErr = sumMotionDopplerErr / motionCount;
    } else {
      tracker.avgMotionDelayErr = Infinity;
      tracker.avgMotionDopplerErr = Infinity;
    }

    // Confirmed requires: enough hits + consistent offset + correlated motion
    tracker.confirmed = (
      count >= MATCH_CONFIG.minMatches &&
      tracker.stdDelayOff <= MATCH_CONFIG.maxOffsetDelayStd &&
      tracker.stdDopplerOff <= MATCH_CONFIG.maxOffsetDopplerStd &&
      motionCount >= MATCH_CONFIG.minMotionSamples &&
      tracker.avgMotionDelayErr <= MATCH_CONFIG.maxMotionDelayErr &&
      tracker.avgMotionDopplerErr <= MATCH_CONFIG.maxMotionDopplerErr
    );
  }

  // Prune stale entries
  for (var hex in matchTracker) {
    if (!activeHexes[hex] && (frameCounter - matchTracker[hex].lastSeen) > MATCH_CONFIG.staleFrames) {
      delete matchTracker[hex];
    }
  }
}

function buildMatchLinesTrace() {
  var lineX = [];
  var lineY = [];

  for (var hex in matchTracker) {
    var tracker = matchTracker[hex];
    if (!tracker.confirmed) continue;

    var ac = adsbRaw[hex];
    if (!ac || !('doppler' in ac)) continue;

    var acDelay = ac.delay;
    var acDoppler = ac.doppler;
    // Point to matched detection = adsb + offset
    var detDelay = acDelay + tracker.avgDelayOff;
    var detDoppler = acDoppler + tracker.avgDopplerOff;

    lineX.push(acDelay, detDelay, null);
    lineY.push(acDoppler, detDoppler, null);
  }

  return {
    x: lineX,
    y: lineY,
    mode: 'lines',
    type: 'scatter',
    line: {
      color: '#ffd54f',
      width: 2,
      dash: 'dot'
    },
    hoverinfo: 'skip'
  };
}

function getAdsbMarkerColors(adsbDataKeyed) {
  var colors = [];
  for (var hex in adsbDataKeyed) {
    var ac = adsbDataKeyed[hex];
    if (!('doppler' in ac)) continue;

    var tracker = matchTracker[hex];
    if (!tracker) {
      colors.push('#ef5350'); // red - no tracking yet
    } else if (tracker.confirmed) {
      colors.push('#66bb6a'); // green - confirmed match
    } else if (tracker.matchCount > 0) {
      colors.push('#ffd54f'); // yellow - partial match
    } else {
      colors.push('#ef5350'); // red - no match
    }
  }
  return colors;
}

function updateStatsOverlay() {
  var el = document.getElementById('match-stats');
  if (!el) return;

  var confirmed = [];
  var totalDelayOff = 0;
  var totalDopplerOff = 0;

  for (var hex in matchTracker) {
    var t = matchTracker[hex];
    if (t.confirmed) {
      confirmed.push(t);
      totalDelayOff += t.avgDelayOff;
      totalDopplerOff += t.avgDopplerOff;
    }
  }

  if (confirmed.length === 0) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  var avgDelay = totalDelayOff / confirmed.length;
  var avgDoppler = totalDopplerOff / confirmed.length;

  // Build overlay using safe DOM methods
  while (el.firstChild) el.removeChild(el.firstChild);

  var h4 = document.createElement('h4');
  h4.textContent = 'ADSB-Detection Match (motion-correlated)';
  el.appendChild(h4);

  var summary = document.createElement('div');
  summary.className = 'summary-line';
  var countText = document.createTextNode(
    confirmed.length + ' confirmed | Avg offset: '
  );
  summary.appendChild(countText);

  var delaySpan = document.createElement('span');
  delaySpan.className = avgDelay >= 0 ? 'positive' : 'negative';
  delaySpan.textContent = (avgDelay >= 0 ? '+' : '') + avgDelay.toFixed(2) + ' km';
  summary.appendChild(delaySpan);
  summary.appendChild(document.createTextNode(', '));

  var dopplerSpan = document.createElement('span');
  dopplerSpan.className = avgDoppler >= 0 ? 'positive' : 'negative';
  dopplerSpan.textContent = (avgDoppler >= 0 ? '+' : '') + avgDoppler.toFixed(1) + ' Hz';
  summary.appendChild(dopplerSpan);
  el.appendChild(summary);

  var table = document.createElement('table');
  var thead = document.createElement('tr');
  ['Flight', 'Delay Off', 'Doppler Off', 'Offset \u03c3', 'Motion Err', 'Hits'].forEach(function(label) {
    var th = document.createElement('th');
    th.textContent = label;
    thead.appendChild(th);
  });
  table.appendChild(thead);

  confirmed.sort(function(a, b) { return b.matchCount - a.matchCount; });
  for (var i = 0; i < confirmed.length; i++) {
    var t = confirmed[i];
    var tr = document.createElement('tr');

    var tdFlight = document.createElement('td');
    tdFlight.className = 'match-green';
    tdFlight.textContent = t.flight;
    tr.appendChild(tdFlight);

    var tdDelay = document.createElement('td');
    tdDelay.className = t.avgDelayOff >= 0 ? 'positive' : 'negative';
    tdDelay.textContent = (t.avgDelayOff >= 0 ? '+' : '') + t.avgDelayOff.toFixed(1) + ' km';
    tr.appendChild(tdDelay);

    var tdDoppler = document.createElement('td');
    tdDoppler.className = t.avgDopplerOff >= 0 ? 'positive' : 'negative';
    tdDoppler.textContent = (t.avgDopplerOff >= 0 ? '+' : '') + t.avgDopplerOff.toFixed(0) + ' Hz';
    tr.appendChild(tdDoppler);

    // Offset std dev (consistency)
    var tdStd = document.createElement('td');
    tdStd.textContent = t.stdDelayOff.toFixed(1) + 'km/' + t.stdDopplerOff.toFixed(0) + 'Hz';
    tr.appendChild(tdStd);

    // Motion correlation error
    var tdMotion = document.createElement('td');
    tdMotion.textContent = t.avgMotionDelayErr.toFixed(1) + 'km/' + t.avgMotionDopplerErr.toFixed(0) + 'Hz';
    tr.appendChild(tdMotion);

    var tdHits = document.createElement('td');
    tdHits.textContent = t.matchCount + '/' + MATCH_CONFIG.windowSize;
    tr.appendChild(tdHits);

    table.appendChild(tr);
  }
  el.appendChild(table);
}

// callback function
var intervalId = window.setInterval(function () {

  // check if timestamp is updated
  $.get(urlTimestamp, function () { })

    .done(function (data) {
      if (timestamp != data) {
        timestamp = data;

        // get detection data (no detection lag)
        $.getJSON(urlDetection, function () { })
          .done(function (data_detection) {
            detection = data_detection;
          });

        // get ADS-B data if enabled in config, pass detection timestamp for synchronization
        if (isTruth) {
          $.getJSON(urlAdsbLink + '?detection_ts=' + encodeURIComponent(timestamp), function () { })
            .done(function (data_adsb) {
              // Preserve keyed data for match tracking
              adsbRaw = data_adsb;

              adsb['delay'] = [];
              adsb['doppler'] = [];
              adsb['flight'] = [];
              for (const aircraft in data_adsb) {
                if ('doppler' in data_adsb[aircraft]) {
                  var del = data_adsb[aircraft]['delay'];
                  var dop = data_adsb[aircraft]['doppler'];
                  // For confirmed matches, snap ADSB dot to matched detection position
                  var tr = matchTracker[aircraft];
                  if (tr && tr.confirmed) {
                    del += tr.avgDelayOff;
                    dop += tr.avgDopplerOff;
                  }
                  adsb['delay'].push(del);
                  adsb['doppler'].push(dop);
                  adsb['flight'].push(data_adsb[aircraft]['flight'])
                }
              }

              // Update match tracking
              updateMatchTracker(detection, adsbRaw);
              updateStatsOverlay();
            });
        }
        // get new map data
        $.getJSON(urlMap, function () { })
          .done(function (data) {

            // Build match lines trace
            var matchLines = buildMatchLinesTrace();
            // Get per-aircraft marker colors
            var adsbColors = getAdsbMarkerColors(adsbRaw);

            // case draw new plot
            if (data.nRows != nRows) {
              nRows = data.nRows;

              // lock range before other trace
              var layout_update = {
                'xaxis.range': [data.delay[0], data.delay.slice(-1)[0]],
                'yaxis.range': [data.doppler[0], data.doppler.slice(-1)[0]]
              };
              Plotly.relayout('data', layout_update);

              var trace1 = {
                  z: data.data,
                  x: data.delay,
                  y: data.doppler,
                  colorscale: 'Viridis',
                  zauto: false,
                  zmin: 0,
                  zmax: Math.max(13, data.maxPower),
                  type: 'heatmap'
              };
              var trace2 = {
                  x: detection.delay,
                  y: detection.doppler,
                  mode: 'markers',
                  type: 'scatter',
                  marker: {
                    size: 16,
                    opacity: 0.6
                  }
              };
              var trace3 = {
                x: adsb.delay,
                y: adsb.doppler,
                text: adsb.flight,
                mode: 'markers',
                type: 'scatter',
                marker: {
                  size: 16,
                  opacity: 0.6,
                  color: adsbColors.length > 0 ? adsbColors : '#ef5350'
                }
              };
              var trace4 = matchLines;

              var data_trace = [trace1, trace2, trace3, trace4];
              Plotly.newPlot('data', data_trace, layout, config);
            }
            // case update plot
            else {
              var trace_update = {
                x: [data.delay, detection.delay, adsb.delay, matchLines.x],
                y: [data.doppler, detection.doppler, adsb.doppler, matchLines.y],
                z: [data.data, [], [], []],
                zmax: [Math.max(13, data.maxPower), [], [], []],
                text: [[], [], adsb.flight, []],
                'marker.color': [[], [], adsbColors.length > 0 ? adsbColors : '#ef5350', []]
              };
              Plotly.update('data', trace_update);
            }

          })
          .fail(function () {
          })
          .always(function () {
          });
      }
    })
    .fail(function () {
    })
    .always(function () {
    });
}, 1000);
