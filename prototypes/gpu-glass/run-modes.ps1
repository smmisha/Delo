$ErrorActionPreference = 'Stop'
$probeExe = Join-Path $PSScriptRoot 'bin/Delo.WindowModesProbe.exe'
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Run build-modes.ps1 first.' }
$probeProcess = Start-Process -FilePath $probeExe -WindowStyle Hidden -PassThru
try {
    if (-not $probeProcess.WaitForExit(30000)) {
        throw "Own probe still running (PID $($probeProcess.Id)); do not start a duplicate."
    }
    Write-Output "Window modes: exit $($probeProcess.ExitCode)"
    if ($probeProcess.ExitCode -ne 0) { throw 'Window mode checks failed; inspect bin/owner-modes-*/checks.jsonl.' }
}
finally { $probeProcess.Dispose() }
