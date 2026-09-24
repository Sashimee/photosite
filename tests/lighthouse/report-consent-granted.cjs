'use strict';

const { representativeRunsByUrl } = require('./read-results.cjs');
const { BUDGETS } = require('./budgets.cjs');

// Reporting only - see lighthouserc.consent-granted.cjs. Prints the same
// three metrics the denied run gates on, against the same budgets, purely
// for visibility: nothing here sets process.exitCode.
function main() {
  const runs = representativeRunsByUrl();

  console.log('Core Web Vitals with consent granted (analytics + ads/marketing) - report only:\n');
  for (const run of runs) {
    const budget = BUDGETS[run.path];
    const label = budget ? budget.label : run.path;
    console.log(`${label} (${run.path}) - representative of ${run.runCount} runs`);
    console.log(`  largest-contentful-paint: ${Math.round(run.largestContentfulPaintMs)}ms`);
    console.log(`  cumulative-layout-shift: ${run.cumulativeLayoutShift.toFixed(3)}`);
    console.log(`  total-byte-weight: ${(run.totalByteWeightBytes / 1000).toFixed(0)}kB\n`);
  }
}

main();
