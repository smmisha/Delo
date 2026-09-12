# The default package carries the evergreen bootstrapper and therefore needs the
# network during install; -Offline tests the embedded-runtime build with the
# network switched off, which is the case that build exists for.
param(
  [ValidatePattern('^\d+\.\d+\.\d+(?:\.\d+)?$')][string]$Version='0.1.3',
  [switch]$Offline,
  [ValidateRange(1,3600)][int]$StartupTimeoutSeconds=120,
  [ValidateRange(1,7200)][int]$TestTimeoutSeconds=900
)
$ErrorActionPreference='Stop'
$sandbox=(Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue).Source
if(-not$sandbox){
  try{$feature=Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM}
  catch{throw 'Windows Sandbox executable is unavailable. Check that the optional feature is enabled and restart Windows.'}
  if($feature.State-ne'Enabled'){throw 'Windows Sandbox is not enabled.'}
  throw 'Windows Sandbox is enabled but its executable is unavailable. Restart Windows, then run this script again.'
}
$package=Join-Path $PSScriptRoot "..\dist\Delo-$Version-windows-x64-setup.exe"
if(-not(Test-Path -LiteralPath $package)){throw "Installer not found: $package"}
$runId=(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$stage=Join-Path $PSScriptRoot "..\test-output\windows-sandbox-$Version\$runId"
New-Item -ItemType Directory -Path $stage -Force|Out-Null
Copy-Item -LiteralPath $package -Destination (Join-Path $stage ([IO.Path]::GetFileName($package))) -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sandbox-guest.ps1') -Destination (Join-Path $stage 'sandbox-guest.ps1') -Force
$networking=if($Offline){'Disable'}else{'Default'}
$escaped=[Security.SecurityElement]::Escape((Resolve-Path $stage).Path)
$config=@"
<Configuration>
  <MappedFolders><MappedFolder><HostFolder>$escaped</HostFolder><SandboxFolder>C:\DeloTest</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders>
  <Networking>$networking</Networking><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><MemoryInMB>4096</MemoryInMB>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\DeloTest\sandbox-guest.ps1 -Version $Version</Command></LogonCommand>
</Configuration>
"@
$configPath=Join-Path $stage 'Delo-test.wsb';[IO.File]::WriteAllText($configPath,$config,(New-Object Text.UTF8Encoding($false)))
Start-Process -FilePath $sandbox -ArgumentList ('"{0}"' -f $configPath) -WindowStyle Hidden
# A launcher/session process does not prove that the VM reached LogonCommand.
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
  if((Get-Date) -ge $deadline){throw "Windows Sandbox guest started but the test did not finish within $TestTimeoutSeconds seconds. Inspect install.log and the guest window. Run files: $stage"}
  Start-Sleep -Seconds 1
}
$result=Get-Content -LiteralPath $resultPath -Raw|ConvertFrom-Json
if($result.passed -ne $true){throw "Windows Sandbox test failed: $($result.error). Results: $resultPath"}
Write-Output $resultPath
