@echo off
setlocal
title Bot Eldorado
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en el PATH.
  pause
  exit /b 1
)

echo ==========================================
echo   Bot Eldorado - auto-oferta de boosting
echo   Fast Mode por API (sin Chrome) si esta activo
echo   en config\rules.json (bot.fastMode.enabled).
echo   Panel:   http://localhost:3000
echo   Deja esta ventana abierta mientras corre.
echo ==========================================
echo.

set CDP_URL=http://127.0.0.1:9222

echo [INFO] Comprobando modo...
for /f "usebackq delims=" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$j = Get-Content config\rules.json -Raw | ConvertFrom-Json; if ($j.bot.fastMode.enabled) { 'fast' } else { 'browser' }"`) do set MODE=%%a
if "%MODE%"=="fast" (
  echo [INFO] Fast Mode por API activo: no se necesita Chrome.
  goto cdpok
)

curl -s -o nul %CDP_URL%/json/version
if not errorlevel 1 goto cdpok
goto launch_chrome

:launch_chrome
echo [INFO] Cerrando el Chrome del bot (perfil .profile)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*eldorado-bot*' -and $_.CommandLine -like '*.profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
ping -n 3 127.0.0.1 >nul

start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=*','--user-data-dir=C:\Users\cenn\Documents\Default Project\eldorado-bot\.profile','--profile-directory=Default','https://www.eldorado.gg/dashboard/boosting/received-requests'"

echo [INFO] Esperando que Chrome abra el puerto de depuracion...
set tries=0
:waitcdp
curl -s -o nul %CDP_URL%/json/version
if not errorlevel 1 goto cdpok
set /a tries+=1
if %tries% GEQ 20 goto cdperr
ping -n 2 127.0.0.1 >nul
goto waitcdp

:cdperr
echo [ERROR] Chrome no abrio el puerto 9222 a tiempo.
echo [ERROR] Revisa que no haya otro proceso bloqueando el perfil .profile.
pause
exit /b 1

:cdpok
echo [INFO] Chrome listo.

echo [INFO] Arrancando el bot...
echo.
npm.cmd run bot

echo.
echo [INFO] El bot se detuvo.
echo [INFO] Panel: http://localhost:3000 (solo mientras el bot corre)
echo [INFO] Si la sesion expiro, ejecuta "Guardar sesion Eldorado.bat" y repite.
pause
