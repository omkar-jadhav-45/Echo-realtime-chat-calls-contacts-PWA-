Param(
  [string]$ServerUrl = "http://localhost:3000",
  [string]$AuthUrl = "http://localhost:8080"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "Checking services..." -ForegroundColor Cyan

function Test-Endpoint {
  Param([string]$Url, [string]$Method = 'GET', [object]$Body = $null)
  try {
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 5
      $resp = Invoke-RestMethod -Uri $Url -Method $Method -ContentType 'application/json' -Body $json
    } else {
      $resp = Invoke-RestMethod -Uri $Url -Method $Method
    }
    return @{ ok = $true; data = $resp }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

$authHealth = Test-Endpoint -Url "$AuthUrl/health"
if ($authHealth.ok) { Write-Host "AUTH OK:" ($authHealth.data | ConvertTo-Json -Compress) -ForegroundColor Green } else { Write-Host "AUTH ERR:" $authHealth.error -ForegroundColor Red }

$serverRoot = Test-Endpoint -Url $ServerUrl
if ($serverRoot.ok) { Write-Host "SERVER OK:" ($serverRoot.data | ConvertTo-Json -Compress) -ForegroundColor Green } else { Write-Host "SERVER ERR:" $serverRoot.error -ForegroundColor Red }

# Try login and a protected contacts call
$login = Test-Endpoint -Url "$ServerUrl/auth/login" -Method 'POST' -Body @{ userId = "health-user"; name = "Health" }
if (-not $login.ok) {
  Write-Host "LOGIN ERR:" $login.error -ForegroundColor Red
  exit 1
}
$token = $login.data.token
if (-not $token) {
  Write-Host "LOGIN ERR: no token returned" -ForegroundColor Red
  exit 1
}

try {
  $headers = @{ Authorization = "Bearer $token" }
  $contactsResp = Invoke-RestMethod -Uri "$ServerUrl/contacts?ownerId=health-user" -Method GET -Headers $headers
  Write-Host "CONTACTS OK:" ($contactsResp | ConvertTo-Json -Compress) -ForegroundColor Green
} catch {
  Write-Host "CONTACTS ERR:" $_.Exception.Message -ForegroundColor Red
  exit 1
}

Write-Host "Health checks complete." -ForegroundColor Cyan
