[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$keyPath = Join-Path $projectRoot ".local-signing.key"

if (-not (Test-Path -LiteralPath $keyPath)) {
  throw "Local signing key not found: $keyPath"
}

function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

Set-Location $projectRoot

# The signer writes this file as the base64-encoded Minisign key format expected by build.rs.
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $keyPath -Raw).Trim()

$securePassword = Read-Host "Local signing-key password" -AsSecureString
$passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)

  Invoke-Checked { cargo build --release -p sluhk }
  Invoke-Checked { npm run tauri build }
} finally {
  if ($passwordBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  }

  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
