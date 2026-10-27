# Uses the real host with a controlled child process; never runs an installer.
$ErrorActionPreference='Stop'
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$sdkVersion=$toolchain.Version
$webview=Join-Path $PSScriptRoot 'vendor/webview2-1.0.4191.47'
$out=Join-Path $PSScriptRoot 'bin/updater-wait'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$oldPath=$env:PATH
try {
 $env:PATH="$sdk/bin/$sdkVersion/x64;"+$env:PATH
 & "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$sdkVersion/ucrt" "/I$sdk/Include/$sdkVersion/shared" "/I$sdk/Include/$sdkVersion/um" "/I$sdk/Include/$sdkVersion/winrt" "/I$sdk/Include/$sdkVersion/cppwinrt" "/I$webview/build/native/include" "/Fo$out/" "$PSScriptRoot/tests/updater-wait.cpp" "$PSScriptRoot/native/GlassRenderer.cpp" /link /SUBSYSTEM:CONSOLE /MANIFEST:EMBED "/MANIFESTINPUT:$PSScriptRoot/native/app.manifest" "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$sdkVersion/um/x64" "/LIBPATH:$sdk/Lib/$sdkVersion/ucrt/x64" "$webview/build/native/x64/WebView2LoaderStatic.lib" WindowsApp.lib D3D11.lib DXGI.lib D3DCompiler.lib Dcomp.lib Windowscodecs.lib User32.lib Gdi32.lib Dwmapi.lib CoreMessaging.lib Wtsapi32.lib Shell32.lib Ole32.lib Shlwapi.lib Advapi32.lib Version.lib "/OUT:$out/updater-wait-test.exe"
} finally {$env:PATH=$oldPath}
if($LASTEXITCODE -ne 0){throw 'Updater wait test compilation failed'}
& "$out/updater-wait-test.exe"
if($LASTEXITCODE -ne 0){throw 'Updater wait tests failed'}
