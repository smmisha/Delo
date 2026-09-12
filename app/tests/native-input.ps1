param([Parameter(Mandatory=$true)][long]$Window,[ValidateSet('click','move','keys','resize','capture','compose','drag','outside','traySingle','trayDouble')][string]$Action,[int]$X,[int]$Y,[int]$Width,[int]$Height,[string]$Keys,[string]$OutputPath,[string]$Base,[string]$Overlay,[int]$Frames=1,[ValidateRange(1,600)][int]$DragSteps=1,[ValidateRange(1,500)][int]$DragStepMs=130,[switch]$PreciseDrag)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DeloInput {
 [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint key,uint type);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
 [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWaitableTimerEx(IntPtr attributes,string name,uint flags,uint access);
 [DllImport("kernel32.dll")] static extern bool SetWaitableTimer(IntPtr timer,ref long due,int period,IntPtr callback,IntPtr context,bool resume);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static void PrecisePause(int milliseconds) {
  var timer=CreateWaitableTimerEx(IntPtr.Zero,null,2,0x100002);
  if(timer==IntPtr.Zero)throw new InvalidOperationException("Cannot create precise drag timer");
  try{long due=-milliseconds*10000L;if(!SetWaitableTimer(timer,ref due,0,IntPtr.Zero,IntPtr.Zero,false)||WaitForSingleObject(timer,1000)!=0)throw new InvalidOperationException("Precise drag timer failed");}
  finally{CloseHandle(timer);}
 }
}
'@
$target=[IntPtr]$Window
[uint32]$targetId=0
[void][DeloInput]::GetWindowThreadProcessId($target,[ref]$targetId)
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$targetId"
# compose only reads and writes image files; the named-harness guard exists to keep input
# and screen grabs away from the user's own copy, and neither is involved here.
if($Action -ne 'compose' -and ($process.Name -ne 'Delo.exe' -or $process.CommandLine -notmatch '--harness=[A-Za-z0-9_-]+')){throw 'Native input is restricted to a named Delo harness process'}
$previousDpi=[DeloInput]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
 if($Action -in 'click','keys','drag'){
  [void][DeloInput]::SetForegroundWindow($target)
  Start-Sleep -Milliseconds 100
  if($Action -eq 'keys' -and [DeloInput]::GetForegroundWindow() -ne $target){throw 'Delo harness did not receive foreground; refusing to send input'}
 }
 if($Action -in 'click','move','drag'){
  $rect=New-Object DeloInput+RECT
  [void][DeloInput]::GetWindowRect($target,[ref]$rect)
  if($X -lt $rect.Left -or $X -ge $rect.Right -or $Y -lt $rect.Top -or $Y -ge $rect.Bottom){throw 'Pointer must start inside the harness window'}
  $point=New-Object DeloInput+POINT; $point.X=$X; $point.Y=$Y
  [uint32]$hitId=0
  $hit=[DeloInput]::WindowFromPoint($point)
  [void][DeloInput]::GetWindowThreadProcessId($hit,[ref]$hitId)
  if($hitId -ne $targetId -and [DeloInput]::GetAncestor($hit,2) -ne $target){throw "Another window covers the harness pointer target (hit=$hit, pid=$hitId); refusing to click"}
  [void][DeloInput]::SetCursorPos($X,$Y)
  if($Action -ne 'move'){
   [DeloInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
   try {
    if($Action -eq 'drag'){
     Start-Sleep -Milliseconds 70
     if([DeloInput]::GetForegroundWindow() -ne $target){throw 'Harness did not activate on pointer down'}
     for($step=1;$step -le $DragSteps;$step++){
      [void][DeloInput]::SetCursorPos(($X+[int]($Width*$step/$DragSteps)),($Y+[int]($Height*$step/$DragSteps)))
      if($PreciseDrag){[DeloInput]::PrecisePause($DragStepMs)}else{Start-Sleep -Milliseconds $DragStepMs}
     }
    }
   } finally {[DeloInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
  }
 }
 if($Action -eq 'keys'){
  $map=@{CTRL=17;ALT=18;SHIFT=16;WIN=91;SPACE=32;ENTER=13;ESCAPE=27;TAB=9;BACKSPACE=8}
  $codes=@($Keys.Split('+') | ForEach-Object {if($map.ContainsKey($_)){[byte]$map[$_]}elseif($_.Length -eq 1){[byte][char]$_.ToUpper()}else{throw "Unsupported key $_"}})
  foreach($code in $codes){[DeloInput]::keybd_event($code,[byte][DeloInput]::MapVirtualKey($code,0),0,[UIntPtr]::Zero)}
  [array]::Reverse($codes)
  foreach($code in $codes){[DeloInput]::keybd_event($code,[byte][DeloInput]::MapVirtualKey($code,0),2,[UIntPtr]::Zero)}
 }
 if($Action -eq 'resize'){[void][DeloInput]::SetWindowPos($target,[IntPtr]::Zero,0,0,$Width,$Height,6)}
 if($Action -eq 'outside'){
  $outside=[DeloInput]::CreateWindowEx(0x88,'STATIC','Delo harness outside target',[uint32]2415919104,900,180,240,120,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
  if($outside -eq [IntPtr]::Zero){throw 'Cannot create harness outside-click target'}
  try{[void][DeloInput]::SetForegroundWindow($outside);[void][DeloInput]::SetCursorPos(1000,230);[DeloInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[DeloInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 200}finally{[void][DeloInput]::DestroyWindow($outside)}
 }
 if($Action -in 'traySingle','trayDouble'){
  [void][DeloInput]::PostMessage($target,0x8001,[IntPtr]1,[IntPtr]0x202)
  if($Action -eq 'trayDouble'){Start-Sleep -Milliseconds 50;[void][DeloInput]::PostMessage($target,0x8001,[IntPtr]1,[IntPtr]0x203);[void][DeloInput]::PostMessage($target,0x8001,[IntPtr]1,[IntPtr]0x202)}
  # The callback must complete immediately; waiting for GetDoubleClickTime here used
  # to hide the production delay that this harness is supposed to detect.
  Start-Sleep -Milliseconds 10
 }
 if($Action -eq 'compose'){
  # The widget never appears in a screen grab, so a picture of it is assembled from the
  # two layers that actually compose on screen: GPU material below, document above.
  $under=[Drawing.Image]::FromFile([IO.Path]::GetFullPath($Base))
  $over=[Drawing.Image]::FromFile([IO.Path]::GetFullPath($Overlay))
  $canvas=New-Object Drawing.Bitmap($under.Width,$under.Height)
  $graphics=[Drawing.Graphics]::FromImage($canvas)
  try{
   $graphics.CompositingQuality=[Drawing.Drawing2D.CompositingQuality]::HighQuality
   $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
   $graphics.DrawImage($under,(New-Object Drawing.Rectangle 0,0,$under.Width,$under.Height))
   $graphics.DrawImage($over,(New-Object Drawing.Rectangle 0,0,$under.Width,$under.Height))
   $canvas.Save([IO.Path]::GetFullPath($OutputPath),[Drawing.Imaging.ImageFormat]::Png)
  }finally{$graphics.Dispose();$canvas.Dispose();$under.Dispose();$over.Dispose()}
 }
 if($Action -eq 'capture'){
  $rect=New-Object DeloInput+RECT;[void][DeloInput]::GetWindowRect($target,[ref]$rect)
  for($index=0;$index -lt $Frames;$index++){
   $bitmap=New-Object Drawing.Bitmap(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
   $graphics=[Drawing.Graphics]::FromImage($bitmap)
   try{$graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size);$path=if($Frames -eq 1){$OutputPath}else{Join-Path $OutputPath ('frame-{0:D2}.png' -f $index)};$bitmap.Save([IO.Path]::GetFullPath($path),[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}
   if($index -lt $Frames-1){Start-Sleep -Milliseconds 120}
  }
 }
 @{action=$Action;pid=$targetId;foreground=[DeloInput]::GetForegroundWindow().ToInt64()} | ConvertTo-Json -Compress
} finally {[void][DeloInput]::SetThreadDpiAwarenessContext($previousDpi)}
