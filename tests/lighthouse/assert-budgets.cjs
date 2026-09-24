'use strict';

const { representativeRunsByUrl } = require('./read-results.cjs');
const { BUDGETS } = require('./budgets.cjs');

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

function formatBytes(value) {
  return `${(value / 1000).toFixed(0)}kB`;
}

function main() {
  const runs = representativeRunsByUrl();
  let failed = false;

  for (const run of runs) {
    const budget = BUDGETS[run.path];
    if (!budget) {
      throw new Error(
        `No budget defined for ${run.path} in tests/lighthouse/budgets.cjs - every collected URL needs one.`,
      );
    }

    const checks = [
      {
        name: 'largest-contentful-paint',
        actual: run.largestContentfulPaintMs,
        budget: budget.largestContentfulPaintMs,
        format: formatMs,
      },
      {
        name: 'cumulative-layout-shift',
        actual: run.cumulativeLayoutShift,
        budget: budget.cumulativeLayoutShift,
        format: (value) => value.toFixed(3),
      },
      {
        name: 'total-byte-weight',
        actual: run.totalByteWeightBytes,
        budget: budget.totalByteWeightBytes,
        format: formatBytes,
      },
    ];

    console.log(`\n${budget.label} (${run.path}) - representative of ${run.runCount} runs`);
    for (const check of checks) {
      const withinBudget = check.actual <= check.budget;
      if (!withinBudget) failed = true;
      const status = withinBudget ? 'PASS' : 'FAIL';
      console.log(
        `  [${status}] ${check.name}: ${check.format(check.actual)} (budget ${check.format(check.budget)})`,
      );
    }
  }

  if (failed) {
    console.error(
      '\nCore Web Vitals budget exceeded. Budgets are set from a measured baseline with ' +
        'headroom for runner variance (tests/lighthouse/budgets.cjs) - a real regression, not ' +
        'noise, is expected to fail this.',
    );
    process.exitCode = 1;
  } else {
    console.log('\nAll pages within their Core Web Vitals budget.');
  }
}

main();
