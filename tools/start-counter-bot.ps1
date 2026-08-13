$proc = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'discord-ticket-bot' }
if ($proc) { exit }
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "C:\Users\cenn\Documents\Default Project\eldorado-bot\tools\discord-ticket-bot.mjs" -WorkingDirectory "C:\Users\cenn\Documents\Default Project\eldorado-bot" -WindowStyle Hidden
