$cookiePath = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Network\Cookies"
$tempPath = "$env:TEMP\edge_cookies_copy.db"

try {
    [System.IO.File]::Copy($cookiePath, $tempPath, $true)
    Write-Output "Copy succeeded: $tempPath"
} catch {
    Write-Output "Copy failed: $_"
}
