# -SkipVoice builds without copying the local Whisper runtime: CI compiles and tests, it does not package.
param([Alias('Version')][string]$AppVersion='0.3.4',[string]$OutputDirectory,[switch]$SkipVoice)
$ErrorActionPreference='Stop'
if($AppVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$'){throw 'Version must be major.minor.patch'}
$major=[int]$Matches[1];$minor=[int]$Matches[2];$patch=[int]$Matches[3]
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$sdkVersion=$toolchain.Version
$webview=Join-Path $PSScriptRoot 'vendor/webview2-1.0.4191.47'
if(-not(Test-Path "$webview/build/native/include/WebView2.h")){throw 'Run setup.ps1 to restore WebView2 SDK.'}
$out=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $PSScriptRoot 'bin'}
New-Item -ItemType Directory -Path $out -Force | Out-Null
$oldPath=$env:PATH
try {
 $env:PATH="$sdk/bin/$sdkVersion/x64;"+$env:PATH
 @(
  "#define DELO_FILE_VERSION $major,$minor,$patch,0"
  "#define DELO_FILE_VERSION_STRING `"$AppVersion.0`""
  "#define DELO_PRODUCT_VERSION_STRING `"$AppVersion`""
 ) | Set-Content -LiteralPath "$out/DeloVersion.rcinc" -Encoding ascii
 & "$sdk/bin/$sdkVersion/x64/rc.exe" /nologo "/i$out" "/i$sdk/Include/$sdkVersion/um" "/i$sdk/Include/$sdkVersion/shared" "/fo$out/Delo.res" "$PSScriptRoot/native/Delo.rc"
 if($LASTEXITCODE -ne 0){throw 'Delo resource compilation failed'}
 # C++/WinRT under /std:c++17 still includes <experimental/coroutine>; MSVC 14.5x (VS 18) refuses
 # it unless the deprecation is silenced. Older compilers ignore the define.
 & "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$sdkVersion/ucrt" "/I$sdk/Include/$sdkVersion/shared" "/I$sdk/Include/$sdkVersion/um" "/I$sdk/Include/$sdkVersion/winrt" "/I$sdk/Include/$sdkVersion/cppwinrt" "/I$webview/build/native/include" "/Fo$out/" "$PSScriptRoot/native/Host.cpp" "$PSScriptRoot/native/GlassRenderer.cpp" "$out/Delo.res" /link /SUBSYSTEM:WINDOWS /MANIFEST:EMBED "/MANIFESTINPUT:$PSScriptRoot/native/app.manifest" "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$sdkVersion/um/x64" "/LIBPATH:$sdk/Lib/$sdkVersion/ucrt/x64" "$webview/build/native/x64/WebView2LoaderStatic.lib" WindowsApp.lib D3D11.lib DXGI.lib D3DCompiler.lib Dcomp.lib Windowscodecs.lib User32.lib Gdi32.lib Dwmapi.lib CoreMessaging.lib Wtsapi32.lib Shell32.lib Ole32.lib Shlwapi.lib Advapi32.lib Version.lib "/OUT:$out/Delo.exe"
 if($LASTEXITCODE -ne 0){throw 'Delo compilation failed'}
 Copy-Item -LiteralPath "$PSScriptRoot/native/Glass.hlsl" -Destination $out -Force
 # Keep the policy inside the installed app and generate it from the single source.
 $policy=Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'PRIVACY.md') -Raw
 $policyHtml=foreach($paragraph in ($policy -split '(?:\r?\n){2,}')){
  $paragraph=$paragraph.Trim();if(-not $paragraph){continue}
  $tag=if($paragraph.StartsWith('## ')){'h2'}elseif($paragraph.StartsWith('# ')){'h1'}else{'p'}
  $value=[Net.WebUtility]::HtmlEncode(($paragraph -replace '^#{1,2} ',''))
  "<$tag>$value</$tag>"
 }
 $html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Delo privacy policy</title><style>body{font:16px/1.6 system-ui;max-width:800px;margin:40px auto;padding:0 24px;color:#182535;background:#fff}h1,h2{line-height:1.25}p{overflow-wrap:anywhere}</style><main>'+($policyHtml -join "`n")+'</main></html>'
 [IO.File]::WriteAllText((Join-Path $out 'privacy.html'),$html,[Text.UTF8Encoding]::new($false))
 foreach($folder in @('ui','core')){$target=Join-Path $out $folder;if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}Copy-Item -LiteralPath "$PSScriptRoot/$folder" -Destination $out -Recurse -Force}
 if(-not $SkipVoice){
 $voice=Join-Path $PSScriptRoot 'vendor/voice'
 if(-not(Test-Path -LiteralPath (Join-Path $voice 'manifest.json'))){throw 'Run setup-voice.ps1 to restore the local Whisper runtime.'}
 foreach($item in (Get-Content -LiteralPath (Join-Path $voice 'manifest.json') -Raw | ConvertFrom-Json)){
  if((Get-FileHash -LiteralPath (Join-Path $voice $item.file)).Hash -ne $item.sha256){throw "Voice dependency checksum mismatch: $($item.file)"}
 }
 $voiceTarget=Join-Path $out 'voice';New-Item -ItemType Directory -Path $voiceTarget -Force | Out-Null
 Get-ChildItem -LiteralPath $voice -File | Copy-Item -Destination $voiceTarget -Force
 }
} finally {$env:PATH=$oldPath}
