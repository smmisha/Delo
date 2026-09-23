# Suspends or resumes the one running Delo harness host, to stand in for a host thread that is
# held up. Refuses to touch anything that is not a named harness session.
param([Parameter(Mandatory=$true)][ValidateSet('suspend','resume')][string]$Mode)
$ErrorActionPreference='Stop'
$hosts=@(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'" | Where-Object {$_.CommandLine -match '--harness='})
if($hosts.Count -ne 1){throw "Expected exactly one Delo harness host, found $($hosts.Count)"}
Add-Type @"
using System;using System.Runtime.InteropServices;
public static class DeloStall{
 [DllImport("kernel32.dll")]public static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr handle);
 [DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr handle);
 [DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr handle);
}
"@
$handle=[DeloStall]::OpenProcess(0x0800,$false,[int]$hosts[0].ProcessId)
if($handle -eq [IntPtr]::Zero){throw 'Cannot open the harness host'}
try{$status=if($Mode -eq 'suspend'){[DeloStall]::NtSuspendProcess($handle)}else{[DeloStall]::NtResumeProcess($handle)};if($status -ne 0){throw "NTSTATUS $status"}}
finally{[void][DeloStall]::CloseHandle($handle)}
'{"ok":true}'
