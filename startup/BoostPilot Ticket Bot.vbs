' Autostart BoostPilot ticket bot (ventas por Discord) al iniciar sesion.
' Evita duplicados: no arranca si ya hay una instancia corriendo.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\bru\Documents\Default Project\eldorado-bot\tools\autostart-ticket-bot.ps1""", 0, False
