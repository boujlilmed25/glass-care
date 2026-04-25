@echo off
setlocal
cd /d "%~dp0"

echo Starting Drivo local preview server on http://127.0.0.1:5500
start "Drivo Local Server" cmd /k "cd /d \"%~dp0\" && python -m http.server 5500"

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5500/drivo-admin.html"
