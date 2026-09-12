param([Parameter(Mandatory=$true)][string]$Fixture)
$ErrorActionPreference='Stop'
$toolchain=& (Join-Path $PSScriptRoot 'toolchain.ps1')
$vc=$toolchain.VC;$sdk=$toolchain.SDK;$version=$toolchain.Version
$out=Join-Path $PSScriptRoot 'test-output/voice-native';New-Item -ItemType Directory -Path $out -Force | Out-Null
& "$vc/bin/Hostx64/x64/cl.exe" /nologo /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /utf-8 /W4 /O2 "/I$vc/include" "/I$sdk/Include/$version/ucrt" "/I$sdk/Include/$version/shared" "/I$sdk/Include/$version/um" "/Fo$out/voice-test.obj" "$PSScriptRoot/tests/voice.cpp" /link "/LIBPATH:$vc/lib/x64" "/LIBPATH:$sdk/Lib/$version/um/x64" "/LIBPATH:$sdk/Lib/$version/ucrt/x64" "/OUT:$out/voice-test.exe"
if($LASTEXITCODE -ne 0){throw 'Voice test compilation failed'}
& "$out/voice-test.exe" "$PSScriptRoot/vendor/voice" ([IO.Path]::GetFullPath($Fixture)) "$out/temporary"
if($LASTEXITCODE -ne 0){throw 'Voice tests failed'}
