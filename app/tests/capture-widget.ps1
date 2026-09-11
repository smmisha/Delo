param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DeloCapture {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@
[DeloCapture]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$window=[DeloCapture]::FindWindow('Delo.Widget.Host','Delo')
if($window -eq [IntPtr]::Zero){throw 'Delo window not found'}
$rect=New-Object DeloCapture+RECT
if(-not [DeloCapture]::GetWindowRect($window,[ref]$rect)){throw 'Cannot read Delo bounds'}
try {
 & node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-freeze.js"
 if($LASTEXITCODE -ne 0){throw 'Could not freeze renderer'}
 $bitmap=New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
 $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
 try {
  $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
  $bitmap.Save([IO.Path]::GetFullPath($OutputPath),[System.Drawing.Imaging.ImageFormat]::Png)
 } finally {$graphics.Dispose();$bitmap.Dispose()}
} finally { & node "$PSScriptRoot/devtools.mjs" --script "$PSScriptRoot/ui-unfreeze.js" }
