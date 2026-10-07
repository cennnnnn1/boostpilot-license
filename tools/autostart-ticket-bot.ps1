$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'discord-ticket-bot\.mjs' }
if ($existing) { exit 0 }
Set-Location 'C:\Users\bru\Documents\Default Project\eldorado-bot'
Start-Process node -ArgumentList 'tools/discord-ticket-bot.mjs' -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\elbot-ticket-bot.log" -RedirectStandardError "$env:TEMP\elbot-ticket-bot.err"