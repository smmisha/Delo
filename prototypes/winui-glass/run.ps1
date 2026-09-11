$ErrorActionPreference = 'Stop'
$probeExe = Join-Path $PSScriptRoot 'bin/Release/net8.0-windows10.0.19041.0/win-x64/Delo.WinUIGlassProbe.exe'
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Run build.ps1 first.' }
$failedCases = 0
foreach ($case in @('--standard-host', '--standard-host --dark', '--external', '--external --dark')) {
    $probeProcess = Start-Process -FilePath $probeExe -ArgumentList $case -WindowStyle Hidden -PassThru
    try {
        if (-not $probeProcess.WaitForExit(15000)) {
            # Only this process, created immediately above, is terminated on timeout.
            $probeProcess.Kill()
            $probeProcess.WaitForExit()
            throw "Probe timed out: $case"
        }
        Write-Output "$case : exit $($probeProcess.ExitCode)"
        if ($probeProcess.ExitCode -ne 0) { $failedCases++ }
    }
    finally { $probeProcess.Dispose() }
}
if ($failedCases -gt 0) { throw "$failedCases optics scenarios did not pass. See timestamped artifacts." }
