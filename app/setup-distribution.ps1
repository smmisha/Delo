$ErrorActionPreference='Stop'
$directory=Join-Path $PSScriptRoot 'vendor/distribution'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$file=Join-Path $directory 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile $file
$signature=Get-AuthenticodeSignature -LiteralPath $file
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Runtime download does not have a valid Microsoft signature.'}
[PSCustomObject]@{File=$file;SHA256=(Get-FileHash -LiteralPath $file).Hash;Publisher=$signature.SignerCertificate.Subject} | ConvertTo-Json | Set-Content (Join-Path $directory 'runtime-receipt.json')
# Evergreen bootstrapper: the default payload. It is ~2 MB and pulls the runtime at
# install time, so only machines without WebView2 download anything.
$bootstrap=Join-Path $directory 'MicrosoftEdgeWebView2Setup.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap
$bootSignature=Get-AuthenticodeSignature -LiteralPath $bootstrap
if($bootSignature.Status -ne 'Valid' -or $bootSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Bootstrapper download does not have a valid Microsoft signature.'}
[PSCustomObject]@{File=$bootstrap;SHA256=(Get-FileHash -LiteralPath $bootstrap).Hash;Publisher=$bootSignature.SignerCertificate.Subject} | ConvertTo-Json | Set-Content (Join-Path $directory 'bootstrapper-receipt.json')
Write-Output 'Verified Microsoft WebView2 standalone installer and evergreen bootstrapper (x64).'
