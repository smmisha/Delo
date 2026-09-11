$ErrorActionPreference = 'Stop'
$probeCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $probeCompiler)) { throw 'The .NET Framework x64 compiler is unavailable.' }
$probeOutput = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $probeOutput -Force | Out-Null
& $probeCompiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/win32manifest:$PSScriptRoot/app.manifest" "/out:$probeOutput/Delo.LayerProbe.exe" (Join-Path $PSScriptRoot 'Probe.cs')
if ($LASTEXITCODE -ne 0) { throw 'Probe compilation failed.' }
Write-Output (Join-Path $probeOutput 'Delo.LayerProbe.exe')
