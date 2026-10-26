@echo off
rem Use the node in this folder for this window only (no system settings are changed).
rem Deployment is opt-in. Set PLUGIN_DIR in your shell or ignored env.local.bat.
if exist "%~dp0env.local.bat" call "%~dp0env.local.bat"
rem Works whether node.exe is in "node" or one level deeper (e.g. node\node-v22.0.0-win-x64).
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
for /d %%d in ("%~dp0node\*") do if exist "%%d\node.exe" set "PATH=%%d;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 24 or place it in the node folder.
  exit /b 1
)
exit /b 0
