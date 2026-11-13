# Run in PowerShell as Administrator to enable instant Orthanc → PACSD notifications.
# PACSD still polls every 2s without this; Lua makes the first instance appear immediately.

$ErrorActionPreference = "Stop"
$luaSource = Join-Path $PSScriptRoot "orthanc-notify.lua"
$luaDest = "C:\Orthanc\orthanc-notify.lua"
$cfg = "C:\Program Files\Orthanc Server\Configuration\orthanc.json"

if (-not (Test-Path -LiteralPath $luaSource)) { throw "Missing $luaSource" }
Copy-Item -LiteralPath $luaSource -Destination $luaDest -Force

$raw = Get-Content -LiteralPath $cfg -Raw
$escaped = ($luaDest -replace "\\", "\\")
if ($raw -match "orthanc-notify\.lua") {
  Write-Host "LuaScripts already references orthanc-notify.lua"
} elseif ($raw -match '"LuaScripts"\s*:\s*\[\s*\]') {
  $replacement = '"LuaScripts" : [ "' + $escaped + '" ]'
  $new = [regex]::Replace($raw, '"LuaScripts"\s*:\s*\[\s*\]', $replacement, 1)
  Set-Content -LiteralPath $cfg -Value $new -Encoding UTF8
  Write-Host "Updated LuaScripts in orthanc.json"
} else {
  throw "LuaScripts is not empty and does not already include orthanc-notify.lua. Edit orthanc.json manually."
}

Restart-Service Orthanc
Start-Sleep -Seconds 3
Get-Service Orthanc | Format-Table -AutoSize
Write-Host "Done. Push a DICOM to Orthanc and watch the PACSD worklist refresh."
