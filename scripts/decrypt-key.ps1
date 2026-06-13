$encryptedBase64 = "djEwQWZgzW4+nmEDCXF6j8jkSmkn6Iy1lmOKGtg71SlMyanALvONz259DoTJ0HUs7o8J9QacZfp/5XwijS69qkYq"

$allBytes = [Convert]::FromBase64String($encryptedBase64)

# v10 prefix is exactly 3 bytes: 0x76 ('v'), 0x31 ('1'), 0x30 ('0')
$cipherBytes = $allBytes[3..($allBytes.Length - 1)]

Write-Output "Cipher bytes length: $($cipherBytes.Length)"
Write-Output "First 16 cipher bytes (hex): $([BitConverter]::ToString($cipherBytes[0..15]))"

Add-Type -AssemblyName System.Security

# Try different scopes
$scopes = @(
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
)

foreach ($scope in $scopes) {
    try {
        $decryptedBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($cipherBytes, $null, $scope)
        $key = [System.Text.Encoding]::UTF8.GetString($decryptedBytes)
        Write-Output "SUCCESS (scope=$scope): API Key = $key"
    } catch {
        Write-Output "Failed (scope=$scope): $_"
    }
}

# Also try with entropy = empty byte array
foreach ($scope in $scopes) {
    try {
        $decryptedBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($cipherBytes, [byte[]]@(), $scope)
        $key = [System.Text.Encoding]::UTF8.GetString($decryptedBytes)
        Write-Output "SUCCESS with empty entropy (scope=$scope): $key"
    } catch {
        Write-Output "Failed with empty entropy (scope=$scope): $_"
    }
}
