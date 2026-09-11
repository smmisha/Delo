$ErrorActionPreference = 'Stop'
$probeVc = 'C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/MSVC/14.50.35717'
$probeSdk = 'C:/Program Files (x86)/Windows Kits/10'
$probeIncludes = "$probeSdk/Include/10.0.26100.0"
$probeOutput = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $probeOutput -Force | Out-Null
& "$probeVc/bin/Hostx64/x64/cl.exe" /nologo /LD /MD /EHsc /std:c++17 "/I$probeVc/include" "/I$probeIncludes/ucrt" "/I$probeIncludes/shared" "/I$probeIncludes/um" "/I$probeIncludes/winrt" "/I$probeIncludes/cppwinrt" "/Fo$probeOutput/BackdropEffect.obj" (Join-Path $PSScriptRoot 'BackdropEffect.cpp') /link "/LIBPATH:$probeVc/lib/x64" "/LIBPATH:$probeSdk/Lib/10.0.26100.0/um/x64" "/LIBPATH:$probeSdk/Lib/10.0.26100.0/ucrt/x64" WindowsApp.lib "/IMPLIB:$probeOutput/BackdropEffect.lib" "/OUT:$probeOutput/BackdropEffect.dll"
if ($LASTEXITCODE -ne 0) { throw 'Native effect adapter compilation failed.' }
