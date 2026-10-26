@echo off
cd /d "%~dp0"
call env.bat
if errorlevel 1 goto failed
if defined PLUGIN_DIR (
  node build.mjs --deploy
) else (
  echo [Info] Watch build only. Set PLUGIN_DIR in env.local.bat to enable deployment.
  node build.mjs
)
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo [ERROR] Watch build failed. See the message above.
pause
exit /b 1
