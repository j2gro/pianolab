#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$taskName = "Pianolab Home"

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed scheduled task '$taskName' (if it existed)."

try {
  Remove-NetFirewallRule -DisplayName "Pianolab Home" -ErrorAction Stop
  Write-Host "Removed firewall rule 'Pianolab Home'."
} catch {
  Write-Host "No firewall rule to remove, or this shell is not elevated."
}
