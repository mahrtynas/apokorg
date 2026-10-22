# Smoke test for a built app (used by .github/workflows/desktop.yml): starts it in mock mode,
# searches through its sidecar, closes the window like a user would, and checks that no
# sidecar process is left behind.
param([string]$App = "$PSScriptRoot\..\src-tauri\target\release\apokorg.exe")
$ErrorActionPreference = 'Stop'

$app = Start-Process -FilePath $App -ArgumentList '--mock' -PassThru

$server = $null
for ($i = 0; $i -lt 60 -and -not $server; $i++) {
  Start-Sleep -Milliseconds 500
  $server = Get-Process -Name 'apokorg-server' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $server) { throw 'The sidecar did not start' }
Write-Host "app pid $($app.Id), sidecar pid $($server.Id)"

$port = $null
for ($i = 0; $i -lt 60 -and -not $port; $i++) {
  Start-Sleep -Milliseconds 500
  $port = (Get-NetTCPConnection -State Listen -OwningProcess $server.Id -ErrorAction SilentlyContinue |
      Select-Object -First 1).LocalPort
}
if (-not $port) { throw 'The sidecar is not listening' }

$body = '{"query":"alvedon"}'
$res = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/search" `
  -ContentType 'application/json' -Body $body
Write-Host "search on port ${port}: $($res.results.Count) result(s)"
if ($res.results.Count -lt 1) { throw 'Mock search returned no results' }

# Wait for the window, then close it (WM_CLOSE), not kill.
for ($i = 0; $i -lt 60; $i++) {
  $app.Refresh()
  if ($app.MainWindowHandle -ne 0) { break }
  Start-Sleep -Milliseconds 500
}
Write-Host "window title: '$($app.MainWindowTitle)'"
if ($app.MainWindowTitle -ne 'apokorg') { throw 'Main window titled "apokorg" not found' }
[void]$app.CloseMainWindow()
if (-not $app.WaitForExit(15000)) { throw 'The app did not exit after closing its window' }

Start-Sleep -Seconds 1
tasklist /fi 'imagename eq apokorg-server.exe'
if (Get-Process -Name 'apokorg-server' -ErrorAction SilentlyContinue) { throw 'Orphaned sidecar' }
Write-Host 'OK: no sidecar left after closing the window'
