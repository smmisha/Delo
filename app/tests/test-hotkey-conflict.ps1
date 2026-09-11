$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DeloHotkeyTest {
 [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr window,int id,uint modifiers,uint key);
 [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr window,int id);
}
'@
if(-not [DeloHotkeyTest]::RegisterHotKey([IntPtr]::Zero,7219,7,90)){throw 'Test combination is already occupied'}
try {
 & node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-hotkey-conflict.js"
 if($LASTEXITCODE -ne 0){throw 'Conflict UI test failed'}
} finally {[DeloHotkeyTest]::UnregisterHotKey([IntPtr]::Zero,7219) | Out-Null}
