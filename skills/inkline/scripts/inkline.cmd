@echo off
rem inkline launcher for Windows. Installs nothing on its own: `inkline setup` is the only command that does.
rem Engine packages live in %INKLINE_DATA%\engine (Claude Code passes its plugin data dir) or %LOCALAPPDATA%\inkline\engine.
setlocal
set "ENGINE=%~dp0..\engine"
where node >nul 2>nul || (echo inkline · error: Node.js 18+ is required. Install the LTS from https://nodejs.org 1>&2 & exit /b 1)
if "%INKLINE_DATA%"=="" (set "DATA=%LOCALAPPDATA%\inkline") else (set "DATA=%INKLINE_DATA%")
set "HOME_DIR=%DATA%\engine"
set "MODULES=%HOME_DIR%\node_modules"
set STATE=ready
if not exist "%MODULES%\puppeteer-core" set STATE=missing
if not exist "%MODULES%\@puppeteer\browsers" set STATE=missing
if not exist "%MODULES%\ffmpeg-static" set STATE=missing
if "%STATE%"=="ready" (
  fc /b "%ENGINE%\package-lock.json" "%HOME_DIR%\package-lock.json" >nul 2>nul || set STATE=outdated
)
set "NODE_PATH=%MODULES%"
set "INKLINE_ENGINE_HOME=%HOME_DIR%"
set "INKLINE_ENGINE_STATE=%STATE%"
if /i "%~1"=="setup" (
  if not "%STATE%"=="ready" (
    echo inkline · installing the render engine into %HOME_DIR% ^(puppeteer-core, @puppeteer/browsers, ffmpeg-static, about 80 MB^) 1>&2
    if not exist "%HOME_DIR%" mkdir "%HOME_DIR%"
    copy /y "%ENGINE%\package.json" "%HOME_DIR%\" >nul
    copy /y "%ENGINE%\package-lock.json" "%HOME_DIR%\" >nul
    pushd "%HOME_DIR%" && call npm ci --omit=dev --no-audit --no-fund --loglevel=error 1>&2 && popd
    set "INKLINE_ENGINE_STATE=ready"
  )
  goto run
)
for %%c in (help -h --help -v --version doctor styles style) do if /i "%~1"=="%%c" goto run
if "%~1"=="" goto run
if not "%STATE%"=="ready" (
  echo inkline · setup required: run `inkline setup` to install or update the render engine ^(about 80 MB, into %HOME_DIR%^). `inkline doctor` shows the details. 1>&2
  exit /b 3
)
:run
node "%ENGINE%\bin\inkline.js" %*
