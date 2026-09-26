# Read-only Windows facts for lifecycle-check.mjs: where the harness window is, on which monitor,
# at what DPI; whether the user's own installed widget is still up and answering; and whether
# Windows recorded a Delo crash since -Since. Changes nothing.
param([Parameter(Mandatory=$true)][long]$Window,[string]$Since)
$ErrorActionPreference='Stop'
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;using System.Collections.Generic;
public static class DeloLife{
 [StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,R,B;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]public struct MI{public int cb;public RECT m;public RECT w;public uint f;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string dev;}
 public delegate bool EnumMon(IntPtr h,IntPtr dc,ref RECT r,IntPtr d);
 public delegate bool EnumWin(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")]public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr MonitorFromWindow(IntPtr h,uint f);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern bool GetMonitorInfo(IntPtr h,ref MI mi);
 [DllImport("user32.dll")]public static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,EnumMon p,IntPtr d);
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumWin p,IntPtr l);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint f,uint t,out IntPtr r);
 public static int Monitors(){int n=0;EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,(IntPtr h,IntPtr dc,ref RECT r,IntPtr d)=>{n++;return true;},IntPtr.Zero);return n;}
 public static IntPtr MainWindow(uint pid){IntPtr found=IntPtr.Zero;EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid){var t=new StringBuilder(32);GetWindowText(h,t,32);if(t.ToString()=="Delo"){found=h;return false;}}return true;},IntPtr.Zero);return found;}
}
"@
[void][DeloLife]::SetProcessDpiAwarenessContext([IntPtr]-4)
$h=[IntPtr]$Window;$r=New-Object DeloLife+RECT;[void][DeloLife]::GetWindowRect($h,[ref]$r)
$mon=[DeloLife]::MonitorFromWindow($h,2);$mi=New-Object DeloLife+MI;$mi.cb=[Runtime.InteropServices.Marshal]::SizeOf($mi);[void][DeloLife]::GetMonitorInfo($mon,[ref]$mi)
$result=[ordered]@{
 rect=@{left=$r.L;top=$r.T;right=$r.R;bottom=$r.B};work=@{left=$mi.w.L;top=$mi.w.T;right=$mi.w.R;bottom=$mi.w.B}
 monitor=$mi.dev;monitors=[DeloLife]::Monitors();dpi=[DeloLife]::GetDpiForWindow($h)
 visible=[DeloLife]::IsWindowVisible($h);iconic=[DeloLife]::IsIconic($h)
}
# The user's own widget: the installed copy, not a harness.
$own=@(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -notmatch '--harness'})
$production=[ordered]@{running=($own.Count -eq 1);path=$(if($own.Count){$own[0].ExecutablePath}else{$null});started=$(if($own.Count){$own[0].CreationDate.ToString('s')}else{$null})}
if($own.Count -eq 1){$w=[DeloLife]::MainWindow([uint32]$own[0].ProcessId);$answer=[IntPtr]::Zero
 $production.visible=($w -ne [IntPtr]::Zero) -and [DeloLife]::IsWindowVisible($w)
 $production.iconic=($w -ne [IntPtr]::Zero) -and [DeloLife]::IsIconic($w)
 $production.responds=($w -ne [IntPtr]::Zero) -and ([DeloLife]::SendMessageTimeout($w,0,[IntPtr]::Zero,[IntPtr]::Zero,2,2000,[ref]$answer) -ne [IntPtr]::Zero)}
$result.production=$production
if($Since){
 $from=[datetime]::Parse($Since)
 $crashes=@(Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$from} -ErrorAction SilentlyContinue | Where-Object {$_.ProviderName -in 'Application Error','Windows Error Reporting','Application Hang' -and $_.Message -match 'Delo\.exe'})
 $result.crashes=@($crashes | ForEach-Object {"$($_.TimeCreated.ToString('s')) $($_.ProviderName) $($_.Id)"})
 $power=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-Power';StartTime=$from} -ErrorAction SilentlyContinue | Where-Object {$_.Id -in 506,507,42,107})
 $result.sleepEvents=@($power | ForEach-Object {"$($_.TimeCreated.ToString('s')) $($_.Id)"})
}
$result | ConvertTo-Json -Depth 4 -Compress
