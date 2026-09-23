param([Parameter(Mandatory=$true)][string]$RuntimeDirectory,[string]$SessionName=('ui-audit-'+(Get-Date -Format 'yyyyMMdd-HHmmss')),[string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($SessionName -notmatch '^[A-Za-z0-9_-]+$'){throw 'Use a named, isolated harness session'}
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory);$profile=Join-Path $runtime "test-output/sessions/$SessionName"
if(Test-Path -LiteralPath $profile){throw 'Use a new session; existing data will not be overwritten'}
if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Close the other Delo harness first'}
$out=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{$profile}
New-Item -ItemType Directory -Path $profile,$out -Force | Out-Null
@{pinned=$true;autostart=$false;quickFrameReduced=$true;hotkeys=@{list='Ctrl+Alt+Shift+J';quick='Ctrl+Alt+Shift+K'}} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $profile 'window.json') -Encoding utf8
$p=Start-Process -FilePath (Join-Path $runtime 'Delo.exe') -ArgumentList "--harness=$SessionName" -WindowStyle Hidden -PassThru
try {
 $ready=$false
 for($attempt=0;$attempt -lt 120;$attempt++){
  if($p.HasExited){throw "Harness exited before WebView was ready (code $($p.ExitCode))"}
  try{
   $pages=@(Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 1)
   $mainReady=@($pages | Where-Object {$_.url -like 'https://delo.local/ui/*' -and $_.url -notlike '*view=quick*'}).Count -eq 1
   $quickReady=@($pages | Where-Object {$_.url -like 'https://delo.local/ui/*view=quick*'}).Count -eq 1
   if($mainReady -and $quickReady){$ready=$true;break}
  }catch{}
  Start-Sleep -Milliseconds 250
 }
 if(-not $ready){throw 'Harness WebView was not ready within 30 seconds'}
 foreach($test in @(
  @{name='audit-interactions';output=(Join-Path $out 'interactions')},
  @{name='audit-tooltip';output=(Join-Path $out 'tooltip')},
  @{name='audit-visuals';output=(Join-Path $out 'visuals')},
  @{name='audit-windows';output=(Join-Path $out 'windows.json')},
  @{name='audit-suite';output=(Join-Path $out 'suite.json')},
  @{name='audit-resize';output=(Join-Path $out 'resize')},
  @{name='audit-reputation';output=(Join-Path $out 'reputation.json')}
  ,@{name='audit-demo';output=(Join-Path $out 'demo')}
  ,@{name='audit-stall';output=(Join-Path $out 'stall')}
 )){
  & node "$PSScriptRoot/$($test.name).mjs" $test.output | Tee-Object -FilePath (Join-Path $out "$($test.name).log")
  if($LASTEXITCODE -ne 0){throw "$($test.name) failed; inspect its JSON/log before continuing"}
 }
 Get-ChildItem -LiteralPath $runtime -Recurse -File | Where-Object {$_.FullName -notlike "$runtime\test-output\*" -and $_.Extension -in '.exe','.css','.mjs','.html'} | ForEach-Object {@{file=$_.FullName.Substring($runtime.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'runtime-manifest.json') -Encoding utf8
} finally {
 if(-not $p.HasExited){& node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-exit.js";if($LASTEXITCODE -ne 0 -or -not $p.WaitForExit(10000)){Write-Warning 'Harness did not complete saved exit; left running for inspection'}}
}
