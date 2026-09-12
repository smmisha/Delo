param([Parameter(Mandatory=$true)][string]$RuntimeDirectory,[string]$SessionName=('backup-audit-'+(Get-Date -Format 'yyyyMMdd-HHmmss')),[string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($SessionName -notmatch '^[A-Za-z0-9_-]+$'){throw 'Use a named, isolated harness session'}
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory)
$profile=Join-Path $runtime "test-output/sessions/$SessionName"
if(Test-Path -LiteralPath $profile){throw 'Backup test requires a new session; existing data will not be overwritten'}
if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Close the other Delo harness before using its development endpoint'}
$out=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{$profile}
New-Item -ItemType Directory -Path $profile -Force | Out-Null
@{pinned=$true;autostart=$false;hotkeys=@{list='Ctrl+Alt+Shift+J';quick='Ctrl+Alt+Shift+K'}} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $profile 'window.json') -Encoding utf8
function Run-Ui([string]$Name){
 $result=& node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/$Name.js"
 if($LASTEXITCODE -ne 0){throw "$Name failed"}
 return ($result -join "`n")
}
function Start-Harness {
 $p=Start-Process -FilePath (Join-Path $runtime 'Delo.exe') -ArgumentList "--harness=$SessionName" -WindowStyle Hidden -PassThru
 Start-Sleep -Seconds 2
 return $p
}
function Close-Harness($p){
 [void](Run-Ui 'ui-exit')
 if(-not $p.WaitForExit(10000)){throw 'Harness did not acknowledge saved exit; not terminating it'}
}
$p=Start-Harness
try {
 $seed=Run-Ui 'ui-backup-seed'
 Close-Harness $p
 $backup=Join-Path $profile 'tasks.json.bak'
 if(-not(Test-Path -LiteralPath $backup)){throw 'Seed did not create a backup'}
 $hash=(Get-FileHash -LiteralPath $backup).Hash
 # This profile was created above and cannot contain the user's existing tasks.
 [IO.File]::WriteAllText((Join-Path $profile 'tasks.json'),'{"deliberatelyIncomplete":')
 $p=Start-Harness
 $recovered=Run-Ui 'ui-backup-recover'
 Close-Harness $p
 New-Item -ItemType Directory -Path $out -Force | Out-Null
 @{session=$SessionName;seed=($seed|ConvertFrom-Json);backupSha256=$hash;recovered=($recovered|ConvertFrom-Json);pass=$true} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'backup.json') -Encoding utf8
 Write-Output 'Backup recovery: PASS'
} finally {
 if($p -and -not $p.HasExited){try{Close-Harness $p}catch{Write-Warning "Harness left running after failure: $($_.Exception.Message)"}}
}
