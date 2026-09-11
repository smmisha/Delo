$ErrorActionPreference = 'Stop'
$env:DOTNET_ROOT = Join-Path $PSScriptRoot '.tools/dotnet'
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.cli'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:NUGET_PACKAGES = Join-Path $PSScriptRoot '.packages'
& (Join-Path $env:DOTNET_ROOT 'dotnet.exe') build (Join-Path $PSScriptRoot 'Delo.WinUIGlassProbe.csproj') -c Release --nologo -p:NuGetAudit=false
if ($LASTEXITCODE -ne 0) { throw 'WinUI probe build failed.' }
