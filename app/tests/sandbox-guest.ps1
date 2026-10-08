param([string]$Version='0.3.6',[string]$From)
# Clean install: install $Version, create a task, relaunch, uninstall.
# With -From: install $From first and create the task there, run it as the user's widget on that
# data, then install $Version over the running widget (V12 update, N09): the installer has to close
# it, keep the data and start the new version again.
# Session name doubles as the harness id and the data folder, so it must not collide
# with a developer session on the host.
$session='sandbox' + ($Version -replace '\.', '')
$ErrorActionPreference='Stop'
$resultPath='C:\DeloTest\result.json'
$result=[ordered]@{started=(Get-Date).ToString('o');version=$Version;from=$From;passed=$false}
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
  # DevTools lists the page before its document has loaded; an evaluation in the blank first
  # document fails or is destroyed with it, so the page is awaited and the call retried.
  $expression="(async()=>{await new Promise(r=>{const t=()=>location.origin==='https://delo.local'&&document.readyState==='complete'&&document.querySelector('#task-input')?r():setTimeout(t,100);t();});return await $expression})()"
  for($attempt=1;;$attempt++){try{return Invoke-CdpOnce $expression}catch{if($attempt-ge5){throw};Start-Sleep -Seconds 1}}
}
function Invoke-CdpOnce([string]$expression) {
  # Windows PowerShell passes the JSON array down the pipeline as one object; ForEach-Object unrolls it.
  $deadline=(Get-Date).AddSeconds(20);$page=$null
  do {try{$page=(Invoke-RestMethod 'http://127.0.0.1:9223/json/list' -TimeoutSec 2)|ForEach-Object{$_}|Where-Object{$_.url -like 'https://delo.local/ui/*' -and $_.url -notlike '*view=quick*'}|Select-Object -First 1}catch{};if(-not$page){Start-Sleep -Milliseconds 200}} while(-not$page -and (Get-Date)-lt$deadline)
  if(-not$page){throw 'Delo DevTools page did not start'}
  # A page that stops answering must fail the run, not hang it.
  $socket=New-Object Net.WebSockets.ClientWebSocket;$limit=New-Object Threading.CancellationTokenSource 60000
  try {
    # The awaiters return VoidTaskResult, which would otherwise join the function's output.
    $null=$socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl,$limit.Token).GetAwaiter().GetResult()
    $request=@{id=1;method='Runtime.evaluate';params=@{expression=$expression;awaitPromise=$true;returnByValue=$true}}|ConvertTo-Json -Depth 8 -Compress
    $bytes=[Text.Encoding]::UTF8.GetBytes($request);$segment=New-Object ArraySegment[byte] -ArgumentList (,$bytes)
    $null=$socket.SendAsync($segment,[Net.WebSockets.WebSocketMessageType]::Text,$true,$limit.Token).GetAwaiter().GetResult()
    do {
      $stream=New-Object IO.MemoryStream
      do {$buffer=New-Object byte[] 65536;$receiveSegment=New-Object ArraySegment[byte] -ArgumentList (,$buffer);$received=$socket.ReceiveAsync($receiveSegment,$limit.Token).GetAwaiter().GetResult();$stream.Write($buffer,0,$received.Count)}while(-not$received.EndOfMessage)
      $message=[Text.Encoding]::UTF8.GetString($stream.ToArray())|ConvertFrom-Json
    } while($message.id -ne 1)
    # A reload destroys the context; DevTools reports that as a protocol error, not an exception.
    if($message.error){throw $message.error.message}
    if($message.result.exceptionDetails){throw $message.result.exceptionDetails.text}
    if($null-eq$message.result.result.value){throw 'The page returned nothing'}
    return $message.result.result.value
  } catch {throw "DevTools: $($_.Exception.GetBaseException().Message)"} finally {$socket.Dispose();$limit.Dispose()}
}
function Install([string]$version) {
  # Not Start-Process -Wait: it also waits for the widget the installer starts again after an update.
  $install=Start-Process "C:\DeloTest\Delo-$version-windows-x64-setup.exe" -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/DIR=C:\DeloInstalled',"/LOG=C:\DeloTest\install-$version.log") -PassThru
  $null=$install.Handle;if(-not$install.WaitForExit(600000)){throw "Installer $version did not exit in 10 minutes"}
  if($install.ExitCode-ne0){throw "Installer $version exited $($install.ExitCode)"}
  return [ordered]@{exit=$install.ExitCode;fileVersion=(Get-Item 'C:\DeloInstalled\Delo.exe').VersionInfo.ProductVersion;files=@(Get-ChildItem 'C:\DeloInstalled' -File -Recurse|Where-Object{$_.FullName -notlike 'C:\DeloInstalled\test-output\*'}).Count}
}
function Step([string]$name){Add-Content -LiteralPath 'C:\DeloTest\progress.txt' -Value "$((Get-Date).ToString('HH:mm:ss')) $name"}
function Widgets {@(Get-CimInstance Win32_Process -Filter "Name='Delo.exe'"|Where-Object{$_.CommandLine -notlike '*--harness*'})}
$create=@'
(async()=>{const {HostBridge}=await import('./bridge.mjs');const h=new HostBridge();const input=document.querySelector('#task-input');input.value='Sandbox task';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#entry').requestSubmit();await new Promise(r=>setTimeout(r,800));const loaded=await h.request('load');return {diagnostics:await h.window('diagnostics'),saved:loaded.state.tasks.some(t=>t.title==='Sandbox task'),kept:loaded.state.tasks.some(t=>t.title==='Task from the old version')}})()
'@
$relaunch=@'
(async()=>{const {HostBridge}=await import('./bridge.mjs');const h=new HostBridge();const loaded=await h.request('load');return {diagnostics:await h.window('diagnostics'),persisted:loaded.state.tasks.some(t=>t.title==='Sandbox task'),kept:loaded.state.tasks.some(t=>t.title==='Task from the old version')}})()
'@
function Has-Task($path,$title){$data=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json;return @($data.state.tasks|Where-Object{$_.title -eq $title}).Count-eq1}
try {
  $result.windows=(Get-CimInstance Win32_OperatingSystem|Select-Object Caption,Version,BuildNumber)
  $result.runtimeBefore=Has-WebView2
  $sessionData="C:\DeloInstalled\test-output\sessions\$session";$tasks="$sessionData\tasks.json"
  $updateOk=$true
  if($From){
    Step 'install old'
    $result.install=Install $From
    # The user's widget of the old version runs on its own data. Versions up to 0.1.10 open DevTools
    # through an environment variable that Windows Sandbox ignores, so the old version's data is
    # written as a file rather than typed into it.
    $userData=Join-Path $env:LOCALAPPDATA 'Delo';$userTasks=Join-Path $userData 'tasks.json'
    New-Item -ItemType Directory -Path $userData -Force|Out-Null
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $seed='{"format":1,"revision":1,"state":{"events":[],"reputation":0,"schemaVersion":1,"settings":{"archiveDays":30,"autoArchive":"all","autostart":false,"completionSound":true,"language":"ru","listShortcut":"Ctrl+Alt+Space","overdueSound":true,"pinned":false,"quickShortcut":"Ctrl+Alt+N","reducedMotion":false,"theme":"system"},"tasks":[{"archiveAnchor":NOW,"award":0,"completedAt":null,"completedDayEnd":null,"createdAt":NOW,"deletedAt":null,"due":null,"elapsedMs":61000,"id":"5a2d6c1e-0b7f-4d3a-9e41-7c0f1d2b3a45","lifecycle":"active","penalties":{"first":false,"week":false},"timerAnchor":null,"title":"Task from the old version","undoRemaining":null,"workState":"paused"}]}}' -replace 'NOW',$now
    [IO.File]::WriteAllText($userTasks,$seed,(New-Object Text.UTF8Encoding($false)))
    Step 'start old widget'
    Start-Process 'C:\DeloInstalled\Delo.exe'|Out-Null
    # Give it time to load, show the glass and settle, as a person's widget would be.
    Start-Sleep -Seconds 10
    $old=@(Widgets);$result.update=[ordered]@{runningBefore=$old.Count;oldLoaded=[bool](Select-String -LiteralPath (Join-Path $userData 'native.jsonl') -Pattern '"main_loaded","value":"true"' -Quiet -ErrorAction SilentlyContinue)}
    $watch=[Diagnostics.Stopwatch]::StartNew()
    Step 'update'
    $result.update.install=Install $Version
    $result.update.seconds=[math]::Round($watch.Elapsed.TotalSeconds,1)
    Start-Sleep -Seconds 10
    Step 'after update'
    $new=@(Widgets)
    $result.update.oldGone=-not($new|Where-Object{$old.ProcessId -contains $_.ProcessId})
    $result.update.relaunched=@($new|Where-Object{$_.ExecutablePath -eq 'C:\DeloInstalled\Delo.exe'}).Count-eq1
    Step 'check user data'
    $result.update.userDataKept=Has-Task $userTasks 'Task from the old version'
    # Plain strings: Get-Content attaches provider objects that ConvertTo-Json would walk for minutes.
    $result.update.log=@(Get-Content -LiteralPath (Join-Path $userData 'native.jsonl') -Tail 12 -ErrorAction SilentlyContinue|ForEach-Object{New-Object string (,$_.ToCharArray())})
    $updateOk=$result.update.runningBefore-eq1 -and $result.update.oldLoaded -and $result.update.install.fileVersion-eq$Version -and $result.update.oldGone -and $result.update.relaunched -and $result.update.userDataKept
    # The new version's harness starts from the user's updated data.
    New-Item -ItemType Directory -Path $sessionData -Force|Out-Null
    Copy-Item -LiteralPath $userTasks -Destination $tasks -Force
  }else{$result.install=Install $Version}
  $result.runtimeAfter=Has-WebView2
  Step 'first harness run'
  $process=Start-Process 'C:\DeloInstalled\Delo.exe' -ArgumentList "--harness=$session" -PassThru;$null=$process.Handle
  try{$result.firstRun=Invoke-Cdp $create}catch{throw "first harness run: $($_.Exception.Message); harness exited=$($process.HasExited) code=$(if($process.HasExited){$process.ExitCode})"}
  Stop-Process -Id $process.Id -Force;Start-Sleep -Milliseconds 500
  Step 'harness relaunch'
  $process=Start-Process 'C:\DeloInstalled\Delo.exe' -ArgumentList "--harness=$session" -PassThru;$null=$process.Handle
  try{$result.relaunch=Invoke-Cdp $relaunch}catch{throw "harness relaunch: $($_.Exception.Message); harness exited=$($process.HasExited) code=$(if($process.HasExited){$process.ExitCode})"}
  Stop-Process -Id $process.Id -Force;Start-Sleep -Milliseconds 500
  $keptOk=-not$From -or ($result.firstRun.kept -and $result.relaunch.kept)
  $before=(Get-FileHash $tasks -Algorithm SHA256).Hash
  Step 'uninstall'
  # Uninstall also has to close the user's widget when the update started it again.
  $uninstall=Start-Process 'C:\DeloInstalled\unins000.exe' -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=C:\DeloTest\uninstall.log") -Wait -PassThru
  Start-Sleep -Seconds 2
  $result.uninstallExit=$uninstall.ExitCode;$result.exeRemoved= -not(Test-Path 'C:\DeloInstalled\Delo.exe');$result.widgetClosed=@(Widgets).Count-eq0
  $result.dataPreserved=(Test-Path $tasks) -and ((Get-FileHash $tasks -Algorithm SHA256).Hash-eq$before)
  if($From){$result.userDataPreserved=Has-Task $userTasks 'Task from the old version'}else{$result.userDataPreserved=$true}
  $result.passed=$result.runtimeAfter -and $result.install.fileVersion-eq$(if($From){$From}else{$Version}) -and $result.firstRun.diagnostics.healthy -and ($result.firstRun.diagnostics.errors-eq0) -and $result.firstRun.saved -and $updateOk -and $keptOk -and $result.relaunch.persisted -and $result.relaunch.diagnostics.healthy -and ($result.relaunch.diagnostics.errors-eq0) -and ($result.uninstallExit-eq0) -and $result.exeRemoved -and $result.widgetClosed -and $result.dataPreserved -and $result.userDataPreserved
} catch {$result.error=$_.Exception.Message;Step "error: $($result.error)"}
# A failed step must not leave a harness widget holding the DevTools port for the next run.
Get-CimInstance Win32_Process -Filter "Name='Delo.exe'"|Where-Object{$_.CommandLine -like '*--harness*'}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
$result.finished=(Get-Date).ToString('o')
Step 'writing result'
# Publish only the complete JSON so the host never reads a partial write.
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath ($resultPath+'.tmp') -Encoding UTF8
Move-Item -LiteralPath ($resultPath+'.tmp') -Destination $resultPath -Force
