param(
 [Parameter(Mandatory=$true)][long]$Window,
 [ValidateSet('Trigger','Overlay','SelectCapture','CopyCapture','Escape')][string]$Action='Trigger',
 [ValidateSet('WinShiftS','PrintScreen','Insert')][string]$Shortcut='WinShiftS',
 [long]$OverlayWindow,[string]$OutputPath,[int]$X,[int]$Y,[int]$Width,[int]$Height
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DeloScreenshotShortcut {
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code,uint kind);
}
'@
$target=[IntPtr]$Window
[uint32]$targetId=0
[void][DeloScreenshotShortcut]::GetWindowThreadProcessId($target,[ref]$targetId)
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$targetId"
if($process.Name -ne 'Delo.exe' -or $process.CommandLine -notmatch '--harness=[A-Za-z0-9_-]+'){throw 'Screenshot shortcut test requires a named Delo harness'}
if(-not[DeloScreenshotShortcut]::IsWindowVisible($target)){throw 'Harness window must be visible'}
function Assert-Overlay {
 if($OverlayWindow -eq 0 -or [DeloScreenshotShortcut]::GetForegroundWindow() -ne [IntPtr]$OverlayWindow){throw 'The observed screenshot overlay is no longer foreground; refusing input'}
 [uint32]$overlayId=0
 [void][DeloScreenshotShortcut]::GetWindowThreadProcessId([IntPtr]$OverlayWindow,[ref]$overlayId)
 $overlayProcess=Get-Process -Id $overlayId -ErrorAction Stop
 if($overlayProcess.ProcessName -notin @('SnippingTool','ScreenClippingHost','Lightshot')){throw "Unexpected foreground process: $($overlayProcess.ProcessName); inspect it before continuing"}
 return $overlayProcess.ProcessName
}
function Resolve-EvidencePath {
 if(-not $OutputPath){throw 'OutputPath is required'}
 $evidenceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../test-output'))+[IO.Path]::DirectorySeparatorChar
 $resolved=[IO.Path]::GetFullPath($OutputPath)
 if(-not $resolved.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Screenshot evidence must stay inside app/test-output'}
 New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($resolved)) -Force | Out-Null
 return $resolved
}
$oldDpi=[DeloScreenshotShortcut]::SetThreadDpiAwarenessContext([IntPtr](-4))
try{
 $written=$null
 $clipboardBefore=[DeloScreenshotShortcut]::GetClipboardSequenceNumber()
 $rect=New-Object DeloScreenshotShortcut+RECT
 if(-not [DeloScreenshotShortcut]::GetWindowRect($target,[ref]$rect)){throw 'Cannot read harness bounds'}
 if($Action -eq 'Trigger'){
  foreach($key in @(16,17,18,91,92)){if(([DeloScreenshotShortcut]::GetAsyncKeyState($key) -band 0x8000) -ne 0){throw 'Release modifier keys before running the screenshot test'}}
  [void][DeloScreenshotShortcut]::SetForegroundWindow($target)
  Start-Sleep -Milliseconds 100
  if([DeloScreenshotShortcut]::GetForegroundWindow() -ne $target){throw 'Harness did not receive foreground; no shortcut was sent'}
  $codes=if($Shortcut -eq 'WinShiftS'){@([byte]91,[byte]16,[byte]83)}elseif($Shortcut -eq 'Insert'){@([byte]45)}else{@([byte]44)}
  $pressed=@()
  try{foreach($code in $codes){[DeloScreenshotShortcut]::keybd_event($code,0,0,[UIntPtr]::Zero);$pressed+=,$code}}
  finally{[array]::Reverse($pressed);foreach($code in $pressed){[DeloScreenshotShortcut]::keybd_event($code,0,2,[UIntPtr]::Zero)}}
  Start-Sleep -Milliseconds 700
  if($OutputPath -and [DeloScreenshotShortcut]::GetClipboardSequenceNumber() -ne $clipboardBefore -and [Windows.Forms.Clipboard]::ContainsImage()){
   $file=Resolve-EvidencePath;$captured=[Windows.Forms.Clipboard]::GetImage()
   try{$captured.Save($file,[Drawing.Imaging.ImageFormat]::Png);$written=$file}finally{$captured.Dispose()}
  }
 }
 if($Action -eq 'Overlay'){
  $null=Assert-Overlay
  $file=Resolve-EvidencePath
  $screen=[Windows.Forms.Screen]::FromHandle($target).Bounds
  $bitmap=New-Object Drawing.Bitmap($screen.Width,$screen.Height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try{$graphics.CopyFromScreen($screen.Left,$screen.Top,0,0,$bitmap.Size);$bitmap.Save($file,[Drawing.Imaging.ImageFormat]::Png);$written=$file}finally{$graphics.Dispose();$bitmap.Dispose()}
 }
 if($Action -eq 'SelectCapture'){
  $overlayName=Assert-Overlay
  $file=Resolve-EvidencePath
  if($Width -le 0 -or $Height -le 0 -or $X -lt $rect.Left -or $Y -lt $rect.Top -or ($X+$Width) -ge $rect.Right -or ($Y+$Height) -ge $rect.Bottom){throw 'Select only an inspected rectangle strictly inside the harness bounds'}
  [void][DeloScreenshotShortcut]::SetCursorPos($X,$Y)
  $null=Assert-Overlay
  [DeloScreenshotShortcut]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 100;[void][DeloScreenshotShortcut]::SetCursorPos(($X+$Width),($Y+$Height));Start-Sleep -Milliseconds 150}
  finally{[DeloScreenshotShortcut]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
 }
 if($Action -eq 'CopyCapture' -or ($Action -eq 'SelectCapture' -and $overlayName -eq 'Lightshot')){
   $null=Assert-Overlay
   $file=Resolve-EvidencePath
   Start-Sleep -Milliseconds 100
   $null=Assert-Overlay
   # Local clipboard only; do not invoke Lightshot's upload or save actions.
   [DeloScreenshotShortcut]::keybd_event(17,[byte][DeloScreenshotShortcut]::MapVirtualKey(17,0),0,[UIntPtr]::Zero)
   try{[DeloScreenshotShortcut]::keybd_event(67,[byte][DeloScreenshotShortcut]::MapVirtualKey(67,0),0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 50;[DeloScreenshotShortcut]::keybd_event(67,[byte][DeloScreenshotShortcut]::MapVirtualKey(67,0),2,[UIntPtr]::Zero)}
   finally{[DeloScreenshotShortcut]::keybd_event(17,[byte][DeloScreenshotShortcut]::MapVirtualKey(17,0),2,[UIntPtr]::Zero)}
 }
 if($Action -in @('SelectCapture','CopyCapture')){
  $limit=[DateTime]::UtcNow.AddSeconds(5)
  do{Start-Sleep -Milliseconds 100;$changed=[DeloScreenshotShortcut]::GetClipboardSequenceNumber() -ne $clipboardBefore}while(-not $changed -and [DateTime]::UtcNow -lt $limit)
  if(-not $changed -or -not [Windows.Forms.Clipboard]::ContainsImage()){throw 'Screenshot did not produce a new clipboard image'}
  $captured=[Windows.Forms.Clipboard]::GetImage()
  try{$captured.Save($file,[Drawing.Imaging.ImageFormat]::Png);$written=$file}finally{$captured.Dispose()}
 }
 if($Action -eq 'Escape'){
  $null=Assert-Overlay
  [DeloScreenshotShortcut]::keybd_event(27,0,0,[UIntPtr]::Zero)
  [DeloScreenshotShortcut]::keybd_event(27,0,2,[UIntPtr]::Zero)
 }
 $foreground=[DeloScreenshotShortcut]::GetForegroundWindow()
 [uint32]$foregroundId=0
 [void][DeloScreenshotShortcut]::GetWindowThreadProcessId($foreground,[ref]$foregroundId)
 $foregroundProcess=Get-Process -Id $foregroundId -ErrorAction SilentlyContinue
 @{action=$Action;shortcut=$Shortcut;foreground=$foreground.ToInt64();foregroundProcess=$foregroundProcess.ProcessName;clipboardChanged=([DeloScreenshotShortcut]::GetClipboardSequenceNumber() -ne $clipboardBefore);output=$written;bounds=@{x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)}} | ConvertTo-Json -Compress
}finally{[void][DeloScreenshotShortcut]::SetThreadDpiAwarenessContext($oldDpi)}
