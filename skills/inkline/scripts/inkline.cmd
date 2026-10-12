@echo off
rem inkline launcher for Windows. Installs nothing on its own: `inkline setup` is the only command that does.
setlocal
set "ENGINE=%~dp0..\engine"
where node >nul 2>nul || (echo inkline · error: Node.js 18+ is required. Install the LTS from https://nodejs.org 1>&2 & exit /b 1)
set READY=1
if not exist "%ENGINE%\node_modules\puppeteer-core" set READY=0
if not exist "%ENGINE%\node_modules\@puppeteer\browsers" set READY=0
if not exist "%ENGINE%\node_modules\ffmpeg-static" set READY=0
if /i "%~1"=="setup" (
  if "%READY%"=="0" (
    echo inkline · installing the render engine into %ENGINE%\node_modules ^(puppeteer-core, @puppeteer/browsers, ffmpeg-static, about 80 MB^) 1>&2
    pushd "%ENGINE%" && call npm ci --omit=dev --no-audit --no-fund --loglevel=error 1>&2 && popd
  )
  goto run
)
for %%c in (help -h --help -v --version doctor styles style) do if /i "%~1"=="%%c" goto run
if "%~1"=="" goto run
if "%READY%"=="0" (
  echo inkline · setup required: run `inkline setup` to install the render engine ^(about 80 MB^). `inkline doctor` shows the details. 1>&2
  exit /b 3
)
:run
node "%ENGINE%\bin\inkline.js" %*
