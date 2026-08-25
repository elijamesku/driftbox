# Kill all processes using port 3000
Write-Host "Checking for processes on port 3000..." -ForegroundColor Yellow

$processes = netstat -ano | Select-String ":3000" | ForEach-Object {
    $parts = $_ -split '\s+'
    $processId = $parts[-1]
    if ($processId -match '^\d+$' -and $processId -ne '0') {
        $processId
    }
} | Sort-Object -Unique

if ($processes.Count -eq 0) {
    Write-Host "No processes found on port 3000" -ForegroundColor Green
    exit 0
}

foreach ($processId in $processes) {
    try {
        taskkill /PID $processId /F 2>$null | Out-Null
        Write-Host "Killed process $processId" -ForegroundColor Green
    } catch {
        Write-Host "Could not kill process $processId" -ForegroundColor Red
    }
}

Write-Host "Port 3000 is now clear!" -ForegroundColor Green

