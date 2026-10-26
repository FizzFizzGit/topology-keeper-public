@echo off
rem Build and deploy when a local PLUGIN_DIR has been configured.
cd /d "%~dp0"
call env.bat
if errorlevel 1 goto failed
echo [Build] Building main.js...
node build-once.mjs
if errorlevel 1 goto failed
echo [OK] Build completed.
if defined PLUGIN_DIR (
  node deploy.mjs
  if errorlevel 1 goto failed
) else (
  echo [Info] Build only. Set PLUGIN_DIR in env.local.bat to enable deployment.
)
pause
exit /b 0
:failed
echo [ERROR] Build or deployment failed. See the message above.
pause
exit /b 1
