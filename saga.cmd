@echo off
chcp 65001 >nul
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0ai\cli.js" %*
set "RC=%ERRORLEVEL%"
exit /b %RC%
