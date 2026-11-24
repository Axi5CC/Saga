@echo off
chcp 65001 >nul
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\Saga.exe" "%~dp0cli.js" %*
set "RC=%ERRORLEVEL%"
exit /b %RC%
