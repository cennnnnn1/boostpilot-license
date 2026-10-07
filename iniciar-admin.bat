@echo off
REM Inicia el Web Admin (BoostPilot) con la master key de .env
REM Usa el Node portable del launcher (el Node del sistema no esta en PATH).
cd /d "%~dp0."
for /f "delims=" %%a in (.env) do set "%%a"
"launcher\resources\node\node.exe" tools/remote-admin.mjs --port 8080
pause