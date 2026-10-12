@echo off
rem inkline launcher for Windows: installs dependencies on first use, then runs the CLI.
setlocal
set "ENGINE=%~dp0..\engine"
where node >nul 2>nul || (echo inkline · error: Node.js 18+ is required. Install the LTS from https://nodejs.org 1>&2 & exit /b 1)
if not exist "%ENGINE%\node_modules\puppeteer-core" (
  echo inkline · one-time setup: installing the render engine ... 1>&2
  pushd "%ENGINE%" && call npm install --omit=dev --no-audit --no-fund --loglevel=error 1>&2 && popd
)
node "%ENGINE%\bin\inkline.js" %*
