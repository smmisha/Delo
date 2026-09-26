# Stage A harness: one named session that stays up across real Windows events performed by a
# person. start launches it (a first start seeds nothing; lifecycle-check.mjs baseline does),
# stop leaves it the ordinary way, relaunch checks that its state survived a restart.
param([Parameter(Mandatory=$true)][ValidateSet('start','stop','relaunch')][string]$Action,[string]$RuntimeDirectory=(Join-Path $PSScriptRoot '..\bin'),[string]$SessionName='lifecycle-0110')
$ErrorActionPreference='Stop'
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory);$profile=Join-Path $runtime "test-output/sessions/$SessionName"
function Harness{Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match "--harness=$SessionName(\s|$)"}}
function Start-Session{
 if(Harness){return 'already running'}
 if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Another harness is running'}
 if(-not(Test-Path -LiteralPath $profile)){
  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  # Unpinned, like the user's own widget: the desktop-layer mode is the one Windows events disturb.
  [IO.File]::WriteAllText((Join-Path $profile 'window.json'),'{"pinned":false,"autostart":false,"quickFrameReduced":true,"hotkeys":{"list":"Ctrl+Alt+Shift+J","quick":"Ctrl+Alt+Shift+K"}}')
 }
 $p=Start-Process -FilePath (Join-Path $runtime 'Delo.exe') -ArgumentList "--harness=$SessionName" -PassThru
 for($i=0;$i -lt 120;$i++){if($p.HasExited){throw "Harness exited early ($($p.ExitCode))"};try{$j=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9223/json/list' -TimeoutSec 1).Content;if(([regex]::Matches($j,'delo\.local/ui/')).Count -ge 2){return "started pid $($p.Id)"}}catch{};Start-Sleep -Milliseconds 250}
 throw 'Harness not ready'
}
function Stop-Session{
 $h=Harness;if(-not $h){return 'not running'}
 & node (Join-Path $PSScriptRoot 'devtools.mjs') --script (Join-Path $PSScriptRoot 'ui-exit.js') | Out-Null
 $p=Get-Process -Id $h.ProcessId -ErrorAction SilentlyContinue
 if($p -and -not $p.WaitForExit(20000)){throw 'Harness did not complete its saved exit; left running for inspection'}
 'stopped'
}
switch($Action){
 'start'{Start-Session}
 'stop'{Stop-Session}
 'relaunch'{Stop-Session;Start-Session;$r=Get-Content (Join-Path $profile 'tasks.json') -Raw -Encoding UTF8 | ConvertFrom-Json;$t=$r.state.tasks | Where-Object title -eq 'Lifecycle timer';"after relaunch: revision $($r.revision), tasks $($r.state.tasks.Count), timer $($t.workState) $([math]::Round($t.elapsedMs/1000,1)) s"}
}
