'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const { findSystemChrome, findCachedChrome, hasModule, CACHE } = require('./browser');

const ENGINE = path.join(__dirname, '..');
const DEPS = ['puppeteer-core', '@puppeteer/browsers', 'ffmpeg-static'];

/** Reports what is installed. Changes nothing. */
async function doctor() {
  const report = {};
  const [major] = process.versions.node.split('.').map(Number);
  report.node = `${process.versions.node}${major >= 18 ? '' : '  (needs >= 18)'}`;
  const missing = DEPS.filter((d) => !hasModule(d));
  report.engine = missing.length ? `missing: ${missing.join(', ')}` : 'installed';
  report.chrome = findSystemChrome() || (await findCachedChrome()) || 'not found';
  if (missing.length) report.ffmpeg = 'comes with the engine';
  else {
    const bin = require('./ffmpeg').resolveFfmpeg();
    const v = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    report.ffmpeg = v.status === 0 ? v.stdout.split('\n')[0].replace(/ Copyright.*/, '') : 'found but failed to run: ' + bin;
  }
  if (major < 18) report.status = 'node too old';
  else if (missing.length) report.status = 'setup required';
  else if (report.chrome === 'not found') report.status = 'chrome required';
  else if (/failed/.test(report.ffmpeg)) report.status = 'needs attention';
  else report.status = 'ready';
  if (report.status === 'setup required') {
    report.setup = `inkline setup installs ${DEPS.join(', ')} from the npm registry into ${path.join(ENGINE, 'node_modules')} (about 80 MB, includes an ffmpeg binary). Nothing is installed until you run it.`;
  }
  if (report.chrome === 'not found') {
    report.chromeHelp = `install Chrome/Edge/Chromium, set INKLINE_CHROME, or run inkline setup --with-chrome (downloads headless Chrome, ~90 MB, into ${CACHE})`;
  }
  return report;
}

/** Runs after the launcher's npm install; optionally downloads headless Chrome. */
async function setup({ withChrome } = {}) {
  const { downloadChrome } = require('./browser');
  if (withChrome && !findSystemChrome() && !(await findCachedChrome())) {
    await downloadChrome((m) => process.stderr.write(`inkline · ${m}\n`));
  }
  return doctor();
}

module.exports = { doctor, setup, DEPS };
