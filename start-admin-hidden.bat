@echo off
REM Arranca el Web Admin (BoostPilot) oculto: carga .env y usa el Node portable.
cd /d "C:\Users\bru\Documents\Default Project\eldorado-bot"
for /f "delims=" %%a in (.env) do set "%%a"
"launcher\resources\node\node.exe" tools\remote-admin.mjs --port 8080 >> "%TEMP%\elbot-remote-admin.log" 2>&1