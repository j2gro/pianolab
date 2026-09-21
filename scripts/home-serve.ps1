#Requires -Version 5.1
param(
  [switch]$SkipBuild,
  [switch]$Http,
  [switch]$RenewCerts
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Get-LanIPv4 {
  @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*"
      } |
      Select-Object -ExpandProperty IPAddress -Unique
  )
}

function Ensure-EnvFile {
  $envPath = Join-Path $RepoRoot ".env"
  if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $RepoRoot ".env.example") $envPath
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $raw = Get-Content $envPath -Raw
    $raw = $raw -replace "SESSION_SECRET=replace-me", "SESSION_SECRET=$secret"
    Set-Content -Path $envPath -Value $raw -NoNewline
    Write-Host "Created .env with a new SESSION_SECRET."
  }
  return $envPath
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is not on PATH. Install Node.js 20+ and reopen the terminal."
}

Ensure-EnvFile | Out-Null

if (-not $SkipBuild) {
  Write-Host "Building web app..."
  npm run build -w @pianolab/web
  if ($LASTEXITCODE -ne 0) {
    throw "web build failed"
  }
}

$cert = Join-Path $RepoRoot "certs\lan.pem"
$key = Join-Path $RepoRoot "certs\lan-key.pem"
$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
$useTls = -not $Http

if ($useTls -and ($RenewCerts -or -not (Test-Path $cert) -or -not (Test-Path $key))) {
  if (-not $mkcert) {
    Write-Warning "mkcert is not installed. Serving HTTP. Other devices will likely block the microphone until you install mkcert and re-run with -RenewCerts."
    $useTls = $false
  } else {
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "certs") | Out-Null
    $names = @("localhost", "127.0.0.1", "::1") + (Get-LanIPv4)
    Write-Host "Issuing certificate for: $($names -join ', ')"
    & mkcert -install
    if ($LASTEXITCODE -ne 0) {
      throw "mkcert -install failed (try an elevated PowerShell once)"
    }
    & mkcert -cert-file $cert -key-file $key @names
    if ($LASTEXITCODE -ne 0) {
      throw "mkcert failed"
    }
    $caRoot = & mkcert -CAROOT
    $caPem = Join-Path $caRoot "rootCA.pem"
    if (Test-Path $caPem) {
      Copy-Item $caPem (Join-Path $RepoRoot "certs\pianolab-rootCA.pem") -Force
      Write-Host "Copied LAN trust cert to certs\pianolab-rootCA.pem (install this on other devices)."
    }
  }
}

$env:STATIC_DIR = "apps/web/dist"
$env:HOST = "0.0.0.0"

if ($useTls -and (Test-Path $cert) -and (Test-Path $key)) {
  $env:TLS_CERT = "certs/lan.pem"
  $env:TLS_KEY = "certs/lan-key.pem"
  $env:PORT = "8443"
} else {
  Remove-Item Env:TLS_CERT -ErrorAction SilentlyContinue
  Remove-Item Env:TLS_KEY -ErrorAction SilentlyContinue
  $env:TLS_CERT = ""
  $env:TLS_KEY = ""
  $env:PORT = "8080"
}

Write-Host "Starting Pianolab on port $($env:PORT). Allow inbound TCP $($env:PORT) in Windows Firewall if other devices cannot connect."
npm run start -w @pianolab/api
if ($LASTEXITCODE -ne 0) {
  throw "api failed to start"
}
