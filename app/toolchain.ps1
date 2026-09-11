$ErrorActionPreference='Stop'
$vc=$env:DELO_VC_ROOT
if(-not $vc){
 $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
 if(-not(Test-Path -LiteralPath $vswhere)){throw 'Install Visual Studio Build Tools with Desktop development with C++.'}
 $installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
 if(-not $installation){throw 'MSVC x64 build tools were not found.'}
 $vc=(Get-ChildItem (Join-Path $installation 'VC/Tools/MSVC') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
}
$sdk=$env:DELO_SDK_ROOT
if(-not $sdk){$sdk=(Get-ItemProperty 'HKLM:/SOFTWARE/Microsoft/Windows Kits/Installed Roots' -ErrorAction Stop).KitsRoot10}
$version=$env:DELO_SDK_VERSION
if(-not $version){
 $version=(Get-ChildItem (Join-Path $sdk 'Include') -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'cppwinrt/winrt/base.h')} | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).Name
}
foreach($required in @("$vc/bin/Hostx64/x64/cl.exe","$sdk/Include/$version/cppwinrt/winrt/base.h","$sdk/Lib/$version/um/x64/WindowsApp.lib")){
 if(-not(Test-Path -LiteralPath $required)){throw "Missing build dependency: $required"}
}
[PSCustomObject]@{VC=$vc;SDK=$sdk;Version=$version}
