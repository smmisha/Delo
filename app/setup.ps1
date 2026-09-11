$ErrorActionPreference='Stop'
$version='1.0.4191.47'
$expected='F492BBF547D0DA329553B6727435B677579B1E9F91CC9E4A1AD029366D5F23D0'
$destination=Join-Path $PSScriptRoot "vendor/webview2-$version"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$archive=Join-Path $destination 'sdk.zip'
if(-not(Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $archive}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected){throw 'WebView2 SDK checksum mismatch'}
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
Write-Output "WebView2 SDK $version verified and restored"
