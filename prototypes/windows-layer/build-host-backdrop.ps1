$ErrorActionPreference = 'Stop'
$probeCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$probeFramework = Split-Path $probeCompiler
$probeMetadata = 'C:/Program Files (x86)/Windows Kits/10/UnionMetadata/10.0.26100.0/Windows.winmd'
$probeRuntime = Get-ChildItem 'C:/Windows/Microsoft.NET/assembly/GAC_MSIL/System.Runtime' -Recurse -Filter System.Runtime.dll | Select-Object -First 1 -ExpandProperty FullName
$probeNumerics = Get-ChildItem 'C:/Windows/Microsoft.NET/assembly/GAC_MSIL/System.Numerics.Vectors' -Recurse -Filter System.Numerics.Vectors.dll | Select-Object -First 1 -ExpandProperty FullName
$probeOutput = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $probeOutput -Force | Out-Null
& $probeCompiler /nologo /target:winexe /main:GlassProgram /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Numerics.dll /reference:System.Web.Extensions.dll "/reference:$probeRuntime" "/reference:$probeNumerics" "/reference:$probeFramework/System.Runtime.WindowsRuntime.dll" "/reference:$probeMetadata" "/win32manifest:$PSScriptRoot/app.manifest" "/out:$probeOutput/Delo.HostBackdropProbe.exe" (Join-Path $PSScriptRoot 'Probe.cs') (Join-Path $PSScriptRoot 'HostBackdropProbe.cs')
if ($LASTEXITCODE -ne 0) { throw 'Host backdrop probe compilation failed.' }
