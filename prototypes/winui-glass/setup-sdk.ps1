$ErrorActionPreference = 'Stop'
$probeTools = Join-Path $PSScriptRoot '.tools'
$probeSdk = Join-Path $probeTools 'dotnet'
if (Test-Path (Join-Path $probeSdk 'sdk/8.0.425/dotnet.dll')) { return }
New-Item -ItemType Directory -Path $probeTools -Force | Out-Null
$probeArchive = Join-Path $probeTools 'dotnet-sdk-8.0.425-win-x64.zip'
$probeHash = 'f0b6f15bf6f1a0507205c0cb102ab99e1dee875c4682c8ed94665be1d580186a06b21455e83b3a01a0ff7f4cd887b67420f2e2fe09ed985534a4cea488ae1af9'
if (-not (Test-Path $probeArchive)) {
    Invoke-WebRequest -Uri 'https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.425/dotnet-sdk-8.0.425-win-x64.zip' -OutFile $probeArchive -TimeoutSec 300
}
if ((Get-FileHash -LiteralPath $probeArchive -Algorithm SHA512).Hash -ne $probeHash) { throw 'SDK SHA512 mismatch.' }
Expand-Archive -LiteralPath $probeArchive -DestinationPath $probeSdk -Force
& (Join-Path $probeSdk 'dotnet.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Local SDK verification failed.' }
