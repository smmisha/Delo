$ErrorActionPreference='Stop'
$directory=Join-Path $PSScriptRoot 'vendor/distribution'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$file=Join-Path $directory 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile $file
$signature=Get-AuthenticodeSignature -LiteralPath $file
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Runtime download does not have a valid Microsoft signature.'}
[PSCustomObject]@{File=$file;SHA256=(Get-FileHash -LiteralPath $file).Hash;Publisher=$signature.SignerCertificate.Subject} | ConvertTo-Json | Set-Content (Join-Path $directory 'runtime-receipt.json')
Write-Output 'Verified Microsoft WebView2 standalone installer (x64).'
