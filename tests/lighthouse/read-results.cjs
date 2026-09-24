'use strict';

const fs = require('fs');
const path = require('path');
const { computeRepresentativeRuns } = require('@lhci/utils/src/representative-runs.js');

function loadLhrs(dir) {
  const dirPath = path.resolve(process.cwd(), dir);
  const files = fs.readdirSync(dirPath).filter((file) => file.endsWith('.json'));
  return files.map((file) => JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8')));
}

function groupByUrl(lhrs) {
  const map = new Map();
  for (const lhr of lhrs) {
    const list = map.get(lhr.requestedUrl) || [];
    list.push(lhr);
    map.set(lhr.requestedUrl, list);
  }
  return map;
}

// One run per URL, picked by the same median-proximity algorithm `lhci
// assert` uses (@lhci/utils/src/representative-runs.js) so this reads the
// same "representative" run LHCI's own tooling would - deliberately reused
// rather than re-implemented, and consistent across the gating and
// reporting scripts.
function representativeRunsByUrl(dir = '.lighthouseci') {
  const lhrs = loadLhrs(dir);
  if (lhrs.length === 0) {
    throw new Error(`No Lighthouse results found in ${dir} - did \`lhci collect\` run first?`);
  }

  const grouped = groupByUrl(lhrs);
  const runsByUrl = [...grouped.values()].map((lhrsForUrl) => lhrsForUrl.map((lhr) => [lhr, lhr]));
  const representative = computeRepresentativeRuns(runsByUrl);

  return representative.map((lhr) => ({
    url: lhr.requestedUrl,
    path: new URL(lhr.requestedUrl).pathname,
    runCount: grouped.get(lhr.requestedUrl).length,
    largestContentfulPaintMs: lhr.audits['largest-contentful-paint'].numericValue,
    cumulativeLayoutShift: lhr.audits['cumulative-layout-shift'].numericValue,
    totalByteWeightBytes: lhr.audits['total-byte-weight'].numericValue,
  }));
}

module.exports = { representativeRunsByUrl };
