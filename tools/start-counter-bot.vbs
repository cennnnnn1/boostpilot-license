Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%discord-ticket-bot%'")
If procs.Count > 0 Then WScript.Quit
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" ""C:\Users\cenn\Documents\Default Project\eldorado-bot\tools\discord-ticket-bot.mjs""", 0, False
