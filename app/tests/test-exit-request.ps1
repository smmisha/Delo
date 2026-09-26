# N09. The installer asks a running Delo to leave through the registered "Delo.RequestExit"
# message. Delo must answer it, pause its timers and save, and quit only once that save has
# landed, even when the disk holds every write for 5 s. The session-end path used for older
# versions is run under the same slow write to show why the acknowledgement is needed: there
# the pause is lost. Runs its own named harness sessions; never touches the user's data.
param([Parameter(Mandatory=$true)][string]$RuntimeDirectory)
$ErrorActionPreference='Stop'
$runtime=[IO.Path]::GetFullPath($RuntimeDirectory)
if(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness'}){throw 'Close the other Delo harness first'}
Add-Type @"
using System;using System.Runtime.InteropServices;
public static class DeloExitRequest{
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern uint RegisterWindowMessage(string s);
 [DllImport("user32.dll")]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint t,out IntPtr r);
}
"@
function Run-Close([string]$Mode){
 $session="exit-request-$Mode-"+(Get-Date -Format 'HHmmss');$profile=Join-Path $runtime "test-output/sessions/$session"
 New-Item -ItemType Directory -Path $profile -Force | Out-Null
 [IO.File]::WriteAllText((Join-Path $profile 'window.json'),'{"pinned":true,"autostart":false,"quickFrameReduced":true,"hotkeys":{"list":"Ctrl+Alt+Shift+J","quick":"Ctrl+Alt+Shift+K"}}')
 $p=Start-Process -FilePath (Join-Path $runtime 'Delo.exe') -ArgumentList "--harness=$session" -WindowStyle Hidden -PassThru
 try{
  for($i=0;$i -lt 120;$i++){if($p.HasExited){throw "Harness exited early ($($p.ExitCode))"};try{$j=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9223/json/list' -TimeoutSec 1).Content;if(([regex]::Matches($j,'delo\.local/ui/')).Count -ge 2){break}}catch{};Start-Sleep -Milliseconds 250}
  # A task whose timer has just started while every write is held 5 s.
  $control=[long](& node (Join-Path $PSScriptRoot 'exit-request-seed.mjs'))
  $window=[IntPtr]$control;$started=Get-Date;$answer=[IntPtr]::Zero
  if($Mode -eq 'request'){[void][DeloExitRequest]::SendMessageTimeout($window,[DeloExitRequest]::RegisterWindowMessage('Delo.RequestExit'),[IntPtr]::Zero,[IntPtr]::Zero,2,5000,[ref]$answer)}
  else{[void][DeloExitRequest]::PostMessage($window,0x11,[IntPtr]::Zero,[IntPtr]::Zero);Start-Sleep -Seconds 3;[void][DeloExitRequest]::PostMessage($window,0x16,[IntPtr]1,[IntPtr]::Zero)}
  $exited=$p.WaitForExit(40000);$seconds=((Get-Date)-$started).TotalSeconds
  if(-not $exited){Stop-Process -Id $p.Id -Force}
  $task=(Get-Content (Join-Path $profile 'tasks.json') -Raw -Encoding UTF8 | ConvertFrom-Json).state.tasks | Where-Object title -eq 'Exit request check'
  return [pscustomobject]@{mode=$Mode;answer=[long]$answer;exited=$exited;exitCode=$p.ExitCode;seconds=[math]::Round($seconds,1);workState=$task.workState;elapsedMs=$task.elapsedMs}
 }finally{if(-not $p.HasExited){Stop-Process -Id $p.Id -Force};Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue}
}
$request=Run-Close 'request';$session=Run-Close 'session'
$checks=@(
 [pscustomobject]@{name='a running Delo answers the exit request';pass=($request.answer -eq 0x44454C4F)}
 [pscustomobject]@{name='it quits cleanly after the slow save';pass=($request.exited -and $request.exitCode -eq 0 -and $request.seconds -ge 5)}
 [pscustomobject]@{name='the timer is saved paused with its time';pass=($request.workState -eq 'paused' -and $request.elapsedMs -gt 0)}
 [pscustomobject]@{name='the session-end path loses the pause under the same slow write (why the request exists)';pass=($session.workState -eq 'running')}
)
$request,$session | Format-Table -AutoSize | Out-String -Width 160
$checks | Format-Table -AutoSize | Out-String -Width 160
if($checks | Where-Object {-not $_.pass}){throw 'Exit request checks failed'}
'Exit request: PASS'
