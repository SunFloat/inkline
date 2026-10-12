'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { launch, openComposition } = require('./browser');
const { traceOnPage, parseSize, rendererOptions } = require('./pipeline');

const CORE = path.join(__dirname, '..', 'core');
const ASSETS = path.join(__dirname, '..', 'assets');

function openInBrowser(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`;
}

/** Traces once in headless Chrome, then writes a self-contained interactive player. */
async function preview(input, style, o = {}) {
  const [width, height] = parseSize(o.format, o.size, o.quality);
  const out = path.resolve(o.out || path.join(process.cwd(), 'inkline-out', `${path.basename(input).replace(/\.[^.]+$/, '')}-${style.name}.preview.html`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { browser } = await launch((m) => !o.quiet && process.stderr.write(`inkline · ${m}\n`));
  let project;
  try {
    const page = await openComposition(browser, 800, 800);
    project = await traceOnPage(page, input, style.trace);
  } finally {
    await browser.close().catch(() => {});
  }
  const ropts = rendererOptions(style, o, width, height, Number(o.fps || 30));
  const argv = (o.argv || []).map((a) => (a === 'preview' ? 'render' : a)).filter((a) => a !== '--no-open' && a !== '--json');
  const data = { project, style, opts: ropts, command: ['inkline', ...argv].map(shellQuote).join(' ') };
  const tpl = fs.readFileSync(path.join(CORE, 'player.html'), 'utf8');
  const title = path.basename(input);
  const html = tpl
    .replace(/__CORE__/g, pathToFileURL(CORE).href)
    .replace(/__ASSETS__/g, pathToFileURL(ASSETS).href)
    .replace(/__TITLE__/g, title.replace(/[<>&"]/g, ''))
    .replace('/*__INKLINE_DATA__*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'));
  fs.writeFileSync(out, html);
  const opened = o.open !== false && openInBrowser(out);
  return { output: out, opened };
}

module.exports = { preview };
