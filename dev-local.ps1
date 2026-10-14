# dev-local.ps1 — Sobe API (:3002) + Admin (:3000) em modo dev, NA MESMA console.
# Uso:  powershell -ExecutionPolicy Bypass -File .\dev-local.ps1 [-Force] [-RunForSeconds 0]
# - Logs dos dois processos aparecem aqui intercalados ([API]/[ADMIN]).
# - Ctrl+C encerra TUDO (arvores de processo via taskkill /T).
# - -Force mata ocupantes previos das portas 3000/3002 antes de subir.
# - -RunForSeconds N desliga sozinho apos N segundos (util p/ teste/CI).
# NOTA: arquivo 100% ASCII de proposito (PS 5.1 sem BOM quebra com acentos).

param(
  [switch]$Force,
  [int]$RunForSeconds = 0
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Info($m) { Write-Host "[dev-local] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[dev-local] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[dev-local] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[dev-local] ERRO: $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'node nao encontrado no PATH (pnpm precisa dele).'
}

function Free-Port($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  return $conn
}

foreach ($port in @(3000, 3002)) {
  $occ = Free-Port $port
  if ($occ) {
    if ($Force) {
      Warn ("Porta " + $port + " ocupada (pid " + $occ.OwningProcess + ") - matando (-Force)...")
      taskkill /pid $occ.OwningProcess /T /F 2>$null | Out-Null
      Start-Sleep -Seconds 2
      if (Free-Port $port) { Fail ("Porta " + $port + " continua ocupada. Libere manualmente.") }
    } else {
      Fail ("Porta " + $port + " ocupada (pid " + $occ.OwningProcess + "). Rode com -Force ou libere a porta.")
    }
  }
}

if (-not (Test-Path (Join-Path $Root 'apps\api\.env'))) {
  Warn 'apps\api\.env ausente - a API vai falhar no fail-fast de env (ver docs).'
}
if (-not (Test-Path (Join-Path $Root 'apps\admin\.env.local'))) {
  Warn 'apps\admin\.env.local ausente - o admin sobe sem API_INTERNAL_URL (modo mock).'
}

$children = @()

function Resolve-Pnpm() {
  # pnpm nesta maquina e um .ps1 (C:\Program Files\nodejs\pnpm.ps1), que o
  # Process nao executa direto. Roda via node + corepack/pnpm.js.
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd -and $nodeCmd.Source -match '\.exe$') {
    $js = Join-Path (Split-Path $nodeCmd.Source -Parent) 'node_modules\corepack\dist\pnpm.js'
    if (Test-Path $js) { return @{ File = $nodeCmd.Source; Prefix = "`"$js`"" } }
  }
  return @{ File = 'pnpm'; Prefix = '' }
}

$Pnpm = Resolve-Pnpm

function Start-Child($tag, $arguments, $envVars) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Pnpm.File
  if ($Pnpm.Prefix -ne '') { $psi.Arguments = $Pnpm.Prefix + ' ' + $arguments }
  else { $psi.Arguments = $arguments }
  $psi.WorkingDirectory = $Root
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  foreach ($k in $envVars.Keys) { $psi.Environment[$k] = $envVars[$k] }
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $p.EnableRaisingEvents = $true
  $tagCopy = $tag
  $outAction = {
    param($sender, $e)
    if ($null -ne $e.Data) { Write-Host ("[" + $tagCopy + "] " + $e.Data) }
  }
  Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action $outAction | Out-Null
  Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action $outAction | Out-Null
  if (-not $p.Start()) { throw ("falha ao iniciar " + $tag) }
  $p.BeginOutputReadLine()
  $p.BeginErrorReadLine()
  return $p
}

function Stop-Tree($p, $tag) {
  try {
    if ($p -and -not $p.HasExited) {
      taskkill /pid $p.Id /T /F 2>$null | Out-Null
      $p.WaitForExit(8000) | Out-Null
    }
  } catch { }
  Info ($tag + " encerrado.")
}

function Wait-Http($url, $timeoutSec, $tag) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ($true) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { Ok ($tag + " no ar: " + $url); return $true }
    } catch { }
    if ((Get-Date) -gt $deadline) { Warn ($tag + " nao respondeu - ver logs acima."); return $false }
    Start-Sleep -Seconds 3
  }
}

$stopwatch = [Diagnostics.Stopwatch]::StartNew()
try {
  Info 'Subindo API (:3002)...'
  $api = Start-Child 'API' '--filter @aurum-bit/api start:dev' @{ PORT = '3002' }
  $children += @{ proc = $api; tag = 'API' }
  Info 'Subindo Admin (:3000)...'
  $admin = Start-Child 'ADMIN' '--filter @aurum/admin dev' @{}
  $children += @{ proc = $admin; tag = 'ADMIN' }

  Wait-Http 'http://localhost:3002/health/live' 120 'API' | Out-Null
  Wait-Http 'http://localhost:3000/login' 120 'Admin' | Out-Null
  Write-Host ''
  Ok 'Tudo no ar. Logs abaixo ([API]/[ADMIN]). Ctrl+C para encerrar tudo.'
  Write-Host ''

  while ($true) {
    if ($RunForSeconds -gt 0 -and $stopwatch.Elapsed.TotalSeconds -ge $RunForSeconds) {
      Info ("Tempo esgotado (" + $RunForSeconds + " s) - encerrando.")
      break
    }
    foreach ($c in $children) {
      if ($c.proc.HasExited) { Fail ($c.tag + " morreu. Ver logs acima.") }
    }
    Start-Sleep -Milliseconds 500
  }
}
finally {
  foreach ($c in $children) { Stop-Tree $c.proc $c.tag }
  Get-EventSubscriber | Where-Object { $_.SourceObject -is [Diagnostics.Process] } | Unregister-Event
  Info 'Ambiente local encerrado.'
}
