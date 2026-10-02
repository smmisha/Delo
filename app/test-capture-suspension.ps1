$ErrorActionPreference='Stop'
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$version=$toolchain.Version
$out=Join-Path $PSScriptRoot 'test-output/capture-suspension-unit'
New-Item -ItemType Directory -Path $out -Force | Out-Null
# Pure state transitions only: no windows, hooks, GPU, capture or WebView2.
& "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$version/ucrt" "/I$sdk/Include/$version/shared" "/I$sdk/Include/$version/um" "/Fo$out/capture-suspension-test.obj" "$PSScriptRoot/tests/capture-suspension.cpp" /link "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$version/ucrt/x64" "/LIBPATH:$sdk/Lib/$version/um/x64" "/OUT:$out/capture-suspension-test.exe"
if($LASTEXITCODE -ne 0){throw 'Capture suspension test compilation failed'}
& "$out/capture-suspension-test.exe"
if($LASTEXITCODE -ne 0){throw 'Capture suspension tests failed'}
