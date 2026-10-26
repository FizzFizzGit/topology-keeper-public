@echo off
rem Run once. Installs esbuild into node_modules of this folder.
cd /d "%~dp0"
call env.bat
if errorlevel 1 goto failed
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe was not found.
  echo Expected: %~dp0node\node.exe
  echo Extract the contents of the Node.js ZIP into the "node" folder.
  pause
  exit /b 1
)
node -v
call npm ci
if errorlevel 1 goto failed
echo [OK] Dependencies installed.
pause
exit /b 0
:failed
echo [ERROR] Setup failed. See the message above.
pause
exit /b 1
