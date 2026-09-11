param([string]$Version='0.1.1',[string]$Compiler)
$ErrorActionPreference='Stop'
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Version must be major.minor.patch'}
if(-not $Compiler){$Compiler=Join-Path $PSScriptRoot 'vendor/inno/ISCC.exe'}
if(-not(Test-Path -LiteralPath $Compiler)){throw 'Set -Compiler to Inno Setup 6.7 or newer ISCC.exe.'}
$runtime=Join-Path $PSScriptRoot 'vendor/distribution/MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
if(-not(Test-Path -LiteralPath $runtime)){throw 'Run setup-distribution.ps1 to download WebView2 Runtime.'}
$signature=Get-AuthenticodeSignature -LiteralPath $runtime
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'WebView2 Runtime signature is not valid Microsoft code.'}
& (Join-Path $PSScriptRoot 'build.ps1') -Version $Version
& $Compiler "/DAppVersion=$Version" (Join-Path $PSScriptRoot 'installer/Delo.iss')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
$package=Join-Path $PSScriptRoot "dist/Delo-$Version-windows-x64-setup.exe"
$hash=(Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$package.sha256" -Value "$hash  $([IO.Path]::GetFileName($package))" -Encoding ascii
Write-Output $package
