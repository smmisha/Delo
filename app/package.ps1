param([string]$Version='0.1.5',[string]$Compiler,[switch]$Offline)
$ErrorActionPreference='Stop'
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Version must be major.minor.patch'}
if(-not $Compiler){$Compiler=Join-Path $PSScriptRoot 'vendor/inno/ISCC.exe'}
if(-not(Test-Path -LiteralPath $Compiler)){throw 'Set -Compiler to Inno Setup 6.7 or newer ISCC.exe.'}
$runtime=Join-Path $PSScriptRoot 'vendor/distribution/MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
if(-not(Test-Path -LiteralPath $runtime)){throw 'Run setup-distribution.ps1 to download WebView2 Runtime.'}
$signature=Get-AuthenticodeSignature -LiteralPath $runtime
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'WebView2 Runtime signature is not valid Microsoft code.'}
& (Join-Path $PSScriptRoot 'build.ps1') -Version $Version
# Default build carries the 2 MB bootstrapper; -Offline embeds the full runtime for
# machines that will never see the network.
$defines=@("/DAppVersion=$Version")
if($Offline){$defines+='/DOffline'}
$payload=Join-Path $PSScriptRoot ('vendor/distribution/' + $(if($Offline){'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'}else{'MicrosoftEdgeWebView2Setup.exe'}))
if(-not(Test-Path -LiteralPath $payload)){throw "Missing $payload. Run setup-distribution.ps1 first."}
& $Compiler @defines (Join-Path $PSScriptRoot 'installer/Delo.iss')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
$package=Join-Path $PSScriptRoot "dist/Delo-$Version-windows-x64-setup.exe"
$hash=(Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$package.sha256" -Value "$hash  $([IO.Path]::GetFileName($package))" -Encoding ascii
Write-Output $package
