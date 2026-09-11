param([switch]$ManualSleep, [switch]$Soak, [switch]$Profile)
$ErrorActionPreference = 'Stop'
if (([int]$ManualSleep.IsPresent + [int]$Soak.IsPresent + [int]$Profile.IsPresent) -gt 1) { throw 'Choose only one of ManualSleep, Soak, or Profile.' }
$probeExe = Join-Path $PSScriptRoot 'bin/Delo.StabilityProbe.exe'
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Build first: ./build-stability.ps1' }
if (Get-Process -Name Delo.StabilityProbe,Delo.WindowModesProbe,Delo.MonitorProbe -ErrorAction SilentlyContinue) {
    throw 'Another Delo probe is running. Finish it before starting this test.'
}
$probeArgs = @{ FilePath = $probeExe; WindowStyle = 'Hidden'; PassThru = $true }
if ($ManualSleep) { $probeArgs.ArgumentList = '--manual' }
if ($Soak) { $probeArgs.ArgumentList = '--soak' }
if ($Profile) { $probeArgs.ArgumentList = '--profile' }
$probeProcess = Start-Process @probeArgs
$probeTimeout = if ($ManualSleep) { 660000 } elseif ($Soak) { 420000 } else { 180000 }
if (-not $probeProcess.WaitForExit($probeTimeout)) { throw "Own probe still running: $($probeProcess.Id). Inspect its log before retrying." }
$probeLatest = Get-ChildItem (Join-Path $PSScriptRoot 'bin') -Directory -Filter 'stability-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content (Join-Path $probeLatest.FullName 'checks.jsonl')
if ($probeProcess.ExitCode -ne 0) { throw "Stability probe failed: $($probeProcess.ExitCode)" }
