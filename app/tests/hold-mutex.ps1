param(
    [string]$Name = 'Local\Delo.Widget'
)

$created = $false
$mutex = [System.Threading.Mutex]::new($true, $Name, [ref]$created)
if (-not $created) {
    throw "Mutex is already held: $Name"
}

try {
    Write-Output "READY $Name"
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
