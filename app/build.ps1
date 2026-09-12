param([Alias('Version')][string]$AppVersion='0.1.2',[string]$OutputDirectory)
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
 & "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$sdkVersion/ucrt" "/I$sdk/Include/$sdkVersion/shared" "/I$sdk/Include/$sdkVersion/um" "/I$sdk/Include/$sdkVersion/winrt" "/I$sdk/Include/$sdkVersion/cppwinrt" "/I$webview/build/native/include" "/Fo$out/" "$PSScriptRoot/native/Host.cpp" "$PSScriptRoot/native/GlassRenderer.cpp" "$out/Delo.res" /link /SUBSYSTEM:WINDOWS /MANIFEST:EMBED "/MANIFESTINPUT:$PSScriptRoot/native/app.manifest" "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$sdkVersion/um/x64" "/LIBPATH:$sdk/Lib/$sdkVersion/ucrt/x64" "$webview/build/native/x64/WebView2LoaderStatic.lib" WindowsApp.lib D3D11.lib DXGI.lib D3DCompiler.lib Dcomp.lib Windowscodecs.lib User32.lib Gdi32.lib Dwmapi.lib CoreMessaging.lib Wtsapi32.lib Shell32.lib Ole32.lib Shlwapi.lib Advapi32.lib Version.lib "/OUT:$out/Delo.exe"
 if($LASTEXITCODE -ne 0){throw 'Delo compilation failed'}
 Copy-Item -LiteralPath "$PSScriptRoot/native/Glass.hlsl" -Destination $out -Force
 foreach($folder in @('ui','core')){$target=Join-Path $out $folder;if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}Copy-Item -LiteralPath "$PSScriptRoot/$folder" -Destination $out -Recurse -Force}
} finally {$env:PATH=$oldPath}
