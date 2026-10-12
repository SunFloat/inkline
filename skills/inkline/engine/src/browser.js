'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE = path.join(os.homedir(), '.cache', 'inkline');

function systemCandidates() {
  const env = [process.env.INKLINE_CHROME, process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH].filter(Boolean);
  if (process.platform === 'darwin') {
    return env.concat([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ]);
  }
  if (process.platform === 'win32') {
    const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'Chromium/Application/chrome.exe'];
    return env.concat(pf.flatMap((p) => rel.map((r) => path.join(p, r))));
  }
  return env.concat(['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge']);
}

function findSystemChrome() {
  return systemCandidates().find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

function hasModule(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/** A previously downloaded chrome-headless-shell in ~/.cache/inkline, if any. Never downloads. */
async function findCachedChrome() {
  if (!hasModule('@puppeteer/browsers')) return null;
  const browsers = require('@puppeteer/browsers');
  const installed = await browsers.getInstalledBrowsers({ cacheDir: CACHE });
  const hit = installed.find((b) => b.browser === browsers.Browser.CHROMEHEADLESSSHELL);
  return hit ? hit.executablePath : null;
}

/** Downloads chrome-headless-shell into ~/.cache/inkline. Only `inkline setup --with-chrome` calls this. */
async function downloadChrome(log) {
  const browsers = require('@puppeteer/browsers');
  const platform = browsers.detectBrowserPlatform();
  const browser = browsers.Browser.CHROMEHEADLESSSHELL;
  const buildId = await browsers.resolveBuildId(browser, platform, 'stable');
  log && log(`downloading headless Chrome ${buildId} (~90 MB) into ${CACHE} …`);
  const res = await browsers.install({ browser, buildId, cacheDir: CACHE, platform });
  return res.executablePath;
}

async function resolveChrome() {
  const found = findSystemChrome() || (await findCachedChrome());
  if (found) return found;
  throw new Error(
    'No Chrome, Edge, Chromium or Brave found. Install one, set INKLINE_CHROME=/path/to/chrome, ' +
      'or run `inkline setup --with-chrome` to download headless Chrome (~90 MB) into ~/.cache/inkline.'
  );
}

async function launch(log) {
  const puppeteer = require('puppeteer-core');
  const executablePath = await resolveChrome();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--allow-file-access-from-files',
      '--enable-experimental-web-platform-features',
      '--disable-web-security',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-color-profile=srgb',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    protocolTimeout: 600000,
  });
  return { browser, executablePath };
}

const COMPOSITION = path.join(__dirname, '..', 'core', 'composition.html');

async function openComposition(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width: Math.min(width, 4096), height: Math.min(height, 4096), deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + COMPOSITION, { waitUntil: 'load' });
  page.inklineErrors = errors;
  return page;
}

module.exports = { launch, resolveChrome, findSystemChrome, findCachedChrome, downloadChrome, hasModule, openComposition, CACHE };
