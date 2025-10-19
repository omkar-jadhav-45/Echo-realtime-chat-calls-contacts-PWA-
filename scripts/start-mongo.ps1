Param(
  [string]$DataDir = "",
  [int]$Port = 27017,
  [string]$DockerContainer = "echo-mongo",
  [string]$DockerImage = "mongo:6"
)

$ErrorActionPreference = 'SilentlyContinue'

function Start-MongoService {
  $serviceNames = @('MongoDB', 'mongodb', 'MongoDB Server')
  foreach ($name in $serviceNames) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($null -ne $svc) {
      if ($svc.Status -ne 'Running') {
        try {
          Start-Service -Name $name -ErrorAction Stop
          Write-Host "Started MongoDB service '$name'."
        } catch {
          Write-Host "Could not start MongoDB service '$name' (permission or not installed). Continuing..."
        }
      } else {
        Write-Host "MongoDB service '$name' already running."
      }
      return $true
    }
  }
  return $false
}

function Find-MongodPath {
  $cmd = Get-Command mongod -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    'C:\\Program Files\\MongoDB\\Server',
    'C:\\Program Files (x86)\\MongoDB\\Server'
  )
  foreach ($base in $candidates) {
    if (Test-Path $base) {
      $dirs = Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
      foreach ($d in $dirs) {
        $p = Join-Path $d.FullName 'bin\\mongod.exe'
        if (Test-Path $p) { return $p }
      }
    }
  }
  return $null
}

function Start-MongodLocal {
  Param([string]$BinPath, [string]$Dir, [int]$Port)
  try {
    if (-not $Dir -or $Dir -eq "") {
      $Dir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) '.data\\mongo'
    }
    if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $root = Resolve-Path (Join-Path $PSScriptRoot '..')
    $pidFile = Join-Path $root '.mongo-dev.pid'
    $logFile = Join-Path $root '.mongo-dev.log'
    $args = @('--dbpath', $Dir, '--port', $Port, '--bind_ip', '127.0.0.1')
    $p = Start-Process -FilePath $BinPath -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile
    if ($p -and $p.Id) {
      Set-Content -Path $pidFile -Value $p.Id -Encoding Ascii
      Write-Host "Started mongod.exe (PID $($p.Id)) on 127.0.0.1:$Port using data dir '$Dir'"
      return $true
    }
  } catch {
    Write-Host "Failed to start mongod.exe locally: $($_.Exception.Message)"
  }
  return $false
}

function Start-MongoDocker {
  Param([string]$Container, [string]$Image, [int]$Port)
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) { return $false }
  try {
    $exists = (docker ps -a --filter "name=$Container" --format "{{.Names}}" | Select-Object -First 1)
    if ($exists) {
      docker start $Container | Out-Null
      Write-Host "Started existing Docker container '$Container'"
      return $true
    } else {
      docker run -d --name $Container -p "$Port:27017" -v ${Container}-data:/data/db $Image | Out-Null
      Write-Host "Started new Docker container '$Container' with image '$Image' on 127.0.0.1:$Port"
      return $true
    }
  } catch {
    Write-Host "Failed to start MongoDB Docker container: $($_.Exception.Message)"
  }
  return $false
}

# 1) Try Windows service
if (Start-MongoService) { exit 0 }
Write-Host 'MongoDB service not found; trying local mongod.exe...'

# 2) Try local mongod.exe
$mongod = Find-MongodPath
if ($mongod) {
  if (Start-MongodLocal -BinPath $mongod -Dir $DataDir -Port $Port) { exit 0 }
} else {
  Write-Host 'mongod.exe not found on PATH or in common locations.'
}

# 3) Try Docker
Write-Host 'Trying Docker to run MongoDB...'
if (Start-MongoDocker -Container $DockerContainer -Image $DockerImage -Port $Port) { exit 0 }

Write-Host 'MongoDB could not be started automatically. Please install MongoDB Community Server, use MongoDB Atlas, or install Docker Desktop.'
exit 0
