$ErrorActionPreference='Stop'
# Fixed upstream artifacts; network is used only by this build-time setup script.
$cache=Join-Path $PSScriptRoot 'vendor/whisper-download'
$target=Join-Path $PSScriptRoot 'vendor/voice'
New-Item -ItemType Directory -Path $cache,$target -Force | Out-Null
function DownloadChecked($url,$file,$hash){
 if((Test-Path -LiteralPath $file) -and (Get-FileHash -LiteralPath $file).Hash -eq $hash){return}
 Invoke-WebRequest -Uri $url -OutFile "$file.partial" -TimeoutSec 600
 if((Get-FileHash -LiteralPath "$file.partial").Hash -ne $hash){throw "Checksum mismatch: $file"}
 Move-Item -LiteralPath "$file.partial" -Destination $file -Force
}
DownloadChecked 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip' (Join-Path $cache 'windows.zip') 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c'
Expand-Archive -LiteralPath (Join-Path $cache 'windows.zip') -DestinationPath (Join-Path $cache 'extracted') -Force
$release=Join-Path $cache 'extracted/Release'
foreach($file in @('whisper-cli.exe','whisper.dll','ggml.dll','ggml-base.dll')){Copy-Item -LiteralPath (Join-Path $release $file) -Destination $target -Force}
Get-ChildItem -LiteralPath $release -Filter 'ggml-cpu-*.dll' | Copy-Item -Destination $target -Force
# Whisper's upstream Windows build links the CRT and OpenMP dynamically.
# Ship Microsoft's redistributable release DLLs beside it, never SDK/debug DLLs.
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vcRoot=Split-Path (Split-Path (Split-Path $toolchain.VC))
$redistRoot=Join-Path $vcRoot 'Redist/MSVC'
$redist=Get-ChildItem -LiteralPath $redistRoot -Directory | Where-Object Name -match '^\d+\.\d+\.\d+$' | Sort-Object {[version]$_.Name} -Descending | Select-Object -First 1
if(-not $redist){throw 'Visual C++ x64 redistributable files are missing.'}
foreach($library in @('CRT','OpenMP')){
 $folder=Get-ChildItem -LiteralPath (Join-Path $redist.FullName 'x64') -Directory | Where-Object Name -like "Microsoft.VC*.$library" | Select-Object -First 1
 if(-not $folder){throw "Visual C++ $library redistributable files are missing."}
 foreach($dll in (Get-ChildItem -LiteralPath $folder.FullName -Filter '*.dll')){
  $signature=Get-AuthenticodeSignature -LiteralPath $dll.FullName
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw "Invalid Microsoft redistributable signature: $($dll.Name)"}
  Copy-Item -LiteralPath $dll.FullName -Destination $target -Force
 }
}
DownloadChecked 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin' (Join-Path $target 'ggml-small-q5_1.bin') 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'
Invoke-WebRequest 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/b5130/LICENSE' -OutFile (Join-Path $target 'whisper.cpp-LICENSE.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE' -OutFile (Join-Path $target 'Whisper-model-LICENSE.txt')
Get-ChildItem -LiteralPath $target -File | Where-Object Name -ne 'manifest.json' | ForEach-Object {@{file=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8
Write-Output "Local voice runtime ready: $target"
