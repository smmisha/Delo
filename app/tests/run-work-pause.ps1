# П16 live check: "in work" without the timer pauses and resumes, one task stays in focus, and the
# timer shortcut (F05) acts while another program's window has the focus. One named session is
# launched three times by audit-work-pause.mjs: before (shortcut, RU/UK/EN, dark and light, the
# pause glyph), after a saved exit and relaunch, and stale, once the profile has been made to look
# as if a version without П16 started a timer. Keys go only to foreign-shortcut.ps1's own window;
# screenshots and logs stay in the profile (they show the desktop behind the glass).
param([Parameter(Mandatory=$true)][string]$RuntimeDirectory,[string]$SessionName=('work-pause-'+(Get-Date -Format 'yyyyMMdd-HHmmss')),[string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($SessionName -notmatch '^[A-Za-z0-9_-]+$'){throw 'Use a named, isolated harness session'}
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory);$exe=Join-Path $runtime 'Delo.exe'
if(-not(Test-Path -LiteralPath $exe)){throw 'Build Delo first: build.ps1 -OutputDirectory <directory>'}
& node -e "if(typeof WebSocket!=='function')process.exit(1)"
if($LASTEXITCODE -ne 0){throw 'Node.js with global WebSocket is required (Node 22 or newer)'}
if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Close the other Delo harness first'}
# Do not attach to an unrelated process already owning the shared DevTools port.
if(Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue){throw 'Port 9223 is already in use'}
$profile=Join-Path $runtime "test-output/sessions/$SessionName"
if(Test-Path -LiteralPath $profile){throw 'Use a new session; existing data will not be overwritten'}
$out=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $profile 'work-pause'}
New-Item -ItemType Directory -Path $profile,$out -Force | Out-Null
# WriteAllText has no BOM; Set-Content -Encoding utf8 in Windows PowerShell 5.1 adds one, and the host then uses defaults.
[IO.File]::WriteAllText((Join-Path $profile 'window.json'),'{"pinned":true,"autostart":false,"quickFrameReduced":true,"hotkeys":{"list":"Ctrl+Alt+Shift+J","quick":"Ctrl+Alt+Shift+K"},"timerKey":"Ctrl+Alt+Shift+P"}')
$driver=Join-Path $PSScriptRoot 'audit-work-pause.mjs'
function Launch{
 $p=Start-Process -FilePath $exe -ArgumentList "--harness=$SessionName" -WindowStyle Hidden -PassThru
 for($i=0;$i -lt 120;$i++){
  if($p.HasExited){throw "Harness exited early ($($p.ExitCode))"}
  try{$j=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9223/json/list' -TimeoutSec 1).Content;if(([regex]::Matches($j,'delo\.local/ui/')).Count -ge 2){Start-Sleep -Milliseconds 800;return $p}}catch{}
  Start-Sleep -Milliseconds 250
 }
 throw 'Harness not ready within 30 seconds'
}
function Phase([string]$Name){
 if($Name -eq 'older'){& node $driver $Name $out $profile;if($LASTEXITCODE -ne 0){throw "Phase '$Name' failed; see $out\$Name.json"};return}
 $p=Launch
 & node $driver $Name $out
 $code=$LASTEXITCODE
 if(-not $p.WaitForExit(20000)){throw "Harness did not complete its saved exit after '$Name'; left running for inspection (PID $($p.Id))"}
 if($code -ne 0){throw "Phase '$Name' failed; see $out\$Name.json"}
}
foreach($name in 'before','after','older','stale'){Phase $name}
$counts=foreach($name in 'before','after','older','stale'){@((Get-Content -LiteralPath (Join-Path $out "$name.json") -Raw -Encoding UTF8 | ConvertFrom-Json).results).Count}
"PASS: $($counts -join ' + ') checks (before, after relaunch, older profile, stale flag)"
"Evidence: $out"
