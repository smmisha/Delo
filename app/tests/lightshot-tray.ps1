param([Parameter(Mandatory=$true)][long]$Window,[ValidateSet('Inspect','Trigger','OtherTray')][string]$Action='Inspect',[switch]$RightClick)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DeloLightshotTrayTest {
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
[uint32]$targetId=0
[void][DeloLightshotTrayTest]::GetWindowThreadProcessId([IntPtr]$Window,[ref]$targetId)
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$targetId"
if($process.Name -ne 'Delo.exe' -or $process.CommandLine -notmatch '--harness=[A-Za-z0-9_-]+' -or -not[DeloLightshotTrayTest]::IsWindowVisible([IntPtr]$Window)){throw 'A visible named Delo harness is required'}
$oldDpi=[DeloLightshotTrayTest]::SetThreadDpiAwarenessContext([IntPtr](-4))
try{
 $root=[System.Windows.Automation.AutomationElement]::RootElement
 function Find-Lightshot {
  foreach($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)){
   if($w.Current.ClassName -notin @('Shell_TrayWnd','Shell_SecondaryTrayWnd','TopLevelWindowForOverflowXamlIsland','NotifyIconOverflowWindow')){continue}
   if(-not[DeloLightshotTrayTest]::IsWindowVisible([IntPtr]$w.Current.NativeWindowHandle)){continue}
   foreach($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)){
    if($e.Current.Name -like 'Lightshot*' -and -not $e.Current.IsOffscreen){return $e}
   }
  }
 }
 $icon=Find-Lightshot
 if($Action -eq 'OtherTray'){
  $tray=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Shell_TrayWnd'))
  $icon=$tray.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {$_.Current.Name -like 'Показать скрытые значки*'} | Select-Object -First 1
  if(-not $icon){throw 'The previously inspected hidden-icons button is unavailable'}
 }
 if(-not $icon){
  $tray=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Shell_TrayWnd'))
  $overflow=$tray.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Показать скрытые значки'))
  if(-not $overflow){throw 'The previously inspected hidden-icons button is unavailable'}
  $overflow.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 200
  $icon=Find-Lightshot
 }
 if(-not $icon){throw 'Lightshot tray icon is unavailable'}
 $r=$icon.Current.BoundingRectangle
 $x=[int]($r.X+$r.Width/2);$y=[int]($r.Y+$r.Height/2)
 if($Action -in @('Trigger','OtherTray')){
  $hit=[System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($x,$y))
  $matched=$false
  for($i=0;$hit -and $i -lt 4;$i++){
   if($hit.Current.Name -eq $icon.Current.Name){$matched=$true;break}
   # Windows 11's overflow provider may expose only its root to FromPoint.
   if($hit.Current.ClassName -in @('TopLevelWindowForOverflowXamlIsland','NotifyIconOverflowWindow','Shell_TrayWnd')){
    $current=if($Action -eq 'OtherTray'){$icon}else{Find-Lightshot};$b=$current.Current.BoundingRectangle
    $matched=$current -and $x -ge $b.Left -and $x -lt $b.Right -and $y -ge $b.Top -and $y -lt $b.Bottom
    break
   }
   $hit=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($hit)
  }
  if(-not $matched){throw "Lightshot tray position changed at $x,$y; refusing input"}
  [void][DeloLightshotTrayTest]::SetCursorPos($x,$y)
  $down=if($RightClick){8}else{2};$up=if($RightClick){16}else{4}
  [DeloLightshotTrayTest]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 90}finally{[DeloLightshotTrayTest]::mouse_event($up,0,0,0,[UIntPtr]::Zero)}
  Start-Sleep -Milliseconds 700
 }
 $foreground=[DeloLightshotTrayTest]::GetForegroundWindow();[uint32]$foregroundId=0
 [void][DeloLightshotTrayTest]::GetWindowThreadProcessId($foreground,[ref]$foregroundId)
 @{action=$Action;icon=$icon.Current.Name;x=$x;y=$y;foreground=$foreground.ToInt64();foregroundProcess=(Get-Process -Id $foregroundId).ProcessName} | ConvertTo-Json -Compress
}finally{[void][DeloLightshotTrayTest]::SetThreadDpiAwarenessContext($oldDpi)}
