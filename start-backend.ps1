# start-backend.ps1 - Sobe TUDO de uma vez: LANDPAGE + ADM + BACKEND COMPLETO.
#
# Uso:  powershell -ExecutionPolicy Bypass -File .\start-backend.ps1
#         [-NoPortal] [-NoWatch] [-SkipSeed] [-Tunnel] [-WatchSeconds N]
#
# O que sobe (docker compose -f deploy/docker-compose.yml):
#   LANDPAGE -> aurum-portal  (:3002)   portal publico + area do cliente
#   ADM      -> aurum-admin   (:3001)   painel administrativo
#   BACKEND  -> Aurum_Bit_Backend (:3000) + aurum-workers +
#               postgres/redis/pgbouncer/mailhog
#
# Ordem de subida (importante): infra (postgres/redis/pgbouncer/mailhog) ->
# migrations/seed -> apps (api/workers/admin/portal). Assim a API nunca roda
# com schema atrasado (era a causa de `column "archivedAt" does not exist`).
#
# O painel mostra OS 3 SERVICOS com status ao vivo E OS LOGS DE CADA UM:
#   - logs vem de `docker compose logs` (um unico comando, separados por painel);
#   - log JSON do pino e compactado (nivel/hora/rota/msg) - so o util aparece;
#   - healthcheck (/health/live 200 do Wget) e silenciado: nao polui;
#   - erro aparece em vermelho, aviso em amarelo.
# Ctrl+C sai do painel e deixa os containers NO AR.
#   Para parar tudo: docker compose -f deploy/docker-compose.yml down
#
# Arquivo 100% ASCII de proposito (PS 5.1 sem BOM quebra com acento no codigo);
# os LOGS dos containers (UTF-8) sao lidos como UTF-8 e aparecem acentuados.
# Segredos nunca sao exibidos no console.

param(
  [switch]$NoPortal,
  [switch]$NoWatch,
  [switch]$SkipSeed,
  [switch]$Tunnel,
  [int]$WatchSeconds = 0
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$ComposeFile = Join-Path $Root 'deploy/docker-compose.yml'

# Logs dos containers sao UTF-8 (pt-BR): sem isto o console mostra "Sess?o".
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

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
# Mapa container -> tag curta usada no log de cada painel.
# O prefixo que o `docker compose logs` imprime e o NOME DO CONTAINER.
# ---------------------------------------------------------------------------
$Tags = @{
  'Aurum_Bit_Backend' = '[api]'
  'aurum-workers'     = '[workers]'
  'aurum-postgres'    = '[pg]'
  'aurum-redis'       = '[redis]'
  'aurum-pgbouncer'   = '[pgb]'
  'aurum-mailhog'     = '[mail]'
  'aurum-admin'       = '[admin]'
  'aurum-portal'      = '[portal]'
}

# ---------------------------------------------------------------------------
# Painel de terminal (tamanho fixo): banner + 1 linha por SERVICO + 1 bloco de
# log por SERVICO. O bloco ocupa sempre o mesmo numero de linhas; nada "pula".
# ---------------------------------------------------------------------------
$BannerBig = @(
  '   ___   _   ____  ____  __  ___   ___   ____  _____',
  '  / _ | / | / / / / / / /  |/  /  / _ | / __ \/ ___/',
  ' / __ |/ |/ / /_/ / /_/ / /|_/ /  / __ |/ /_/ / /__  ',
  '/_/ |_|___|\____/\____/_/  /_/  /_/ |_|\____/\___/  ',
  '          S O F T W A R E  -  B A C K E N D',
  '       LANDPAGE + ADM + BACKEND COMPLETO (dev local)'
)
$BannerSmall = @(
  '  A U R U M   B I T  -  LANDPAGE + ADM + BACKEND COMPLETO',
  '  dev local - Ctrl+C sai do painel (containers continuam no ar)'
)

$Board = @{
  Active     = $false
  Top        = 0
  Width      = 100
  Height     = 30
  LastW      = 0
  LastH      = 0
  PanelLines = 3
  Banner     = @()
  Groups     = @()
  Footer     = ''
  LastPlain  = ''
  Spin       = 0
  Ticker     = 0
  Statuses   = @{}   # servico (compose) -> status normalizado
}

function New-Group {
  param($Key, $Label, $Header, $Url, $Color, $Primary, $Secondary, $Services, $Prefixes, $HttpUrl)
  [pscustomobject]@{
    Key       = $Key
    Label     = $Label
    Header    = $Header
    Url       = $Url
    Color     = $Color
    Primary   = $Primary
    Secondary = $Secondary
    Services  = $Services
    Prefixes  = $Prefixes
    HttpUrl   = $HttpUrl
    HttpOk    = $false
    Status    = 'aguardando'
    Detalhe   = '-'
    Panel     = @()
  }
}

function Status-Color($st) {
  switch ($st) {
    'saudavel' { return 'Green' }
    'no ar'    { return 'Green' }
    'subindo'  { return 'Yellow' }
    'parado'   { return 'DarkYellow' }
    'fora'     { return 'Red' }
    'falha'    { return 'Red' }
    default    { return 'Gray' }
  }
}

function Status-Rank($st) {
  switch ($st) {
    'falha'    { return 0 }
    'fora'     { return 1 }
    'parado'   { return 2 }
    'aguardando' { return 3 }
    'subindo'  { return 3 }
    'no ar'    { return 4 }
    'saudavel' { return 5 }
    default    { return 3 }
  }
}

# ---------------------------------------------------------------------------
# Desenho do painel
# ---------------------------------------------------------------------------
function Board-CanUse() {
  try { return ($Host.Name -ne 'ServerRemoteHost') -and ([Console]::WindowWidth -ge 80) }
  catch { return $false }
}

function Board-Pad($s, $w) {
  $s = [string]$s
  if ($s.Length -gt $w) { return $s.Substring(0, $w) }
  return $s.PadRight($w)
}

function Board-Cut($s, $w) {
  $s = [string]$s
  if ($w -le 3) { return $s }
  if ($s.Length -gt $w) { return $s.Substring(0, $w - 3) + '...' }
  return $s
}

function Board-WriteAt($row, $text, $color) {
  if (-not $Board.Active) { return }
  try {
    [Console]::SetCursorPosition(0, $row)
    if ($color) { Write-Host (Board-Pad $text $Board.Width) -ForegroundColor $color -NoNewline }
    else { Write-Host (Board-Pad $text $Board.Width) -NoNewline }
  } catch { }
}

function Get-BoardTotalRows {
  return $Board.Banner.Count + 2 + $Board.Groups.Count + 1 +
    ($Board.Groups.Count * (1 + $Board.PanelLines)) + 2
}

function Initialize-Board {
  if (-not (Board-CanUse)) { return }
  $h = 30; $w = 100
  try { $h = [Console]::WindowHeight; $w = [Console]::WindowWidth } catch { }
  $Board.Height = $h
  $Board.LastW = $w
  $Board.LastH = $h
  if ($h -ge 34) { $Board.Banner = $BannerBig } else { $Board.Banner = $BannerSmall }
  # Linhas de log por painel: encaixa no que sobra da tela (2 a 6).
  $fixed = $Board.Banner.Count + (2 * $Board.Groups.Count) + 5
  $lines = [int][Math]::Floor(($h - 1 - $fixed) / $Board.Groups.Count)
  if ($lines -lt 2) { $lines = 2 }
  if ($lines -gt 6) { $lines = 6 }
  $Board.PanelLines = $lines
  $bw = $w - 1
  if ($bw -lt 80) { $bw = 80 }
  if ($bw -gt 130) { $bw = 130 }
  $Board.Width = $bw
  try { Clear-Host } catch { }
  $total = Get-BoardTotalRows
  for ($i = 0; $i -lt $total; $i++) { Write-Host '' }
  $top = 0
  try { $top = [Console]::CursorTop - $total } catch { }
  if ($top -lt 0) { $top = 0 }
  $Board.Top = $top
  $Board.Active = $true
  Redraw-Board
}

function Redraw-Board {
  if (-not $Board.Active) { return }
  $r = $Board.Top
  $W = $Board.Width
  foreach ($l in $Board.Banner) { Board-WriteAt $r $l 'DarkYellow'; $r++ }
  Board-WriteAt $r ''; $r++
  Board-WriteAt $r ('  ' + (Board-Pad 'SERVICO' 12) + (Board-Pad 'STATUS' 13) + (Board-Pad 'ENDERECO' 26) + 'DETALHE') 'Cyan'; $r++
  foreach ($g in $Board.Groups) {
    $line = '  ' + (Board-Pad $g.Label 12) + (Board-Pad ('[' + $g.Status + ']') 13) +
      (Board-Pad $g.Url 26) + (Board-Cut $g.Detalhe ($W - 53))
    Board-WriteAt $r $line (Status-Color $g.Status); $r++
  }
  Board-WriteAt $r ''; $r++
  foreach ($g in $Board.Groups) {
    $title = $g.Header
    $maxTitle = $W - 9
    if ($title.Length -gt $maxTitle) { $title = $title.Substring(0, $maxTitle - 3) + '...' }
    $fill = $W - 6 - $title.Length
    if ($fill -lt 1) { $fill = 1 }
    Board-WriteAt $r ('+-- ' + $title + ' ' + ('-' * $fill) + '+') $g.Color; $r++
    for ($i = 0; $i -lt $Board.PanelLines; $i++) {
      $line = ''
      if ($i -lt $g.Panel.Count) { $line = $g.Panel[$i] }
      $lc = 'Gray'
      if ($line -match 'FATAL|ERROR') { $lc = 'Red' }
      elseif ($line -match 'WARN')  { $lc = 'Yellow' }
      Board-WriteAt $r ('| ' + (Board-Pad (Board-Cut $line ($W - 4)) ($W - 4)) + ' |') $lc; $r++
    }
  }
  Board-WriteAt $r ('+' + ('-' * ($W - 2)) + '+'); $r++
  Board-WriteAt $r (' ' + (Board-Cut $Board.Footer ($W - 2))) 'DarkGray'; $r++
  try { [Console]::SetCursorPosition(0, $r) } catch { }
}

function Set-Footer($m) {
  if ($m -eq $Board.Footer) { return }
  $Board.Footer = $m
  if (-not $Board.Active) {
    # Sem painel (console redirecionado): o spinner mudaria a linha a cada
    # 0,7s e viraria spam. So imprime quando a FASE muda (spinner e numeros
    # sao normalizados).
    $sig = ($m -replace '^ [|/\\-] ', '') -replace '\d+', 'N'
    if ($sig -eq $Board.LastPlain) { return }
    $Board.LastPlain = $sig
    Write-Host $m
  }
}

function Close-Board {
  if ($Board.Active) {
    $r = $Board.Top + (Get-BoardTotalRows)
    try { [Console]::SetCursorPosition(0, $r) } catch { }
    Write-Host ''
    $Board.Active = $false
  }
}

function Spin-Char {
  $chars = '|/-\'
  return $chars.Substring($Board.Spin % 4, 1)
}

# ---------------------------------------------------------------------------
# Coleta de estado: containers (ps), logs (compose logs) e HTTP
# ---------------------------------------------------------------------------
function Update-Statuses {
  $raw = @()
  try { $raw = @(docker compose -f $ComposeFile ps --format '{{.Service}}|{{.Status}}|{{.Health}}' 2>$null) } catch { return }
  $map = @{}
  foreach ($line in $raw) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split '\|'
    $svc = $parts[0]
    $st = ''
    $hl = ''
    if ($parts.Count -gt 1) { $st = $parts[1] }
    if ($parts.Count -gt 2) { $hl = $parts[2] }
    $norm = 'subindo'
    if ($st -match 'Exited \((\d+)\)') {
      if ($Matches[1] -eq '0') { $norm = 'parado' } else { $norm = 'falha' }
    }
    elseif ($st -match 'Restarting|Dead') { $norm = 'falha' }
    elseif ($hl -eq 'healthy') { $norm = 'saudavel' }
    elseif ($hl -eq 'unhealthy') { $norm = 'falha' }
    elseif ($hl -eq 'starting') { $norm = 'subindo' }
    elseif ($st -match 'Up') { $norm = 'no ar' }
    elseif ($st -match 'Created') { $norm = 'subindo' }
    $map[$svc] = $norm
  }
  $Board.Statuses = $map
}

function Format-LogLine($container, $body) {
  $tag = '[?]'
  if ($Tags.ContainsKey($container)) { $tag = $Tags[$container] }
  $text = $body -replace '\x1b\[[0-9;]*[A-Za-z]', ''
  $text = $text.TrimEnd()
  if ($text -eq '') { return $null }
  # Ruido de rotina (erro de verdade continua aparecendo):
  # pgbouncer: 1 linha de "stats" por minuto (sempre zeros);
  # redis: salva RDB em background a cada poucos minutos (4 linhas por save);
  # postgres: checkpoint automatico.
  if ($container -eq 'aurum-pgbouncer' -and $text -match '^LOG stats:') { return $null }
  if ($container -eq 'aurum-redis' -and $text -match '\* (DB saved on disk|Fork CoW for RDB|Background saving (started by pid|terminated with success))') { return $null }
  if ($container -eq 'aurum-postgres' -and $text -match '^LOG:\s+checkpoint (starting|complete)') { return $null }
  if (-not $text.StartsWith('{')) { return ($tag + ' ' + $text) }
  try { $o = $text | ConvertFrom-Json } catch { return ($tag + ' ' + $text) }
  $url = [string]$o.req.url
  $code = 0
  if ($null -ne $o.res.statusCode) { $code = [int]$o.res.statusCode }
  # Ruido de healthcheck do proprio container nao entra no painel.
  if ($url -match '^/health/' -and $code -eq 200) { return $null }
  $lvl = 'LOG'
  if ($null -ne $o.level) {
    switch ([int]$o.level) {
      60 { $lvl = 'FATAL' }
      50 { $lvl = 'ERROR' }
      40 { $lvl = 'WARN' }
      30 { $lvl = 'INFO' }
      20 { $lvl = 'DEBUG' }
      10 { $lvl = 'TRACE' }
    }
  }
  $parts = New-Object System.Collections.ArrayList
  if ($null -ne $o.time) {
    try { [void]$parts.Add([DateTimeOffset]::FromUnixTimeMilliseconds([long]$o.time).LocalDateTime.ToString('HH:mm:ss')) } catch { }
  }
  if ($lvl -ne 'LOG') { [void]$parts.Add($lvl) }
  if ($url -ne '') { [void]$parts.Add(([string]$o.req.method) + ' ' + $url) }
  if ($code -ne 0) { [void]$parts.Add([string]$code) }
  if ($null -ne $o.responseTime) { [void]$parts.Add([string]$o.responseTime + 'ms') }
  if ($o.msg) { [void]$parts.Add([string]$o.msg) }
  if ($o.event) { [void]$parts.Add('event=' + [string]$o.event) }
  if ($o.jobId) { [void]$parts.Add('job=' + [string]$o.jobId) }
  if ($o.err.message) { [void]$parts.Add('err: ' + [string]$o.err.message) }
  return ($tag + ' ' + ($parts -join ' '))
}

function Update-Logs {
  $svcs = @()
  foreach ($g in $Board.Groups) { $svcs += $g.Services }
  $out = @()
  try { $out = @(docker compose -f $ComposeFile logs --tail 24 --no-color @svcs 2>$null) } catch { return }
  $bucket = @{}
  foreach ($g in $Board.Groups) { $bucket[$g.Key] = New-Object System.Collections.ArrayList }
  foreach ($line in $out) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $m = [regex]::Match($line, '^(\S+)\s+\|\s?(.*)$')
    if (-not $m.Success) { continue }
    $container = $m.Groups[1].Value
    $body = $m.Groups[2].Value
    $g = $null
    foreach ($gg in $Board.Groups) { if ($gg.Prefixes -contains $container) { $g = $gg; break } }
    if ($null -eq $g) { continue }
    $fmt = Format-LogLine $container $body
    if ($fmt) { [void]$bucket[$g.Key].Add($fmt) }
  }
  foreach ($g in $Board.Groups) {
    $g.Panel = @($bucket[$g.Key] | Select-Object -Last $Board.PanelLines)
  }
}

function Test-Http($url) {
  try {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  } catch { return $false }
}

function Update-Health {
  # Um servico por ciclo (round-robin): HTTP falho custa timeout, nao pode
  # travar a animacao do painel.
  if ($Board.Groups.Count -eq 0) { return }
  $g = $Board.Groups[$Board.Ticker % $Board.Groups.Count]
  $c = 'fora'
  if ($Board.Statuses.ContainsKey($g.Primary[0])) { $c = $Board.Statuses[$g.Primary[0]] }
  if ($c -eq 'saudavel' -or $c -eq 'no ar') { $g.HttpOk = Test-Http $g.HttpUrl }
  else { $g.HttpOk = $false }
}

function Update-Groups {
  foreach ($g in $Board.Groups) {
    $rank = 99
    $det = New-Object System.Collections.ArrayList
    foreach ($svc in $g.Primary) {
      $st = 'fora'
      if ($Board.Statuses.ContainsKey($svc)) { $st = $Board.Statuses[$svc] }
      [void]$det.Add("$svc $st")
      $r = Status-Rank $st
      if ($r -lt $rank) { $rank = $r }
    }
    if ($g.Secondary.Count -gt 0) {
      $ok = 0
      foreach ($svc in $g.Secondary) {
        $st = 'fora'
        if ($Board.Statuses.ContainsKey($svc)) { $st = $Board.Statuses[$svc] }
        if ($st -eq 'saudavel' -or $st -eq 'no ar') { $ok++ }
      }
      [void]$det.Add("infra $ok/$($g.Secondary.Count)")
    }
    $st = 'subindo'
    switch ($rank) {
      0 { $st = 'falha' }
      1 { $st = 'fora' }
      2 { $st = 'parado' }
      3 { $st = 'subindo' }
      4 { $st = 'no ar' }
      5 { $st = 'saudavel' }
    }
    # So e "saudavel" quando o container E o HTTP respondem.
    if ($st -eq 'saudavel' -and -not $g.HttpOk) {
      if ($g.HttpUrl -ne '') { $st = 'no ar' }
    }
    $g.Status = $st
    $g.Detalhe = ($det -join ' | ')
  }
}

function Step-BoardOnce {
  Update-Statuses
  Update-Logs
  $Board.Ticker++
  Update-Health
  Update-Groups
  if ($Board.Active) {
    try {
      if ([Console]::WindowWidth -ne $Board.LastW -or [Console]::WindowHeight -ne $Board.LastH) {
        Initialize-Board
      }
    } catch { }
    Redraw-Board
  }
}

function All-GroupsUp {
  foreach ($g in $Board.Groups) { if ($g.Status -ne 'saudavel') { return $false } }
  return $true
}

function Wait-AllUp($timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ($true) {
    Step-BoardOnce
    if (All-GroupsUp) { return $true }
    if ((Get-Date) -gt $deadline) { return $false }
    $Board.Spin++
    $left = [int]($deadline - (Get-Date)).TotalSeconds
    Set-Footer (' ' + (Spin-Char) + ' subindo servicos... (limite ' + $left + 's)  Ctrl+C cancela')
    Start-Sleep -Milliseconds 900
  }
}

# Roda um passo (migrate/seed) com o painel VIVO: o processo escreve em arquivo
# e o painel segue animando ate ele terminar.
#
# OBS (verificado nesta maquina): `Start-Process -PassThru` NAO devolve
# ExitCode quando ha redirecionamento de saida (bug conhecido do PS 5.1).
# Solucao: pedir ao proprio bash para imprimir o codigo (`echo AURUM_EXIT:$?`)
# e ler essa ultima linha do log. Sem marcador = codigo desconhecido (nao
# inventa falha).
function Invoke-BoardStep($title, $bashExe, $scriptPath) {
  $log = Join-Path ([IO.Path]::GetTempPath()) ('aurum-step-' + [guid]::NewGuid().ToString('N') + '.out')
  $err = $log + '.err'
  $cmd = $scriptPath + '; echo AURUM_EXIT:$?'
  # As aspas em volta do comando sao OBRIGATORIAS: Start-Process junta o array
  # com espacos, e sem elas o bash recebe "-c deploy/x.sh" + "echo ..." como
  # argumentos separados (verificado: sai log vazio).
  $p = Start-Process -FilePath $bashExe -ArgumentList @('-c', ('"' + $cmd + '"')) -RedirectStandardOutput $log -RedirectStandardError $err -NoNewWindow -PassThru
  while (-not $p.HasExited) {
    $Board.Spin++
    Set-Footer (' ' + (Spin-Char) + ' ' + $title + ' rodando... o painel segue no ar')
    Step-BoardOnce
    Start-Sleep -Milliseconds 700
  }
  Start-Sleep -Milliseconds 250
  $text = @()
  if (Test-Path $log) { $text += @(Get-Content -Path $log -Encoding UTF8) }
  if (Test-Path $err) { $text += @(Get-Content -Path $err -Encoding UTF8) }
  $code = $null
  $clean = New-Object System.Collections.ArrayList
  foreach ($l in $text) {
    if ($l -match '^AURUM_EXIT:(\d+)\s*$') { $code = [int]$Matches[1]; continue }
    [void]$clean.Add($l)
  }
  Remove-Item $log, $err -ErrorAction SilentlyContinue
  return @{ Code = $code; Lines = @($clean) }
}

function Run-BoardStep($title, $bashExe, $scriptPath) {
  $res = Invoke-BoardStep $title $bashExe $scriptPath
  if ($null -eq $res.Code) {
    Warn "${title}: nao consegui ler o codigo de saida (veja o log do passo)."
    Set-Footer (' ' + $title + ': terminou sem codigo legivel')
  }
  elseif ($res.Code -ne 0) {
    Close-Board
    Warn "$title FALHOU (exit $($res.Code)). Ultimas linhas:"
    foreach ($l in ($res.Lines | Select-Object -Last 25)) { Write-Host ('   ' + $l) -ForegroundColor DarkGray }
    Initialize-Board
    Set-Footer (' ' + $title + ' FALHOU - veja a saida acima')
  }
  else {
    Set-Footer (' ' + $title + ' OK (exit 0)')
    Ok "$title OK."
  }
  return $res.Code
}

# ===========================================================================
# 1) Preflight: Docker, .env e variaveis obrigatorias
# ===========================================================================
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

$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) {
  Info 'Criando .env a partir de .env.example...'
  Copy-Item (Join-Path $Root '.env.example') $envFile
}

$curEnv = Get-Content $envFile -Raw
if ($curEnv -notmatch '(?m)^JWT_SECRET=') {
  if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'JWT_SECRET ausente no .env e node fora do PATH (defina JWT_SECRET manualmente).'
  }
  $secret = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
  Add-Content $envFile ("`nJWT_SECRET=" + $secret)
  Info 'JWT_SECRET gerado.'
}
if ($curEnv -notmatch '(?m)^DATABASE_URL=') {
  # Formato consolidado (1 banco `aurumbit` + ?schema=auth). O formato antigo
  # (`...:5432/auth`) colocava o dominio como nome de banco e gerava no postgres:
  # FATAL: database "auth" does not exist.
  Add-Content $envFile "`nDATABASE_URL=postgresql://app_auth:dev_auth_pw@localhost:6432/aurumbit?schema=auth&pgbouncer=true&connection_limit=20"
  Info 'DATABASE_URL adicionado (formato consolidado /aurumbit?schema=auth).'
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

# Portas efetivas (o .env pode trocar as do compose).
$EnvMap = @{}
foreach ($l in (Get-Content $envFile)) {
  if ($l -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $EnvMap[$Matches[1]] = $Matches[2] }
}
function Port-Of($key, $default) {
  if ($EnvMap.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($EnvMap[$key])) { return $EnvMap[$key].Trim() }
  return $default
}
$ApiPort    = Port-Of 'API_PORT' '3000'
$AdminPort  = Port-Of 'ADMIN_PORT' '3001'
$PortalPort = Port-Of 'PORTAL_PORT' '3002'

Info (Masked 'ASAAS_API_KEY' $EnvMap['ASAAS_API_KEY'])
Info (Masked 'JWT_SECRET' $EnvMap['JWT_SECRET'])
if ($EnvMap['ASAAS_WEBHOOK_SECRET'] -eq 'changeme' -or [string]::IsNullOrWhiteSpace($EnvMap['ASAAS_WEBHOOK_SECRET'])) {
  Warn 'ASAAS_WEBHOOK_SECRET pendente: pegue o token na aba Webhooks do Asaas Sandbox.'
}
if ($EnvMap['RESEND_API_KEY'] -eq 'changeme') {
  Warn 'RESEND_API_KEY=changeme: envio de e-mail real fica desabilitado (ok p/ testes locais).'
}

# ===========================================================================
# 2) Subir a INFRA primeiro (postgres/redis/pgbouncer/mailhog)
# ===========================================================================
# A ordem importa: infra -> migrations -> apps. Subindo os apps antes das
# migrations, a API roda por alguns segundos com o schema atrasado (foi o que
# gerou `column "archivedAt" does not exist` no start de 2026-10-17).
$InfraServices = @('postgres', 'redis', 'pgbouncer', 'mailhog')
$AppServices = @('api', 'workers', 'admin')
$usePortal = -not $NoPortal
if ($usePortal) { $AppServices += 'portal' }

Info 'Subindo a infraestrutura (postgres, redis, pgbouncer, mailhog)...'
docker compose -f $ComposeFile up -d @InfraServices
if ($LASTEXITCODE -ne 0) { Fail 'Falha ao subir a infraestrutura (veja as mensagens acima).' }
Ok 'Infraestrutura no ar.'

# ===========================================================================
# 3) Grupos do painel: LANDPAGE, ADM, BACKEND (+ infra no detalhe do backend)
# ===========================================================================
# Funcao (e nao bloco fixo) porque o grupo LANDPAGE pode sair no meio do
# caminho: se o build do portal falhar, o painel e remontado sem ele.
function New-BoardGroups([bool]$withPortal) {
  $list = New-Object System.Collections.ArrayList
  if ($withPortal) {
    [void]$list.Add((New-Group -Key 'LANDPAGE' -Label 'LANDPAGE' -Header 'LANDPAGE (portal)' `
      -Url ("http://localhost:" + $PortalPort) -Color 'Green' `
      -Primary @('portal') -Secondary @() -Services @('portal') -Prefixes @('aurum-portal') `
      -HttpUrl ("http://localhost:" + $PortalPort + '/')))
  }
  [void]$list.Add((New-Group -Key 'ADM' -Label 'ADM' -Header 'ADM (admin)' `
    -Url ("http://localhost:" + $AdminPort) -Color 'Magenta' `
    -Primary @('admin') -Secondary @() -Services @('admin') -Prefixes @('aurum-admin') `
    -HttpUrl ("http://localhost:" + $AdminPort + '/login')))
  [void]$list.Add((New-Group -Key 'BACKEND' -Label 'BACKEND' -Header 'BACKEND (api + workers + infra)' `
    -Url ("http://localhost:" + $ApiPort) -Color 'Cyan' `
    -Primary @('api', 'workers') -Secondary @('postgres', 'redis', 'pgbouncer', 'mailhog') `
    -Services @('postgres', 'redis', 'pgbouncer', 'mailhog', 'api', 'workers') `
    -Prefixes @('Aurum_Bit_Backend', 'aurum-workers', 'aurum-postgres', 'aurum-redis', 'aurum-pgbouncer', 'aurum-mailhog') `
    -HttpUrl ("http://localhost:" + $ApiPort + '/health/live')))
  return ,@($list)
}
$Board.Groups = New-BoardGroups $usePortal

# ===========================================================================
# 4) Painel + espera da infra (postgres saudavel ANTES de migrar)
# ===========================================================================
Initialize-Board
Set-Footer ' conectando ao docker (primeira leitura de status/logs)...'
Step-BoardOnce

Info 'Aguardando o postgres ficar saudavel...'
$infraOk = $false
$infraDeadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $infraDeadline) {
  Step-BoardOnce
  if ($Board.Statuses['postgres'] -eq 'saudavel') { $infraOk = $true; break }
  $Board.Spin++
  Set-Footer (' ' + (Spin-Char) + ' aguardando o postgres ficar saudavel...')
  Start-Sleep -Milliseconds 900
}
if (-not $infraOk) { Fail 'Postgres nao ficou saudavel em 120s (veja o status acima).' }
Ok 'Postgres saudavel.'

# ===========================================================================
# 5) Migrate + seed ANTES dos apps (opcional) com o painel no ar
# ===========================================================================
# A infra ja esta saudavel e os apps ainda NAO subiram - de proposito: assim
# a API nunca roda com o schema atrasado.
if (-not $SkipSeed) {
  # `bash` do PATH pode ser o do WSL (instavel aqui): prefere o Git Bash.
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
  if ($null -eq $bashExe) { Set-Footer ' bash ausente: pulei migrate/seed (rode no Git Bash)' }
  else {
    # .env DEV usa roles de app (sem DDL): o migrate precisa do role `migrator`
    # (ver MIGRATE_AS_MIGRATOR em deploy/scripts/migrate-all.sh).
    $env:MIGRATE_AS_MIGRATOR = '1'
    Run-BoardStep 'migrate-all.sh' $bashExe 'deploy/scripts/migrate-all.sh' | Out-Null
    Run-BoardStep 'seed-all.sh' $bashExe 'deploy/scripts/seed-all.sh' | Out-Null
  }
}

# ===========================================================================
# 6) Subir os apps (api/workers/admin/portal) - schema ja migrado
# ===========================================================================
Info 'Subindo LANDPAGE + ADM + BACKEND (1a vez compila as imagens, pode demorar)...'
# Build escreve no console: fecha o painel para a saida sair limpa e reabre
# depois (mesma ideia usada quando um passo falha).
Close-Board
docker compose -f $ComposeFile up --build -d @AppServices
if ($LASTEXITCODE -ne 0) {
  Warn 'Falha no up completo. Tentando o nucleo (sem LANDPAGE)...'
  $AppServices = @($AppServices | Where-Object { $_ -ne 'portal' })
  docker compose -f $ComposeFile up --build -d @AppServices
  if ($LASTEXITCODE -ne 0) { Fail 'Nucleo tambem falhou. Veja as mensagens acima.' }
  Warn 'LANDPAGE ficou de fora desta vez (build do portal falhou).'
  $usePortal = $false
  $Board.Groups = New-BoardGroups $false
}
else { Ok 'Containers criados.' }
Initialize-Board
Step-BoardOnce

Info 'Aguardando LANDPAGE + ADM + BACKEND ficarem saudaveis...'
$allUp = Wait-AllUp 240
if (-not $allUp) {
  Warn 'Algum servico nao ficou saudavel no tempo esperado - veja o painel/status.'
}
else {
  Set-Footer ' tudo no ar - acompanhando logs (Ctrl+C sai; containers continuam rodando)'
  Step-BoardOnce
}

# ===========================================================================
# 7) Vigia: painel continua mostrando os 3 servicos e os logs de cada um
# ===========================================================================
if (-not $NoWatch) {
  Set-Footer ' Ctrl+C sai do painel (os containers continuam no ar)'
  $watchStart = Get-Date
  try {
    while ($true) {
      Step-BoardOnce
      if ($WatchSeconds -gt 0 -and ((Get-Date) - $watchStart).TotalSeconds -ge $WatchSeconds) { break }
      Start-Sleep -Milliseconds 900
    }
  }
  finally {
    Close-Board
    Write-Host 'Painel encerrado - os containers continuam no ar.' -ForegroundColor DarkGray
  }
}
else {
  Close-Board
}

# ===========================================================================
# 8) Resumo final (fora do painel)
# ===========================================================================
Ok 'Ambiente no ar.'
docker compose -f $ComposeFile ps
Write-Host ''
Write-Host 'Servicos:' -ForegroundColor Cyan
if ($usePortal) { Write-Host ("  LANDPAGE  http://localhost:" + $PortalPort + "  (portal publico + area do cliente)") }
Write-Host ("  ADM       http://localhost:" + $AdminPort + "  (painel administrativo)")
Write-Host ("  BACKEND   http://localhost:" + $ApiPort + "/v1  (/health/live, /health/ready, /metrics)")
Write-Host '  Mailhog   http://localhost:8025   Postgres :5432  Pgbouncer :6432  Redis :6379'
Write-Host ''
Write-Host '  Painel: os logs acima sao os dos 3 servicos (healthcheck silenciado).' -ForegroundColor DarkGray
Write-Host '  Parar tudo: docker compose -f deploy/docker-compose.yml down' -ForegroundColor DarkGray

# ===========================================================================
# 9) Tunel opcional p/ webhook Asaas
# ===========================================================================
if ($Tunnel) {
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($null -eq $cf) { Warn 'cloudflared nao instalado: pulei o tunel.' }
  else {
    Info 'Abrindo tunel cloudflared p/ :3000 em nova janela...'
    Start-Process cloudflared -ArgumentList 'tunnel --url http://localhost:3000'
    Write-Host 'Cadastre no Asaas (aba Webhooks): <url-do-tunel>/v1/billing/webhooks/asaas' -ForegroundColor Cyan
  }
}
