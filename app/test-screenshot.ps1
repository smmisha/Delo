$ErrorActionPreference='Stop'
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$version=$toolchain.Version
$out=Join-Path $PSScriptRoot 'test-output/screenshot-unit'
New-Item -ItemType Directory -Path $out -Force | Out-Null
# This executable tests the pure chord matcher; it never creates hooks or UI workers.
& "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$version/ucrt" "/I$sdk/Include/$version/shared" "/I$sdk/Include/$version/um" "/I$sdk/Include/$version/winrt" "/Fo$out/screenshot-test.obj" "$PSScriptRoot/tests/screenshot-keys.cpp" /link "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$version/um/x64" "/LIBPATH:$sdk/Lib/$version/ucrt/x64" User32.lib "/OUT:$out/screenshot-test.exe"
if($LASTEXITCODE -ne 0){throw 'Screenshot test compilation failed'}
& "$out/screenshot-test.exe"
if($LASTEXITCODE -ne 0){throw 'Screenshot tests failed'}
