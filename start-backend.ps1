# start-backend.ps1 — Sobe o backend Aurum Bit de forma simplificada (Windows).
# Uso:  powershell -ExecutionPolicy Bypass -File .\start-backend.ps1 [-Tunnel] [-SkipSeed]
# Segredos nunca sao exibidos no console.

param(
  [switch]$Tunnel,
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$ComposeFile = Join-Path $Root 'deploy/docker-compose.yml'

function Info($m)  { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m)  { Write-Host "[AVISO] $m" -ForegroundColor Yellow }
function Fail($m)  { Write-Host "[ERRO] $m" -ForegroundColor Red; exit 1 }

function Masked($name, $value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "$name=<ausente>" }
  if ($value -eq 'changeme') { return "$name=changeme (pendente)" }
  return "$name=<definida: $($value.Length) chars>"
}

# ---------------------------------------------------------------------------
# Painel de terminal (tamanho fixo): banner + 1 linha por servico + caixa de log.
# O bloco ocupa sempre o mesmo numero de linhas; nada "pula" na tela.
# ---------------------------------------------------------------------------
$Board = @{
  Active   = $false
  Top      = 0
  Width    = 100
  Services = @('postgres', 'redis', 'mailhog', 'api', 'workers', 'admin')
  Status   = @{}
  Logs     = @()
  LogSize  = 8
}

$BannerLines = @(
  '   ___   _   ____  ____  __  ___   ___   ____  _____',
  '  / _ | / | / / / / / / /  |/  /  / _ | / __ \/ ___/',
  ' / __ |/ |/ / /_/ / /_/ / /|_/ /  / __ |/ /_/ / /__  ',
  '/_/ |_|___|\____/\____/_/  /_/  /_/ |_|\____/\___/  ',
  '          S O F T W A R E  -  B A C K E N D',
  '          Aurum Bit · Produtos, Licencas e Cobrancas'
)

function Board-CanUse() {
  try { return ($Host.Name -ne 'ServerRemoteHost') -and ([Console]::WindowWidth -ge 80) }
  catch { return $false }
}

function Board-Pad($s, $w) {
  $s = [string]$s
  if ($s.Length -gt $w) { return $s.Substring(0, $w) }
  return $s.PadRight($w)
}

function Board-WriteAt($row, $text, $color) {
  try {
    [Console]::SetCursorPosition(0, $row)
    if ($color) { Write-Host (Board-Pad $text $Board.Width) -ForegroundColor $color -NoNewline }
    else { Write-Host (Board-Pad $text $Board.Width) -NoNewline }
  } catch { }
}

function Initialize-Board() {
  if (-not (Board-CanUse)) { return }
  $w = [Console]::WindowWidth - 1
  if ($w -gt 110) { $w = 110 }
  if ($w -lt 80) { $w = 80 }
  $Board.Width = $w
  foreach ($s in $Board.Services) { $Board.Status[$s] = @{ st = 'aguardando'; detail = '-' } }
  $Board.Logs = @()
  Clear-Host
  $total = $BannerLines.Count + 1 + 1 + $Board.Services.Count + 1 + ($Board.LogSize + 2) + 1
  for ($i = 0; $i -lt $total; $i++) { Write-Host '' }
  $Board.Top = [Console]::CursorTop - $total
  $Board.Active = $true
  Redraw-Board
}

function Redraw-Board() {
  if (-not $Board.Active) { return }
  $r = $Board.Top
  foreach ($l in $BannerLines) { Board-WriteAt $r $l 'Yellow'; $r++ }
  Board-WriteAt $r ''; $r++
  Board-WriteAt $r '  SERVICO     STATUS      DETALHE' 'Cyan'; $r++
  foreach ($s in $Board.Services) {
    $st = $Board.Status[$s].st
    $dt = $Board.Status[$s].detail
    $color = 'Gray'
    if ($st -eq 'saudavel' -or $st -eq 'no ar' -or $st -eq 'ok') { $color = 'Green' }
    elseif ($st -eq 'subindo' -or $st -eq 'build') { $color = 'Yellow' }
    elseif ($st -eq 'falha' -or $st -eq 'fora') { $color = 'Red' }
    Board-WriteAt $r ('  ' + (Board-Pad $s 12) + (Board-Pad "[$st]" 13) + $dt) $color
    $r++
  }
  Board-WriteAt $r ''; $r++
  Board-WriteAt $r ('+-- logs ' + ('-' * ($Board.Width - 10)) + '+'); $r++
  $logs = @($Board.Logs | Select-Object -Last $Board.LogSize)
  for ($i = 0; $i -lt $Board.LogSize; $i++) {
    $line = ''
    if ($i -lt $logs.Count) { $line = $logs[$i] }
    Board-WriteAt $r ('| ' + (Board-Pad $line ($Board.Width - 4)) + ' |')
    $r++
  }
  Board-WriteAt $r ('+' + ('-' * ($Board.Width - 2)) + '+'); $r++
  try { [Console]::SetCursorPosition(0, $r) } catch { }
}

function Set-ServiceStatus($name, $st, $detail) {
  if ($Board.Status.ContainsKey($name)) {
    $Board.Status[$name] = @{ st = $st; detail = [string]$detail }
  }
  if ($Board.Active) { Redraw-Board } else { Info "$name -> $st ($detail)" }
}

function Write-BoardLog($m) {
  $m = ([string]$m).Trim()
  if ($m.Length -gt ($Board.Width - 4)) { $m = $m.Substring(0, ($Board.Width - 7)) + '...' }
  $Board.Logs += $m
  if ($Board.Logs.Count -gt 64) { $Board.Logs = @($Board.Logs | Select-Object -Last 32) }
  if ($Board.Active) { Redraw-Board } else { Write-Host $m }
}

function Close-Board($finalMsg) {
  if ($Board.Active) {
    Redraw-Board
    try { [Console]::SetCursorPosition(0, ($Board.Top + $BannerLines.Count + 1 + 1 + $Board.Services.Count + 1 + $Board.LogSize + 2 + 1)) } catch { }
    Write-Host ''
  }
  if ($finalMsg) { Ok $finalMsg }
}

function Refresh-BoardFromCompose() {
  try {
    $out = docker compose -f $ComposeFile ps --format '{{.Name}} {{.Status}}' 2>$null
  } catch { return }
  foreach ($line in $out) {
    # Nome canônico pedido pelo dono: container `Aurum_Bit_Backend` = serviço `api`.
    # Imagem correspondente (minúscula, exigência do Docker): `aurum_bit_backend:local`.
    if ($line -match 'Aurum_Bit_Backend\s+(.*)') {
      $svc = 'api'; $status = $Matches[1]
      $st = 'subindo'; $color = $status
      if ($status -match '\(healthy\)|healthy') { $st = 'saudavel' }
      elseif ($status -match '\(health: starting\)|Starting|Restarting') { $st = 'subindo' }
      elseif ($status -match 'Exited|failed|unhealthy') { $st = 'falha' }
      elseif ($status -match 'Up') { $st = 'no ar' }
      Set-ServiceStatus $svc $st $status
    }
    elseif ($line -match 'aurum-(\S+)\s+(.*)') {
      $svc = $Matches[1]; $status = $Matches[2]
      $st = 'subindo'; $color = $status
      if ($status -match '\(healthy\)|healthy') { $st = 'saudavel' }
      elseif ($status -match '\(health: starting\)|Starting|Restarting') { $st = 'subindo' }
      elseif ($status -match 'Exited|failed|unhealthy') { $st = 'falha' }
      elseif ($status -match 'Up') { $st = 'no ar' }
      Set-ServiceStatus $svc $st $status
    }
  }
}

# 1) Docker Desktop ligado?
Info 'Verificando Docker...'
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  $dd = Join-Path $Env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $dd)) { Fail "Docker Desktop nao encontrado em $dd" }
  Info 'Iniciando Docker Desktop (aguarde ate 3 min)...'
  Start-Process $dd
  $up = $false
  for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $up = $true; break }
  }
  if (-not $up) { Fail 'Daemon Docker nao respondeu. Abra o Docker Desktop manualmente.' }
}
Ok 'Docker OK.'

# 2) .env
$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) {
  Info 'Criando .env a partir de .env.example...'
  Copy-Item (Join-Path $Root '.env.example') $envFile
}

function Ensure-Var($name, $value) {
  $cur = Get-Content $envFile -Raw
  if ($cur -match "(?m)^$name=") { return $false }
  Add-Content $envFile "`n$name=$value"
  return $true
}

if (Ensure-Var 'JWT_SECRET' ((node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim())) {
  Info 'JWT_SECRET gerado.'
}
if (Ensure-Var 'DATABASE_URL' 'postgresql://aurum:aurum@localhost:5432/auth') {
  Info 'DATABASE_URL adicionado.'
}

# Escapa $ da ASAAS_API_KEY para o Compose (idempotente: $$ nao vira $$$).
$lines = Get-Content $envFile
$changed = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^ASAAS_API_KEY=(.*)$') {
    $v = $Matches[1]
    $esc = $v -replace '(?<!\$)\$(?!\$)', '$$$$'
    if ($esc -ne $v) { $lines[$i] = "ASAAS_API_KEY=$esc"; $changed = $true }
  }
}
if ($changed) { Set-Content $envFile $lines; Info 'ASAAS_API_KEY escapada para o Compose ($ -> $$).' }

# Resumo sem expor segredos
$envMap = @{}
foreach ($l in (Get-Content $envFile)) {
  if ($l -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $envMap[$Matches[1]] = $Matches[2] }
}
Info (Masked 'ASAAS_API_KEY' $envMap['ASAAS_API_KEY'])
Info (Masked 'JWT_SECRET' $envMap['JWT_SECRET'])
if ($envMap['ASAAS_WEBHOOK_SECRET'] -eq 'changeme' -or [string]::IsNullOrWhiteSpace($envMap['ASAAS_WEBHOOK_SECRET'])) {
  Warn 'ASAAS_WEBHOOK_SECRET pendente: pegue o token na aba Webhooks do Asaas Sandbox.'
}
if ($envMap['RESEND_API_KEY'] -eq 'changeme') {
  Warn 'RESEND_API_KEY=changeme: envio de e-mail real fica desabilitado (ok p/ testes locais).'
}

# 3) Subir stack (build transmite log normal; painel assume no monitoramento)
Info 'Subindo stack (build pode levar alguns minutos na 1a vez)...'
foreach ($s in $Board.Services) { $Board.Status[$s] = @{ st = 'build'; detail = 'construindo/subindo' } }
docker compose -f $ComposeFile up --build -d
if ($LASTEXITCODE -ne 0) {
  Warn 'Falha no up completo. Tentando nucleo sem admin...'
  docker compose -f $ComposeFile up --build -d postgres redis mailhog api workers
  if ($LASTEXITCODE -ne 0) { Fail 'Nucleo tambem falhou. Veja as mensagens acima.' }
  Warn 'Admin ficou de fora. API/workers/infra no ar.'
  $Board.Status['admin'] = @{ st = 'fora'; detail = 'build falhou' }
} else {
  Ok 'Containers criados.'
}

# 4) Monitoramento em painel fixo
Initialize-Board
Write-BoardLog 'Monitorando subida dos servicos...'
Refresh-BoardFromCompose

Info 'Aguardando API (/health/live)...'
$live = $false
for ($i = 0; $i -lt 36; $i++) {
  Refresh-BoardFromCompose
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/health/live' -TimeoutSec 5 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $live = $true; break }
  } catch { }
  Write-BoardLog "aguardando API... tentativa $($i + 1)/36"
  Start-Sleep -Seconds 5
}
if (-not $live) {
  Close-Board ''
  Fail 'API nao respondeu /health/live em ~3 min. Rode: docker compose -f deploy/docker-compose.yml logs api'
}
Set-ServiceStatus 'api' 'no ar' '/health/live 200'
Write-BoardLog 'API viva: /health/live 200.'
try {
  $ready = Invoke-WebRequest -Uri 'http://localhost:3000/health/ready' -TimeoutSec 10 -UseBasicParsing
  Write-BoardLog "/health/ready -> $($ready.StatusCode) $($ready.Content)"
  if ($ready.StatusCode -eq 200) { Set-ServiceStatus 'api' 'saudavel' 'live 200 + ready 200' }
} catch {
  Write-BoardLog '/health/ready ainda nao 200 (normal antes do migrate/seed).'
}

# 5) Migrate + seed com logs contidos no bloco
if (-not $SkipSeed) {
  # `bash` do PATH pode ser o do WSL (instável aqui): prefere o Git Bash.
  # Via `cmd /c` com saída em arquivo: stderr nativo nunca vaza vermelho no PS.
  function Find-Bash() {
    $candidates = @(
      'C:\Program Files\Git\bin\bash.exe',
      'C:\Program Files (x86)\Git\bin\bash.exe'
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    $b = Get-Command bash -ErrorAction SilentlyContinue
    if ($null -ne $b) { return $b.Source }
    return $null
  }
  $bashExe = Find-Bash
  if ($null -eq $bashExe) { Write-BoardLog 'bash ausente: pulei migrate/seed (rode no Git Bash).' }
  else {
    # Sem pipe direto: stderr do bash vira ErrorRecord vermelho no PS.
    # Captura em arquivo e joga no bloco de log (tamanho fixo).
    $stepLog = Join-Path ([IO.Path]::GetTempPath()) 'aurum-step.log'
    Write-BoardLog 'migrate-all.sh: iniciando (9 dominios)...'
    # .env DEV usa roles de app (sem DDL): o migrate precisa do role `migrator`
    # (ver MIGRATE_AS_MIGRATOR em deploy/scripts/migrate-all.sh).
    $env:MIGRATE_AS_MIGRATOR = '1'
    cmd /c "`"$bashExe`" deploy/scripts/migrate-all.sh > `"$stepLog`" 2>&1"
    $migCode = $LASTEXITCODE
    Get-Content $stepLog | ForEach-Object { Write-BoardLog ([string]$_) }
    if ($migCode -ne 0) { Write-BoardLog "migrate-all.sh FALHOU (exit $migCode, ver log acima)." }
    else { Write-BoardLog 'migrate-all.sh OK.' }
    Write-BoardLog 'seed-all.sh: iniciando...'
    cmd /c "`"$bashExe`" deploy/scripts/seed-all.sh > `"$stepLog`" 2>&1"
    $seedCode = $LASTEXITCODE
    Get-Content $stepLog | ForEach-Object { Write-BoardLog ([string]$_) }
    if ($seedCode -ne 0) { Write-BoardLog "seed-all.sh falhou (exit $seedCode, stub Fase 1)." }
    else { Write-BoardLog 'seed-all.sh OK.' }
    try {
      $ready2 = Invoke-WebRequest -Uri 'http://localhost:3000/health/ready' -TimeoutSec 10 -UseBasicParsing
      Write-BoardLog "/health/ready pos-seed -> $($ready2.StatusCode)"
    } catch { Write-BoardLog '/health/ready pos-seed indisponivel.' }
  }
}

Refresh-BoardFromCompose
Close-Board 'Backend no ar.'

# 6) Resumo final fora do painel
docker compose -f $ComposeFile ps
Write-Host ''
Write-Host 'Servicos:' -ForegroundColor Cyan
Write-Host '  API     http://localhost:3000/v1  (/health/live, /health/ready, /metrics)'
Write-Host '  Admin   http://localhost:3001'
Write-Host '  Mailhog http://localhost:8025'
Write-Host '  Postgres localhost:5432 (aurumbit, 9 schemas) + PgBouncer :6432 | Redis localhost:6379'

# 7) Tunel opcional p/ webhook Asaas
if ($Tunnel) {
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($null -eq $cf) { Warn 'cloudflared nao instalado: pulei o tunel.' }
  else {
    Info 'Abrindo tunel cloudflared p/ :3000 em nova janela...'
    Start-Process cloudflared -ArgumentList 'tunnel --url http://localhost:3000'
    Write-Host 'Cadastre no Asaas (aba Webhooks): <url-do-tunel>/v1/billing/webhooks/asaas' -ForegroundColor Cyan
  }
}
