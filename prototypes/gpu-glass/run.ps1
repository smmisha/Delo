$ErrorActionPreference = 'Stop'
$probeExe = Join-Path $PSScriptRoot 'bin/Delo.GPUProbe.exe'
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Run build.ps1 first.' }
$probeFailures = 0
foreach ($probeCase in @('--internal', '--external')) {
    $probeProcess = Start-Process -FilePath $probeExe -ArgumentList $probeCase -WindowStyle Hidden -PassThru
    try {
        if (-not $probeProcess.WaitForExit(15000)) {
            $probeProcess.Kill()
            $probeProcess.WaitForExit()
            throw "Own GPU probe timed out: $probeCase"
        }
        Write-Output "$probeCase : exit $($probeProcess.ExitCode)"
        if ($probeProcess.ExitCode -ne 0) { $probeFailures++ }
    }
    finally { $probeProcess.Dispose() }
}
if ($probeFailures) { throw "$probeFailures scenarios did not pass; inspect bin/*/checks.jsonl." }
