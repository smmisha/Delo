$ErrorActionPreference='Stop'
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$version=$toolchain.Version
$out=Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $out -Force | Out-Null
& "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$version/ucrt" "/I$sdk/Include/$version/shared" "/I$sdk/Include/$version/um" "/I$sdk/Include/$version/winrt" "/I$sdk/Include/$version/cppwinrt" "/Fo$out/renderer-test.obj" "$PSScriptRoot/tests/renderer.cpp" /link "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$version/um/x64" "/LIBPATH:$sdk/Lib/$version/ucrt/x64" WindowsApp.lib Ole32.lib User32.lib D3D11.lib DXGI.lib D3DCompiler.lib Dcomp.lib Dwmapi.lib "/OUT:$out/renderer-test.exe"
if($LASTEXITCODE -ne 0){throw 'Renderer test compilation failed'}
& "$out/renderer-test.exe" "$PSScriptRoot/native/Glass.hlsl"
if($LASTEXITCODE -ne 0){throw 'Renderer tests failed'}
