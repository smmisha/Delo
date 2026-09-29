# Isolated, additive OS-boundary checks; never runs ui-030-smoke.
param([Parameter(Mandatory=$true)][string]$RuntimeDirectory,[switch]$Manual)
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'Windows is required; OS live checks remain UNVERIFIED'}
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory)
$exe=Join-Path $runtime 'Delo.exe'
if(-not(Test-Path -LiteralPath $exe)){throw 'Build the patched host first'}
& node -e "if(typeof WebSocket!=='function')process.exit(1)"
if($LASTEXITCODE -ne 0){throw 'Node.js with global WebSocket is required (Node 22 or newer)'}
if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Close the other Delo harness first'}
# Do not attach to an unrelated process already owning the shared DevTools port.
if(Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue){throw 'Port 9223 is already in use'}
$session='os-030-'+[guid]::NewGuid().ToString('N')
$parent=Join-Path $runtime 'test-output/sessions'
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$profile=Join-Path $parent $session
$driver=Join-Path $PSScriptRoot 'audit-os-030.mjs'
& node $driver --prepare $profile
if($LASTEXITCODE -ne 0){throw 'Fixture preparation failed'}
$manifest=@{createdAt=[DateTime]::UtcNow.ToString('o');os=[Environment]::OSVersion.VersionString;mode=$(if($Manual){'manual'}else{'integration'});runtime=@();sources=@()}
foreach($dir in @($runtime,(Split-Path $PSScriptRoot -Parent))){
 $files=@(Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object {$_.FullName -notmatch '[\\/](test-output|bin|obj|vendor)[\\/]' -and $_.Extension -in '.exe','.mjs','.js','.cpp','.h','.ps1','.html'})
 if($dir -eq $runtime){$files=@(Get-Item -LiteralPath $exe)+@(Get-ChildItem -LiteralPath (Join-Path $runtime 'ui'),(Join-Path $runtime 'core') -Recurse -File)}
 $items=@($files | ForEach-Object {@{file=$_.FullName.Substring($dir.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
 if($dir -eq $runtime){$manifest.runtime=$items}else{$manifest.sources=$items}
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $profile 'runtime-manifest.json') -Encoding UTF8
$p=Start-Process -FilePath $exe -ArgumentList "--harness=$session" -PassThru
$leaveRunning=$false
try{
 $ready=$false
 for($i=0;$i -lt 120;$i++){
  if($p.HasExited){throw "Harness exited early: $($p.ExitCode)"}
  try{
   # Windows PowerShell 5.1 hands the JSON array down the pipeline as one object; unroll it, or
   # the page count below is 1 whatever is open.
   $pages=@(Invoke-RestMethod 'http://127.0.0.1:9223/json/list' -TimeoutSec 1 | ForEach-Object {$_})
   if(@($pages | Where-Object {$_.url -like 'https://delo.local/ui/*'}).Count -eq 2){$ready=$true;break}
  }catch{}
  Start-Sleep -Milliseconds 250
 }
 if(-not $ready){throw 'WebView2 was not ready within 30 seconds'}
 & node $driver --snapshot $profile $p.Id
 if($LASTEXITCODE -ne 0){throw 'Patched host identity check failed'}
 if($Manual){
  $leaveRunning=$true
  Write-Host "Manual live checks: architecture/OS-030-VALIDATION.md"
  Write-Host "Profile: $profile"
  Write-Host "PID: $($p.Id) ; session: $session"
  Write-Host 'N12/T07/N13: UNVERIFIED until the operator records each observation.'
 }else{
  & node $driver --run $profile $p.Id
  if($LASTEXITCODE -ne 0){throw "OS integration failed; inspect $profile/os-030.json"}
  Write-Host 'Integration PASS only. N12/T07/N13 OS UI: UNVERIFIED.'
 }
}finally{
 if(-not $leaveRunning -and -not $p.HasExited){
  & node $driver --exit $profile $p.Id
  if($LASTEXITCODE -ne 0 -or -not $p.WaitForExit(10000)){Write-Warning "Saved exit not confirmed; inspect harness PID $($p.Id). It has not been killed."}
 }
 Write-Host "Evidence retained: $profile"
}
