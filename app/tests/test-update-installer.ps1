param([switch]$KeepInstallation)

$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testId = [Guid]::NewGuid().ToString()
$testRoot = Join-Path $appRoot "bin/test-output/update-installer-$testId"
$defaultDir = Join-Path $testRoot 'Default install with spaces'
$installDir = Join-Path $testRoot 'Selected install with spaces'
$testRegistry = "Software\Delo\UpdateInstallerTests\$testId"
$runKey = "$testRegistry\Run"
$approvedKey = "$testRegistry\StartupApproved\Run"
$group = "Delo update installer test $testId"
$checks = 0

function Assert-Test([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:checks++
    Write-Host "PASS $Message"
}

function Read-RegistryValue([string]$Key, [string]$Name) {
    $keyHandle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Key)
    if ($null -eq $keyHandle) { return '<missing>' }
    try {
        if ($keyHandle.GetValueNames() -notcontains $Name) { return '<missing>' }
        $value = $keyHandle.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($value -is [byte[]]) { $value = [Convert]::ToBase64String($value) }
        return "$($keyHandle.GetValueKind($Name))|$value"
    } finally { $keyHandle.Dispose() }
}

function Set-TestStartup($Command) {
    $keyHandle = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($runKey)
    try {
        if ($null -eq $Command) { $keyHandle.DeleteValue('Delo', $false) }
        else { $keyHandle.SetValue('Delo', $Command, [Microsoft.Win32.RegistryValueKind]::String) }
    } finally { $keyHandle.Dispose() }
}

function Wait-TestUninstallerFiles {
    foreach ($name in @('unins000.exe', 'unins000.dat')) {
        $path = Join-Path $installDir $name
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $available = $false
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            try {
                $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
                $stream.Dispose()
                $available = $true
                break
            } catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
        }
        if (-not $available) { throw "Test uninstaller is still locked: $path" }
    }
}

function Invoke-TestSetup([string]$Scenario, [string]$Directory = '') {
    Wait-TestUninstallerFiles
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/LOG=`"$testRoot\$Scenario.log`"")
    if ($Directory) { $arguments += "/DIR=`"$Directory`"" }
    $process = Start-Process -FilePath $script:setup -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    Assert-Test ($process.ExitCode -eq 0) "Installer completed: $Scenario"
}

# Refuse to run if setup could install/update a shared dependency on this machine.
$runtimePresent = $false
foreach ($root in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($root, $view)
        $keyHandle = $base.OpenSubKey('Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
        try {
            if ($keyHandle) {
                $runtimeMajor = ([string]$keyHandle.GetValue('pv')).Split('.')[0] -as [int]
                if ($runtimeMajor -ge 120) { $runtimePresent = $true }
            }
        } finally {
            if ($keyHandle) { $keyHandle.Dispose() }
            $base.Dispose()
        }
    }
}
if (-not $runtimePresent) { throw 'An existing WebView2 runtime is required; this test never installs shared dependencies.' }

$productionRunKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
$productionApprovedKey = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$productionRun = Read-RegistryValue $productionRunKey 'Delo'
$productionApproved = Read-RegistryValue $productionApprovedKey 'Delo'
$uninstallPath = Join-Path $installDir 'unins000.exe'
$installed = $false
$cleanupFailure = ''

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $compiler = Join-Path $appRoot 'vendor/inno/ISCC.exe'
    $compilerArguments = @(
        '/Qp', '/DUpdateInstallerTest', '/DAppVersion=99.0.0',
        "/DTestAppId={{$testId}", "/DTestDir=$defaultDir", "/DTestRunKey=$runKey", "/DTestGroup=$group",
        "/O$testRoot", '/Fisolated-update-setup', (Join-Path $appRoot 'installer/Delo.iss')
    )
    & $compiler @compilerArguments *> (Join-Path $testRoot 'compile.log')
    if ($LASTEXITCODE -ne 0) { throw "Test installer compilation failed; see $testRoot\compile.log" }
    $script:setup = Join-Path $testRoot 'isolated-update-setup.exe'
    Assert-Test (Test-Path -LiteralPath $script:setup) 'Isolated installer compiled'

    # A separate data directory is deliberately outside the application directory,
    # matching the production layout. The test never launches the installed exe.
    $dataDir = Join-Path $testRoot 'LocalAppData Delo'
    New-Item -ItemType Directory -Path $dataDir | Out-Null
    $tasksPath = Join-Path $dataDir 'tasks.json'
    [IO.File]::WriteAllText($tasksPath, '{"tasks":[{"id":"preserve-me","title":"My saved task"}],"settings":{"autostart":true}}')
    $tasksHash = (Get-FileHash -LiteralPath $tasksPath -Algorithm SHA256).Hash

    Set-TestStartup $null
    Invoke-TestSetup 'initial-install' $installDir
    $installed = $true
    Assert-Test (Test-Path -LiteralPath (Join-Path $installDir 'Delo.exe')) 'Selected installation directory is used'
    Assert-Test ((Read-RegistryValue $runKey 'Delo') -eq '<missing>') 'Fresh install does not enable autostart'

    $installedCommand = '"' + (Join-Path $installDir 'Delo.exe') + '"'
    Set-TestStartup '"C:\Old dev folder\bin\Delo.exe"'
    Invoke-TestSetup 'stale-quoted-path'
    Assert-Test ((Read-RegistryValue $runKey 'Delo') -ceq "String|$installedCommand") 'Stale quoted development path points to installed Delo'
    Assert-Test (-not (Test-Path -LiteralPath $defaultDir)) 'Update without /DIR reuses the previous installation directory'

    $disabledBytes = [byte[]]@(3, 0, 0, 0, 17, 34, 51, 68, 85, 102, 119, 136)
    $keyHandle = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($approvedKey)
    try { $keyHandle.SetValue('Delo', $disabledBytes, [Microsoft.Win32.RegistryValueKind]::Binary) }
    finally { $keyHandle.Dispose() }
    $disabledState = Read-RegistryValue $approvedKey 'Delo'
    Set-TestStartup '  C:\Old dev folder\bin\DELO.EXE --startup "with spaces"  '
    Invoke-TestSetup 'legacy-unquoted-disabled'
    Assert-Test ((Read-RegistryValue $runKey 'Delo') -ceq "String|$installedCommand --startup `"with spaces`"") 'Legacy path is quoted and startup arguments are preserved'
    Assert-Test ((Read-RegistryValue $approvedKey 'Delo') -ceq $disabledState) 'Existing StartupApproved disabled bytes are unchanged'

    Set-TestStartup $null
    Invoke-TestSetup 'autostart-off'
    Assert-Test ((Read-RegistryValue $runKey 'Delo') -eq '<missing>') 'Update preserves autostart off'
    Assert-Test ((Read-RegistryValue $approvedKey 'Delo') -ceq $disabledState) 'Update with autostart off preserves StartupApproved'

    foreach ($command in @('"C:\Other app\Other.exe" "C:\Delo.exe"', '"C:\Old folder\Delo.exe', '"C:\Old folder\Delo.exe"junk')) {
        Set-TestStartup $command
        Invoke-TestSetup "unowned-or-invalid-$checks"
        Assert-Test ((Read-RegistryValue $runKey 'Delo') -ceq "String|$command") 'Unrelated or malformed Run command remains unchanged'
    }

    Assert-Test ((Get-FileHash -LiteralPath $tasksPath -Algorithm SHA256).Hash -ceq $tasksHash) 'Separate task data is unchanged after repeated updates'
    Assert-Test ((Read-RegistryValue $productionRunKey 'Delo') -ceq $productionRun) 'Production Delo Run entry is unchanged'
    Assert-Test ((Read-RegistryValue $productionApprovedKey 'Delo') -ceq $productionApproved) 'Production Delo StartupApproved entry is unchanged'
} catch {
    Write-Host "FAIL $($_.Exception.Message)"
    throw
} finally {
    if (-not $KeepInstallation) {
        try {
            if ($installed) {
                Wait-TestUninstallerFiles
                $process = Start-Process -FilePath $uninstallPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$testRoot\uninstall.log`"") -WindowStyle Hidden -Wait -PassThru
                if ($process.ExitCode -ne 0) { throw "Isolated uninstall failed: $($process.ExitCode)" }
                Assert-Test (-not (Test-Path -LiteralPath (Join-Path $installDir 'Delo.exe'))) 'Isolated test application was uninstalled'
                Assert-Test ((Get-FileHash -LiteralPath $tasksPath -Algorithm SHA256).Hash -ceq $tasksHash) 'Separate task data survives uninstall'
            }
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($testRegistry, $false)
            Assert-Test ((Read-RegistryValue $runKey 'Delo') -eq '<missing>') 'Isolated test registry entries were removed'
        } catch {
            $cleanupFailure = $_.Exception.Message
            Write-Warning "$cleanupFailure; test artifacts retained at $testRoot"
        }
    }
    Assert-Test ((Read-RegistryValue $productionRunKey 'Delo') -ceq $productionRun) 'Production Run entry remains unchanged after cleanup'
    Assert-Test ((Read-RegistryValue $productionApprovedKey 'Delo') -ceq $productionApproved) 'Production StartupApproved remains unchanged after cleanup'
}

if ($cleanupFailure) { throw $cleanupFailure }
Write-Host "$checks installer checks passed. Logs: $testRoot"
