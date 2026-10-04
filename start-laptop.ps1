$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Show-ErrorMessage([string]$message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, 'LAN Transit Hub', 'OK', 'Error') | Out-Null
}

try {
    if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
        Push-Location $appDir
        try {
            & npm.cmd ci
            if ($LASTEXITCODE -ne 0) { throw 'Cannot install Node.js dependencies.' }
        } finally { Pop-Location }
    }

    $adbCommand = Get-Command adb.exe -ErrorAction Stop
    $adbDir = Split-Path -Parent $adbCommand.Source
    $scrcpyExe = Join-Path $adbDir 'scrcpy.exe'

    & $adbCommand.Source start-server | Out-Null
    $deviceLines = & $adbCommand.Source devices -l
    $deviceLine = $deviceLines | Select-String '\sdevice\s' | Select-Object -First 1
    if (-not $deviceLine) {
        throw 'Android USB not found. Enable USB debugging and tap Allow on the phone.'
    }

    $serverListener = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue
    if (-not $serverListener) {
        Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }

    $bridgeRunning = Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*scrcpy_bridge.py*' } |
        Select-Object -First 1
    if (-not $bridgeRunning) {
        $pythonWindowless = Get-Command pythonw.exe -ErrorAction SilentlyContinue
        $pythonExe = if ($pythonWindowless) { $pythonWindowless.Source } else { (Get-Command python.exe -ErrorAction Stop).Source }
        Start-Process -FilePath $pythonExe -ArgumentList @('scrcpy_bridge.py', 'http://127.0.0.1:7777') -WorkingDirectory $appDir -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }

    if ((Test-Path $scrcpyExe) -and -not (Get-Process scrcpy -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $scrcpyExe -ArgumentList @('--stay-awake') -WorkingDirectory $adbDir
    }

    Start-Process 'http://localhost:7777/simple.html'
} catch {
    Show-ErrorMessage $_.Exception.Message
    exit 1
}
