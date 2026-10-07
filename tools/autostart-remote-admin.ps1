Set-Location 'C:\Users\bru\Documents\Default Project\eldorado-bot'
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$log = Join-Path $env:TEMP 'elbot-remote-admin.log'
Start-Process node -ArgumentList 'tools/remote-admin.mjs' -WorkingDirectory 'C:\Users\bru\Documents\Default Project\eldorado-bot' -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $log