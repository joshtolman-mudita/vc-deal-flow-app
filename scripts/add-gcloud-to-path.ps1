# Add Google Cloud SDK to PATH for current session
# Run this if gcloud commands are not recognized

$gcloudPath = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"

if (Test-Path $gcloudPath) {
    $env:Path += ";$gcloudPath"
    Write-Host "Success: Google Cloud SDK added to PATH for this session" -ForegroundColor Green
    Write-Host "Location: $gcloudPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To add permanently to your user PATH:" -ForegroundColor Yellow
    Write-Host "1. Open System Properties > Environment Variables" -ForegroundColor Gray
    Write-Host "2. Edit your user PATH variable" -ForegroundColor Gray
    Write-Host "3. Add this path: $gcloudPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Or run this command in an elevated PowerShell:" -ForegroundColor Yellow
    Write-Host '[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Users\jtolm\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin", "User")' -ForegroundColor Gray
} else {
    Write-Host "Error: Google Cloud SDK not found at: $gcloudPath" -ForegroundColor Red
    Write-Host "Please install from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
}
