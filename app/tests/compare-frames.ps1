param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$RegionsFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$regions=Get-Content -LiteralPath $RegionsFile -Raw | ConvertFrom-Json
$files=@(Get-ChildItem -LiteralPath $Directory -Filter 'frame-*.png' | Sort-Object Name)
if($files.Count -lt 10){throw 'At least 10 consecutive frames are required'}
$base=[Drawing.Bitmap]::FromFile($files[0].FullName)
$result=@{}
try{
 foreach($property in $regions.PSObject.Properties){
  $r=$property.Value;$maximum=0;$changedFrames=0
  foreach($file in $files | Select-Object -Skip 1){
   $next=[Drawing.Bitmap]::FromFile($file.FullName)
   try{$changed=0;for($y=[int]$r.y;$y -lt [int]($r.y+$r.height);$y++){for($x=[int]$r.x;$x -lt [int]($r.x+$r.width);$x++){if($base.GetPixel($x,$y).ToArgb() -ne $next.GetPixel($x,$y).ToArgb()){$changed++}}};$maximum=[Math]::Max($maximum,$changed);if($changed){$changedFrames++}}finally{$next.Dispose()}
  }
  $result[$property.Name]=@{maxChangedPixels=$maximum;changedFrames=$changedFrames;frames=$files.Count;region=$r}
 }
}finally{$base.Dispose()}
$result | ConvertTo-Json -Depth 6
