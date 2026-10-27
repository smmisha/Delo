# Optional first argument: an isolated directory enables real HTTPS download/cache checks.
$ErrorActionPreference='Stop'
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$version=$toolchain.Version
$out=Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $out -Force | Out-Null
& "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$version/ucrt" "/I$sdk/Include/$version/shared" "/I$sdk/Include/$version/um" "/I$sdk/Include/$version/winrt" "/I$sdk/Include/$version/cppwinrt" "/Fo$out/updater-test.obj" "$PSScriptRoot/tests/updater.cpp" /link "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$version/um/x64" "/LIBPATH:$sdk/Lib/$version/ucrt/x64" WindowsApp.lib Ole32.lib Version.lib "/OUT:$out/updater-test.exe"
if($LASTEXITCODE -ne 0){throw 'Updater test compilation failed'}
& "$out/updater-test.exe" @args
if($LASTEXITCODE -ne 0){throw 'Updater tests failed'}
