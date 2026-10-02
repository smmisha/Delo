# Store signs the uploaded package. No certificate or machine trust changes are made here.
param([Alias('Version')][string]$AppVersion='0.3.1',[switch]$SkipBuild)
$ErrorActionPreference='Stop'
if($AppVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'Version must be major.minor.patch'}
$appDirectory=[IO.Path]::GetFullPath($PSScriptRoot)
$work=Join-Path $appDirectory "test-output\msix-$AppVersion"
$build=Join-Path $work 'build'
$stage=Join-Path $work 'stage'
# These are the only directories that this script may clean. Verify resolved paths first.
foreach($target in @($work,$build,$stage)){
 $resolved=[IO.Path]::GetFullPath($target)
 if(-not $resolved.StartsWith($appDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
  throw "Build path is outside app: $resolved"
 }
}
if(-not $SkipBuild){& (Join-Path $appDirectory 'build.ps1') -AppVersion $AppVersion -OutputDirectory $build}
if(-not(Test-Path -LiteralPath (Join-Path $build 'Delo.exe'))){throw 'Build output is missing'}
$actual=(Get-Item -LiteralPath (Join-Path $build 'Delo.exe')).VersionInfo.ProductVersion
if($actual -ne $AppVersion){throw "Executable version $actual does not match package $AppVersion"}
if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach($name in @('Delo.exe','Glass.hlsl','privacy.html')){Copy-Item -LiteralPath (Join-Path $build $name) -Destination $stage}
foreach($folder in @('ui','core')){
 $destination=Join-Path $stage $folder
 New-Item -ItemType Directory -Path $destination | Out-Null
 $extensions=if($folder -eq 'ui'){@('.html','.css','.mjs')}else{@('.mjs')}
 Get-ChildItem -LiteralPath (Join-Path $build $folder) -File |
  Where-Object {$_.Extension -in $extensions} | Copy-Item -Destination $destination
}
$voice=Join-Path $build 'voice'
$voiceTarget=Join-Path $stage 'voice'
New-Item -ItemType Directory -Path $voiceTarget | Out-Null
$voiceManifest=Join-Path $voice 'manifest.json'
foreach($item in (Get-Content -LiteralPath $voiceManifest -Raw | ConvertFrom-Json)){
 if($item.file -ne [IO.Path]::GetFileName($item.file)){throw 'Invalid voice dependency filename'}
 $source=Join-Path $voice $item.file
 if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $item.sha256){throw "Voice checksum mismatch: $($item.file)"}
 Copy-Item -LiteralPath $source -Destination $voiceTarget
}
Copy-Item -LiteralPath $voiceManifest -Destination $voiceTarget
Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $appDirectory) 'LICENSE') -Destination $stage
$licenses=Join-Path $stage 'licenses'
New-Item -ItemType Directory -Path $licenses | Out-Null
foreach($name in @('LICENSE.txt','NOTICE.txt')){
 Copy-Item -LiteralPath (Join-Path $appDirectory "vendor\webview2-1.0.4191.47\$name") -Destination (Join-Path $licenses "WebView2-$name")
}
$identity=Get-Content -LiteralPath (Join-Path $appDirectory 'msix\StoreIdentity.json') -Raw | ConvertFrom-Json
$manifestPath=Join-Path $stage 'AppxManifest.xml'
[xml]$manifest=Get-Content -LiteralPath (Join-Path $appDirectory 'msix\AppxManifest.xml') -Raw
$manifest.Package.Identity.Name=$identity.Name
$manifest.Package.Identity.Publisher=$identity.Publisher
$manifest.Package.Identity.Version="$AppVersion.0"
$manifest.Package.Properties.PublisherDisplayName=$identity.PublisherDisplayName
$manifest.Save($manifestPath)
# Render the existing Delo mark at exact package sizes; don't rescale a small tray icon.
$assets=Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assets | Out-Null
. (Join-Path $appDirectory 'generate-icon.ps1') -Output (Join-Path $work 'Delo.ico') | Out-Null
foreach($asset in @(
 @{Name='StoreLogo';Size=50},@{Name='Square44x44Logo';Size=44},
 @{Name='Square150x150Logo';Size=150},@{Name='Square310x310Logo';Size=310}
)){
 [IO.File]::WriteAllBytes((Join-Path $assets ($asset.Name+'.png')),(New-DeloPng $asset.Size).Bytes)
}
# High-resolution brand artwork for the Store listing.
[IO.File]::WriteAllBytes((Join-Path $work 'Delo-Store-300.png'),(New-DeloPng 300).Bytes)
$toolchain=& (Join-Path $appDirectory 'toolchain.ps1')
$makeappx=Join-Path $toolchain.SDK "bin\$($toolchain.Version)\x64\makeappx.exe"
$dist=Join-Path $appDirectory 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$package=Join-Path $dist "Delo-$AppVersion-store-x64.msix"
& $makeappx pack /d $stage /p $package /o
if($LASTEXITCODE -ne 0){throw 'MSIX validation/packaging failed'}
$hash=(Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
[IO.File]::WriteAllText($package+'.sha256',"$hash  $([IO.Path]::GetFileName($package))`n",[Text.UTF8Encoding]::new($false))
Write-Output ([pscustomobject]@{Package=$package;SHA256=$hash;Stage=$stage;StoreId=$identity.StoreId})
