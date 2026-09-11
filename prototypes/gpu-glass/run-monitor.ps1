$ErrorActionPreference = 'Stop'
$probeExe = Join-Path $PSScriptRoot 'bin/Delo.MonitorProbe.exe'
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Run build-monitor.ps1 first.' }
$probeProcess = Start-Process -FilePath $probeExe -WindowStyle Hidden -PassThru
try {
    if (-not $probeProcess.WaitForExit(25000)) {
        $probeProcess.Kill()
        $probeProcess.WaitForExit()
        throw 'Own monitor probe timed out.'
    }
    Write-Output "Monitor probe: exit $($probeProcess.ExitCode)"
    if ($probeProcess.ExitCode -ne 0) { throw 'Monitor checks did not pass; inspect bin/monitor-*/checks.jsonl.' }
}
finally { $probeProcess.Dispose() }
