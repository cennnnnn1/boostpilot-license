' Autostart BoostPilot keys server (store + admin web) al iniciar sesion.
' Oculta la ventana y deja el log en %TEMP%\elbot-remote-admin.log
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\bru\Documents\Default Project\eldorado-bot\tools\autostart-remote-admin.ps1""", 0, False