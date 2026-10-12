'use strict';
const { findSystemChrome, resolveChrome } = require('./browser');
const { resolveFfmpeg } = require('./ffmpeg');
const { spawnSync } = require('child_process');

async function doctor() {
  const report = {};
  const [major] = process.versions.node.split('.').map(Number);
  report.node = `${process.versions.node}${major >= 18 ? '' : '  (needs >= 18)'}`;
  const system = findSystemChrome();
  report.chrome = system ? `${system}` : 'not installed, fetching headless Chrome …';
  if (!system) report.chrome = await resolveChrome((m) => process.stderr.write(`inkline · ${m}\n`));
  try {
    const bin = resolveFfmpeg();
    const v = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    report.ffmpeg = v.status === 0 ? v.stdout.split('\n')[0].replace(/ Copyright.*/, '') : 'found but failed to run: ' + bin;
  } catch (e) {
    report.ffmpeg = 'missing: ' + e.message;
  }
  report.status = /missing|needs|failed/.test(Object.values(report).join(' ')) ? 'needs attention' : 'ready';
  return report;
}

module.exports = { doctor };
