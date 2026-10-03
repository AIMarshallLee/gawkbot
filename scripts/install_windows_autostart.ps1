$RepoDir = (Get-Item $PSScriptRoot).Parent.FullName
$StartupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = Join-Path $StartupDir "kunlun_bus_daemon.vbs"

$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$RepoDir"
WshShell.Run "pythonw scripts\kunlun_mqtt.py listen", 0, False
"@

Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII
Write-Host "[PASS] Kunlun Bus Daemon registered to Windows Startup!"
Write-Host "File: $VbsPath"
