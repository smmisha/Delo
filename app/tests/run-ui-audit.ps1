# -Extra runs only fixture voice, material groups and scroll fade in one disposable session.
param([Parameter(Mandatory=$true)][string]$RuntimeDirectory,[string]$SessionName=('ui-audit-'+(Get-Date -Format 'yyyyMMdd-HHmmss')),[string]$OutputDirectory,[switch]$Extra,[string]$VoiceFixtureDirectory)
$ErrorActionPreference='Stop'
if($SessionName.Length -gt 64 -or $SessionName -notmatch '^[A-Za-z0-9_-]+$'){throw 'Use a named, isolated harness session (up to 64 characters)'}
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory);$profile=Join-Path $runtime "test-output/sessions/$SessionName"
if(-not(Test-Path -LiteralPath (Join-Path $runtime 'Delo.exe') -PathType Leaf)){throw 'Build Delo first'}
if(Test-Path -LiteralPath $profile){throw 'Use a new session; existing data will not be overwritten'}
if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Close the other Delo harness first'}
if(Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue){throw 'Port 9223 is already in use'}
$fixtures=@()
if($Extra){
 if(-not $VoiceFixtureDirectory){throw '-Extra requires -VoiceFixtureDirectory with ru.wav, uk.wav and en.wav'}
 foreach($required in @('voice/whisper-cli.exe','voice/ggml-small-q5_1.bin')){if(-not(Test-Path -LiteralPath (Join-Path $runtime $required) -PathType Leaf)){throw "Missing $required; build without -SkipVoice"}}
 $sourceRoot=[IO.Path]::GetFullPath($VoiceFixtureDirectory)
 foreach($name in @('ru.wav','uk.wav','en.wav')){
  $source=Join-Path $sourceRoot $name;$destination=Join-Path $runtime "test-output/voice-fixtures/$name"
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "Missing voice fixture: $source"}
  $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $hash){throw "Different fixture already exists: $destination; use a separate audit runtime"}
  $fixtures+=@{name=$name;source=$source;destination=$destination;sha256=$hash}
 }
}elseif($VoiceFixtureDirectory){throw '-VoiceFixtureDirectory is used only with -Extra'}
$out=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{$profile}
New-Item -ItemType Directory -Path $profile,$out -Force | Out-Null
if($Extra){
 New-Item -ItemType Directory -Path (Join-Path $runtime 'test-output/voice-fixtures') -Force | Out-Null
 foreach($fixture in $fixtures){if(-not(Test-Path -LiteralPath $fixture.destination)){Copy-Item -LiteralPath $fixture.source -Destination $fixture.destination}}
 [IO.File]::WriteAllText((Join-Path $out 'voice-fixtures.json'),($fixtures | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
$window=@{pinned=$true;autostart=$false;quickFrameReduced=$true;hotkeys=@{list='Ctrl+Alt+Shift+J';quick='Ctrl+Alt+Shift+K'}} | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $profile 'window.json'),$window,[Text.UTF8Encoding]::new($false))
$p=Start-Process -FilePath (Join-Path $runtime 'Delo.exe') -ArgumentList "--harness=$SessionName" -WindowStyle Hidden -PassThru
$owned=$false
try {
 $ready=$false
 for($attempt=0;$attempt -lt 120;$attempt++){
  if($p.HasExited){throw "Harness exited before WebView was ready (code $($p.ExitCode))"}
  try{
   $pages=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 1).Content | ConvertFrom-Json
   $mainReady=@($pages | Where-Object {$_.url -like 'https://delo.local/ui/*' -and $_.url -notlike '*view=quick*'}).Count -eq 1
   $quickReady=@($pages | Where-Object {$_.url -like 'https://delo.local/ui/*view=quick*'}).Count -eq 1
   if($mainReady -and $quickReady){$ready=$true;break}
  }catch{}
  Start-Sleep -Milliseconds 250
 }
 if(-not $ready){throw 'Harness WebView was not ready within 30 seconds'}
 # Page URLs alone do not prove ownership. Check the actual PID and profile in both views.
 $identity=@"
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {connect}=await import(pathToFileURL(path.join(process.argv[2],'audit-harness.mjs')).href);
const expectedPid=Number(process.argv[3]),expectedProfile=process.argv[4];
const canonical=p=>fs.realpathSync.native(path.resolve(p)).toLowerCase();
const identities=[];
for(const quick of [false,true]){
 const page=await connect(quick);
 try{
  const actual=await page.host('osSurfaceDiagnostics');
  if(actual.pid!==expectedPid||canonical(actual.profile)!==canonical(expectedProfile))throw Error('Harness PID/profile mismatch: '+JSON.stringify(actual));
  identities.push({view:quick?'quick':'main',pid:actual.pid,profile:actual.profile});
 }finally{page.close();}
}
console.log(JSON.stringify(identities));
"@
 $identity | & node --input-type=module - $PSScriptRoot $p.Id $profile | Tee-Object -FilePath (Join-Path $out 'identity.json')
 if($LASTEXITCODE -ne 0){throw 'Harness identity verification failed'}
 $owned=$true
 $tests=if($Extra){@(
  @{name='audit-voice';output=(Join-Path $out 'voice');args=@('--fixtures-only')},
  @{name='audit-material-groups';output=(Join-Path $out 'material-groups')},
  @{name='audit-scroll-fade';output=(Join-Path $out 'scroll-fade')}
 )}else{@(
  @{name='audit-interactions';output=(Join-Path $out 'interactions')},
  @{name='audit-tooltip';output=(Join-Path $out 'tooltip')},
  @{name='audit-visuals';output=(Join-Path $out 'visuals')},
  @{name='audit-windows';output=(Join-Path $out 'windows.json')},
  @{name='audit-suite';output=(Join-Path $out 'suite.json')},
  @{name='audit-resize';output=(Join-Path $out 'resize')},
  @{name='audit-reputation';output=(Join-Path $out 'reputation.json')},
  @{name='audit-demo';output=(Join-Path $out 'demo')},
  @{name='audit-stall';output=(Join-Path $out 'stall')},
  @{name='audit-store-timing';output=(Join-Path $out 'store-timing')}
 )}
 foreach($test in $tests){
  $testArgs=@();if($test.args){$testArgs=@($test.args)}
  & node "$PSScriptRoot/$($test.name).mjs" $test.output @testArgs | Tee-Object -FilePath (Join-Path $out "$($test.name).log")
  if($LASTEXITCODE -ne 0){throw "$($test.name) failed; inspect its JSON/log before continuing"}
 }
 Get-ChildItem -LiteralPath $runtime -Recurse -File | Where-Object {$_.FullName -notlike "$runtime\test-output\*" -and $_.Extension -in '.exe','.css','.mjs','.html'} | ForEach-Object {@{file=$_.FullName.Substring($runtime.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'runtime-manifest.json') -Encoding utf8
} finally {
 if(-not $p.HasExited){
  if(-not $owned){$p.Kill();$p.WaitForExit()}
  else{
   & node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-exit.js"
   if($LASTEXITCODE -ne 0 -or -not $p.WaitForExit(10000)){throw "Harness did not complete saved exit; left running for inspection (PID $($p.Id))"}
  }
 }
}