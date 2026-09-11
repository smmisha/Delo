$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DeloStartupHotkeyTest {
 [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr window,int id,uint modifiers,uint key);
 [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr window,int id);
}
'@
if(-not [DeloStartupHotkeyTest]::RegisterHotKey([IntPtr]::Zero,7220,3,32)){throw 'Default combination is already occupied'}
try {
 $exe=Join-Path $PSScriptRoot '../bin/Delo.exe'
 $process=Start-Process -FilePath $exe -ArgumentList '--harness=startup-conflict-20260911' -WindowStyle Hidden -PassThru
 $ready=$false
 for($attempt=0;$attempt -lt 20;$attempt++){
  if($process.HasExited){throw 'Delo exited unexpectedly'}
  Start-Sleep -Milliseconds 250
  try {$pages=Invoke-RestMethod 'http://127.0.0.1:9223/json/list';if($pages.url -match 'https://delo.local/ui/index.html$'){$ready=$true;break}}catch{}
 }
 if(-not $ready){throw 'Harness endpoint unavailable'}
 & node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-startup-conflict.js"
 if($LASTEXITCODE -ne 0){throw 'Startup conflict test failed'}
} finally {[DeloStartupHotkeyTest]::UnregisterHotKey([IntPtr]::Zero,7220) | Out-Null}
& node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-light.js"
if($LASTEXITCODE -ne 0){throw 'Could not repair shortcuts after releasing test combination'}
