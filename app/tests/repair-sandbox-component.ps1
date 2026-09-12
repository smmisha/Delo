# Cycles the Windows Sandbox optional feature as a repair attempt. This does not
# guarantee that inherited WindowsApps ACLs will be repaired. A 0x80070005 error while
# loading hostfxr.dll establishes access denial; ACL inspection alone does not prove
# its root cause or that an AppContainer can load the DLL after this operation.
#
# Two stages with a restart between them. No -Remove flag anywhere, so the payload stays
# in the component store; feature enablement may still need a repair source. Nothing
# outside this one optional feature is touched: no ACL edits, no other packages.
#
#   powershell -File repair-sandbox-component.ps1 -Stage 1   # elevated, then restart
#   powershell -File repair-sandbox-component.ps1 -Stage 2   # elevated, then restart
#   powershell -File repair-sandbox-component.ps1 -Stage check
param([Parameter(Mandatory = $true)][ValidateSet('1', '2', 'check')][string]$Stage)
$ErrorActionPreference = 'Stop'

$feature = 'Containers-DisposableClientVM'
$package = 'MicrosoftWindows.WindowsSandbox'
# Well-known SIDs, so the check does not depend on the Windows display language:
# S-1-15-2-1 ALL APPLICATION PACKAGES, S-1-15-2-2 ALL RESTRICTED APPLICATION PACKAGES.
$appPackageSids = @('S-1-15-2-1', 'S-1-15-2-2')

function Require-Elevation {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this stage from an elevated PowerShell.'
  }
}

if ($Stage -eq 'check') {
  $sandbox = Get-AppxPackage -Name $package -ErrorAction SilentlyContinue
  if (-not $sandbox) { Write-Output 'sandbox package: not registered'; return }
  Write-Output "sandbox package: $($sandbox.PackageFullName) status=$($sandbox.Status)"
  $found = @()
  foreach ($ace in (Get-Acl -LiteralPath $sandbox.InstallLocation).Access) {
    try { $sid = $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { $sid = $ace.IdentityReference.Value }
    if ($appPackageSids -contains $sid) { $found += "$sid : $($ace.AccessControlType) $($ace.FileSystemRights) inherited=$($ace.IsInherited)" }
  }
  Write-Output "app-package entries on the package folder: $($found.Count)"
  foreach ($f in $found) { Write-Output "  $f" }
  if ($found.Count -eq 0) {
    Write-Output 'CHECK: no broad app-package entries found. Inspect package/capability-specific entries and the DLL ACL before attributing access denial to this folder.'
  } else {
    Write-Output 'CHECK: app-package entries are present. This does not establish effective access or a working Sandbox; verify an actual guest start.'
  }
  return
}

Require-Elevation
$before = Get-WindowsOptionalFeature -Online -FeatureName $feature
Write-Output "feature before: $($before.State)"

if ($Stage -eq '1') {
  if ($before.State -ne 'Enabled') { Write-Output 'nothing to do: feature is not enabled'; return }
  $r = Disable-WindowsOptionalFeature -Online -FeatureName $feature -NoRestart
  Write-Output "disabled, restart needed = $($r.RestartNeeded)"
  Write-Output 'Restart Windows, then run stage 2.'
} else {
  if ($before.State -eq 'Enabled') { Write-Output 'feature is already enabled; restart and run -Stage check'; return }
  $r = Enable-WindowsOptionalFeature -Online -FeatureName $feature -NoRestart
  Write-Output "enabled, restart needed = $($r.RestartNeeded)"
  Write-Output 'Restart Windows, then run -Stage check and app/tests/run-windows-sandbox.ps1 -Version 0.1.6.'
}
