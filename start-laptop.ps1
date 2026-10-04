$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
    Push-Location $appDir
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    } finally {
        Pop-Location
    }
}

$listener = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

$info = Invoke-RestMethod 'http://127.0.0.1:7777/api/info' -TimeoutSec 5
Start-Process 'http://localhost:7777/'
Start-Process 'http://localhost:7777/content-routes.html'

Add-Type -AssemblyName PresentationFramework
$phoneUrl = if ($info.serverUrl) { $info.serverUrl } else { 'http://<IP-LAPTOP>:7777' }
[System.Windows.MessageBox]::Show(
    "LAN Transit Hub đang chạy.`n`nĐiện thoại cùng Wi-Fi mở:`n$phoneUrl`n`nLaptop đã mở trang truyền file và Content Routes.",
    'LAN Transit Hub',
    'OK',
    'Information'
) | Out-Null
