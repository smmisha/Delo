param([string]$Version='0.1.6')
# Session name doubles as the harness id and the data folder, so it must not collide
# with a developer session on the host.
$session='sandbox' + ($Version -replace '\.', '')
$ErrorActionPreference='Stop'
$resultPath='C:\DeloTest\result.json'
$result=[ordered]@{started=(Get-Date).ToString('o');passed=$false}
$result|ConvertTo-Json|Set-Content -LiteralPath 'C:\DeloTest\guest-started.json' -Encoding UTF8
function Has-WebView2 {
  foreach($path in @(
    'HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    if(Test-Path -LiteralPath $path){return $true}
  }
  return $false
}
function Invoke-Cdp([string]$expression) {
  $deadline=(Get-Date).AddSeconds(20);$page=$null
  do {try{$page=@(Invoke-RestMethod 'http://127.0.0.1:9223/json/list' -TimeoutSec 2)|Where-Object{$_.url -like 'https://delo.local/ui/*' -and $_.url -notlike '*view=quick*'}|Select-Object -First 1}catch{};if(-not$page){Start-Sleep -Milliseconds 200}} while(-not$page -and (Get-Date)-lt$deadline)
  if(-not$page){throw 'Delo DevTools page did not start'}
  $socket=New-Object Net.WebSockets.ClientWebSocket
  try {
    $socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $request=@{id=1;method='Runtime.evaluate';params=@{expression=$expression;awaitPromise=$true;returnByValue=$true}}|ConvertTo-Json -Depth 8 -Compress
    $bytes=[Text.Encoding]::UTF8.GetBytes($request);$segment=New-Object ArraySegment[byte] -ArgumentList (,$bytes)
    $socket.SendAsync($segment,[Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
    do {
      $stream=New-Object IO.MemoryStream
      do {$buffer=New-Object byte[] 65536;$receiveSegment=New-Object ArraySegment[byte] -ArgumentList (,$buffer);$received=$socket.ReceiveAsync($receiveSegment,[Threading.CancellationToken]::None).GetAwaiter().GetResult();$stream.Write($buffer,0,$received.Count)}while(-not$received.EndOfMessage)
      $message=[Text.Encoding]::UTF8.GetString($stream.ToArray())|ConvertFrom-Json
    } while($message.id -ne 1)
    if($message.result.exceptionDetails){throw $message.result.exceptionDetails.text}
    return $message.result.result.value
  } finally {$socket.Dispose()}
}
try {
  $result.runtimeBefore=Has-WebView2
  $install=Start-Process "C:\DeloTest\Delo-$Version-windows-x64-setup.exe" -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/DIR=C:\DeloInstalled','/LOG=C:\DeloTest\install.log') -Wait -PassThru
  $result.installExit=$install.ExitCode;if($install.ExitCode-ne0){throw "Installer exited $($install.ExitCode)"}
  $result.runtimeAfter=Has-WebView2
  $result.fileVersion=(Get-Item 'C:\DeloInstalled\Delo.exe').VersionInfo.FileVersion
  $result.installedFiles=@(Get-ChildItem 'C:\DeloInstalled' -File -Recurse).Count
  $process=Start-Process 'C:\DeloInstalled\Delo.exe' -ArgumentList "--harness=$session" -PassThru
  $create=@'
(async()=>{const {HostBridge}=await import('./bridge.mjs');const h=new HostBridge();const input=document.querySelector('#task-input');input.value='Sandbox task';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();await new Promise(r=>setTimeout(r,800));const loaded=await h.request('load');return {diagnostics:await h.window('diagnostics'),saved:loaded.state.tasks.some(t=>t.title==='Sandbox task')}})()
'@
  $result.firstRun=Invoke-Cdp $create
  Stop-Process -Id $process.Id -Force;Start-Sleep -Milliseconds 500
  $process=Start-Process 'C:\DeloInstalled\Delo.exe' -ArgumentList "--harness=$session" -PassThru
  $relaunch=@'
(async()=>{const {HostBridge}=await import('./bridge.mjs');const h=new HostBridge();const loaded=await h.request('load');return {diagnostics:await h.window('diagnostics'),persisted:loaded.state.tasks.some(t=>t.title==='Sandbox task')}})()
'@
  $result.relaunch=Invoke-Cdp $relaunch
  Stop-Process -Id $process.Id -Force;Start-Sleep -Milliseconds 500
  $tasks="C:\DeloInstalled\test-output\sessions\$session\tasks.json";$before=(Get-FileHash $tasks -Algorithm SHA256).Hash
  $uninstall=Start-Process 'C:\DeloInstalled\unins000.exe' -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Wait -PassThru
  $result.uninstallExit=$uninstall.ExitCode;$result.exeRemoved= -not(Test-Path 'C:\DeloInstalled\Delo.exe')
  $result.dataPreserved=(Test-Path $tasks) -and ((Get-FileHash $tasks -Algorithm SHA256).Hash-eq$before)
  $result.passed=$result.runtimeAfter -and $result.firstRun.diagnostics.healthy -and ($result.firstRun.diagnostics.errors-eq0) -and $result.firstRun.saved -and $result.relaunch.persisted -and $result.relaunch.diagnostics.healthy -and ($result.relaunch.diagnostics.errors-eq0) -and ($result.uninstallExit-eq0) -and $result.exeRemoved -and $result.dataPreserved
} catch {$result.error=$_.Exception.Message}
$result.finished=(Get-Date).ToString('o')
# Publish only the complete JSON so the host never reads a partial write.
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath ($resultPath+'.tmp') -Encoding UTF8
Move-Item -LiteralPath ($resultPath+'.tmp') -Destination $resultPath -Force
