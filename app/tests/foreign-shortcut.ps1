# П16 / F05: presses a global shortcut while a window of another process (this script's own form)
# has the focus, the way a user presses it from another program. No clicks and no pointer moves:
# the form takes the foreground through AttachThreadInput, and keys are sent only once it is
# confirmed in front, so nothing reaches the user's own windows. Restricted to a named harness.
param([Parameter(Mandatory=$true)][long]$Window,[Parameter(Mandatory=$true)][string]$Keys)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ForeignShortcut {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint k,uint t);
 // Shares input state with the foreground thread only for the switch itself.
 public static bool Take(IntPtr h){var fg=GetForegroundWindow();if(fg==h)return true;uint pid;var t=GetWindowThreadProcessId(fg,out pid);var me=GetCurrentThreadId();bool attached=t!=0&&t!=me&&AttachThreadInput(me,t,true);try{BringWindowToTop(h);SetForegroundWindow(h);}finally{if(attached)AttachThreadInput(me,t,false);}return GetForegroundWindow()==h;}
}
'@
$target=[IntPtr]$Window
[uint32]$targetId=0
[void][ForeignShortcut]::GetWindowThreadProcessId($target,[ref]$targetId)
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$targetId"
if($process.Name -ne 'Delo.exe' -or $process.CommandLine -notmatch '--harness=[A-Za-z0-9_-]+'){throw 'The shortcut check is restricted to a named Delo harness process'}
$map=@{CTRL=17;ALT=18;SHIFT=16}
$codes=@($Keys.Split('+') | ForEach-Object {if($map.ContainsKey($_)){[byte]$map[$_]}elseif($_.Length -eq 1){[byte][char]$_.ToUpper()}else{throw "Unsupported key $_"}})
$pump={param($ms)$end=[Environment]::TickCount+$ms;do{[System.Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 15}while([Environment]::TickCount -lt $end)}
$widget=New-Object ForeignShortcut+RECT;[void][ForeignShortcut]::GetWindowRect($target,[ref]$widget)
$area=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form=New-Object System.Windows.Forms.Form
$form.Text='Delo harness: another program';$form.TopMost=$true;$form.ShowInTaskbar=$false;$form.StartPosition='Manual';$form.Size=New-Object System.Drawing.Size 360,180
$result=[ordered]@{keys=$Keys;attempts=0;foreignBefore=$false;foreignAfter=$false;deloForegroundAfter=$false}
try {
 $form.Show();& $pump 150
 # The first place on a grid of the primary screen that stays clear of the widget.
 $placed=$false
 foreach($fy in 0.05,0.4,0.75){foreach($fx in 0.05,0.35,0.65){
  if($placed){continue}
  $form.Location=New-Object System.Drawing.Point ([int]($area.Left+($area.Width-360)*$fx)),([int]($area.Top+($area.Height-180)*$fy));& $pump 40
  $r=New-Object ForeignShortcut+RECT;[void][ForeignShortcut]::GetWindowRect($form.Handle,[ref]$r)
  $placed=$r.Right -le $widget.Left -or $r.Left -ge $widget.Right -or $r.Bottom -le $widget.Top -or $r.Top -ge $widget.Bottom
 }}
 if(-not $placed){throw 'No place clear of the widget; no keys were sent'}
 for($attempt=1;$attempt -le 5 -and -not $result.foreignBefore;$attempt++){
  $result.attempts=$attempt
  if([ForeignShortcut]::Take($form.Handle)){& $pump 150}else{& $pump 100}
  $result.foreignBefore=([ForeignShortcut]::GetForegroundWindow() -eq $form.Handle)
 }
 if(-not $result.foreignBefore){throw 'The foreign window did not become foreground; no keys were sent'}
 try{foreach($code in $codes){[ForeignShortcut]::keybd_event($code,[byte][ForeignShortcut]::MapVirtualKey($code,0),0,[UIntPtr]::Zero)}}
 finally{[array]::Reverse($codes);foreach($code in $codes){[ForeignShortcut]::keybd_event($code,[byte][ForeignShortcut]::MapVirtualKey($code,0),2,[UIntPtr]::Zero)}}
 & $pump 500
 $foreground=[ForeignShortcut]::GetForegroundWindow()
 $result.foreignAfter=($foreground -eq $form.Handle)
 $result.deloForegroundAfter=($foreground -eq $target)
} finally {
 $form.Close();$form.Dispose()
}
$result | ConvertTo-Json -Compress
