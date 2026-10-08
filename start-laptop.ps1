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

    $adbCommand = Get-Command adb.exe -ErrorAction SilentlyContinue
    $adbPath = if ($adbCommand) { $adbCommand.Source } else { $null }
    if (-not $adbPath) {
        $adbCandidates = @(
            (Join-Path $env:USERPROFILE 'Documents\scrcpy\adb.exe'),
            (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
        )
        $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        if (Test-Path $wingetRoot) {
            $scrcpyDirs = Get-ChildItem -LiteralPath $wingetRoot -Directory -Filter 'Genymobile.scrcpy*' -ErrorAction SilentlyContinue |
                ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory -Filter 'scrcpy-win64*' -ErrorAction SilentlyContinue }
            $adbCandidates += $scrcpyDirs | Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'adb.exe' }
        }
        $adbPath = $adbCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $adbPath) { throw 'Cannot find adb.exe. Install scrcpy or Android platform-tools.' }

    $adbDir = Split-Path -Parent $adbPath
    $scrcpyExe = Join-Path $adbDir 'scrcpy.exe'

    & $adbPath start-server | Out-Null
    $deviceLines = & $adbPath devices -l
    $deviceLine = $deviceLines | Select-String '\sdevice\s' | Select-Object -First 1
    if (-not $deviceLine) {
        throw 'Android USB not found. Enable USB debugging and tap Allow on the phone.'
    }

    # Let Android turn its own screen off normally while it is connected by USB.
    & $adbPath shell settings put global stay_on_while_plugged_in 0 | Out-Null

    $serverListener = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue
    if (-not $serverListener) {
        Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }

    $bridgeScript = Join-Path $appDir 'scrcpy_bridge.py'
    $bridgeRunning = Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($bridgeScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
        Select-Object -First 1
    if (-not $bridgeRunning) {
        $pythonWindowless = Get-Command pythonw.exe -ErrorAction SilentlyContinue
        $pythonExe = if ($pythonWindowless) { $pythonWindowless.Source } else { (Get-Command python.exe -ErrorAction Stop).Source }
        $bridgeArgs = '"{0}" "http://127.0.0.1:7777"' -f $bridgeScript
        Start-Process -FilePath $pythonExe -ArgumentList $bridgeArgs -WorkingDirectory $appDir -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }

    if ((Test-Path $scrcpyExe) -and -not (Get-Process scrcpy -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $scrcpyExe -ArgumentList '--turn-screen-off --stay-awake' -WorkingDirectory $adbDir
    }

    Start-Process 'http://localhost:7777/simple.html'
} catch {
    Show-ErrorMessage $_.Exception.Message
    exit 1
}
