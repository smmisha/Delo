# V12 on a clean Windows: installs Delo in Windows Sandbox, creates a task, relaunches, uninstalls.
# The default package carries the evergreen bootstrapper and therefore needs the
# network during install; -Offline tests the embedded-runtime build with the
# network switched off, which is the case that build exists for.
# -From installs that older version first and updates it to -Version while it runs.
# -Id runs the test in a sandbox that is already open (wsb list) instead of starting one.
# A fresh sandbox is started through the wsb command line and stopped afterwards. Launching
# WindowsSandbox.exe with a .wsb file is the fallback where wsb is missing; on this machine it
# fails from a non-interactive shell (WindowsSandboxRemoteSession cannot load hostfxr.dll), while
# wsb start plus wsb connect works.
param(
  [ValidatePattern('^\d+\.\d+\.\d+(?:\.\d+)?$')][string]$Version='0.3.4',
  [ValidatePattern('^(\d+\.\d+\.\d+)?$')][string]$From,
  [string]$Id,
  [switch]$Offline,
  [ValidateRange(1,3600)][int]$StartupTimeoutSeconds=120,
  [ValidateRange(1,7200)][int]$TestTimeoutSeconds=900
)
$ErrorActionPreference='Stop'
$wsb=(Get-Command wsb.exe -ErrorAction SilentlyContinue).Source
$sandbox=(Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue).Source
if(-not$wsb -and -not$sandbox){
  try{$feature=Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM}
  catch{throw 'Windows Sandbox executable is unavailable. Check that the optional feature is enabled and restart Windows.'}
  if($feature.State-ne'Enabled'){throw 'Windows Sandbox is not enabled.'}
  throw 'Windows Sandbox is enabled but its executable is unavailable. Restart Windows, then run this script again.'
}
if($Id -and $Offline){throw '-Offline starts its own sandbox; omit -Id.'}
$package=Join-Path $PSScriptRoot "..\dist\Delo-$Version-windows-x64-setup.exe"
if(-not(Test-Path -LiteralPath $package)){throw "Installer not found: $package"}
$runId=(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$stage=Join-Path $PSScriptRoot "..\test-output\windows-sandbox-$Version\$runId"
New-Item -ItemType Directory -Path $stage -Force|Out-Null
Copy-Item -LiteralPath $package -Destination (Join-Path $stage ([IO.Path]::GetFileName($package))) -Force
if($From){
  $old=Join-Path $PSScriptRoot "..\dist\Delo-$From-windows-x64-setup.exe"
  if(-not(Test-Path -LiteralPath $old)){throw "Installer not found: $old"}
  Copy-Item -LiteralPath $old -Destination (Join-Path $stage ([IO.Path]::GetFileName($old))) -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sandbox-guest.ps1') -Destination (Join-Path $stage 'sandbox-guest.ps1') -Force
$guest="powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\DeloTest\sandbox-guest.ps1 -Version $Version"+$(if($From){" -From $From"}else{''})
$networking=if($Offline){'Disable'}else{'Default'}
$escaped=[Security.SecurityElement]::Escape((Resolve-Path $stage).Path)
$mapped="<MappedFolders><MappedFolder><HostFolder>$escaped</HostFolder><SandboxFolder>C:\DeloTest</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders>"
$options="<Networking>$networking</Networking><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><MemoryInMB>4096</MemoryInMB>"
function Start-Guest([string]$sandboxId){
  Start-Process -FilePath $wsb -ArgumentList @('exec','--id',$sandboxId,'--run-as','ExistingLogin','--command',('"{0}"' -f $guest)) -WindowStyle Hidden
}
$own=$null
try{
  if($Id){
    & $wsb share --id $Id --host-path (Resolve-Path $stage).Path --sandbox-path 'C:\DeloTest' --allow-write
    if($LASTEXITCODE -ne 0){throw "wsb share failed ($LASTEXITCODE)"}
    Start-Guest $Id
  }elseif($wsb){
    $started=& $wsb start --config "<Configuration>$mapped$options</Configuration>" --raw|Out-String
    if($LASTEXITCODE -ne 0){throw "wsb start failed ($LASTEXITCODE): $started"}
    $own=($started|ConvertFrom-Json).Id
    # A command can run only in a signed-in session, and the session starts with the connection.
    Start-Process -FilePath $wsb -ArgumentList @('connect','--id',$own) -WindowStyle Hidden
    $deadline=(Get-Date).AddSeconds($StartupTimeoutSeconds)
    do{
      if((Get-Date) -ge $deadline){throw "Windows Sandbox $own has no signed-in session after $StartupTimeoutSeconds seconds. Run files: $stage"}
      Start-Sleep -Seconds 3
      # Windows PowerShell turns a native command's stderr into a terminating error under Stop.
      & {$ErrorActionPreference='Continue';& $wsb exec --id $own --run-as ExistingLogin --command 'cmd /c exit 0' *>$null}
    }while($LASTEXITCODE -ne 0)
    Start-Guest $own
  }else{
    $config="<Configuration>$mapped$options<LogonCommand><Command>$guest</Command></LogonCommand></Configuration>"
    $configPath=Join-Path $stage 'Delo-test.wsb';[IO.File]::WriteAllText($configPath,$config,(New-Object Text.UTF8Encoding($false)))
    Start-Process -FilePath $sandbox -ArgumentList ('"{0}"' -f $configPath) -WindowStyle Hidden
  }
  # A launcher/session process does not prove that the guest script runs.
  # A unique mapped directory prevents results from an earlier run being accepted.
  $startedPath=Join-Path $stage 'guest-started.json'
  $resultPath=Join-Path $stage 'result.json'
  $deadline=(Get-Date).AddSeconds($StartupTimeoutSeconds)
  while(-not(Test-Path -LiteralPath $startedPath)){
    if((Get-Date) -ge $deadline){throw "Windows Sandbox did not reach the guest script within $StartupTimeoutSeconds seconds. Inspect the Application event log for WindowsSandboxRemoteSession. Run files: $stage"}
    Start-Sleep -Seconds 1
  }
  Write-Host "Windows Sandbox guest started. Waiting for installer checks: $resultPath"
  $deadline=(Get-Date).AddSeconds($TestTimeoutSeconds)
  while(-not(Test-Path -LiteralPath $resultPath)){
    if((Get-Date) -ge $deadline){throw "Windows Sandbox guest started but the test did not finish within $TestTimeoutSeconds seconds. Inspect progress.txt and the install logs. Run files: $stage"}
    Start-Sleep -Seconds 1
  }
  $result=Get-Content -LiteralPath $resultPath -Raw|ConvertFrom-Json
  if($result.passed -ne $true){throw "Windows Sandbox test failed: $($result.error). Results: $resultPath"}
  Write-Output $resultPath
}finally{
  # A sandbox this script started is disposable; the results are already on the host.
  if($own){& {$ErrorActionPreference='Continue';& $wsb stop --id $own *>$null}}
}
