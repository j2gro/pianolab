#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$script = Join-Path $PSScriptRoot "home-serve.ps1"
$taskName = "Pianolab Home"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -SkipBuild" `
  -WorkingDirectory "$RepoRoot"

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task '$taskName' (runs at logon, restarts on crash)."
Write-Host "Rebuild after code changes: powershell -File scripts\home-serve.ps1"
Write-Host "Start now: Start-ScheduledTask -TaskName '$taskName'"

try {
  Get-NetFirewallRule -DisplayName "Pianolab Home" -ErrorAction Stop | Out-Null
} catch {
  try {
    New-NetFirewallRule -DisplayName "Pianolab Home" -Direction Inbound -Protocol TCP -LocalPort 8080,8443 -Action Allow | Out-Null
    Write-Host "Opened Windows Firewall for TCP 8080 and 8443."
  } catch {
    Write-Warning "Could not add a firewall rule (try an elevated PowerShell): New-NetFirewallRule -DisplayName 'Pianolab Home' -Direction Inbound -Protocol TCP -LocalPort 8080,8443 -Action Allow"
  }
}
