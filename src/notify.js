import { exec } from 'node:child_process';

export function notifyWindows(title, message) {
  const esc = (s) => s.replace(/'/g, "''");
  const ps = `
$ErrorActionPreference='Stop'
$t = New-Object System.Windows.Forms.NotifyIcon -Property @{
  Icon = [System.Drawing.SystemIcons]::Information
  Visible = $true
  BalloonTipTitle = '${esc(title)}'
  BalloonTipText = '${esc(message)}'
}
$t.ShowBalloonTip(10000)
Start-Sleep -Milliseconds 10500
$t.Dispose()
`;
  try {
    exec(`powershell -NoProfile -STA -Command "& { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ${ps.replace(/\n/g, ' ')} }"`, { windowsHide: true });
  } catch {}
}
