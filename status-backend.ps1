# status-backend.ps1 — Mostra se o stack Aurum Bit está rodando (compose).
# Uso:  powershell -ExecutionPolicy Bypass -File .\status-backend.ps1
# Checa containers + probes HTTP. Saída 0 = tudo saudável.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $Root 'deploy/docker-compose.yml'

function Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Bad($m) { Write-Host "[FALHA] $m" -ForegroundColor Red }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

$fail = 0

Info 'Containers (deploy/docker-compose.yml):'
try {
  $rows = docker compose -f $ComposeFile ps --format '{{.Name}} {{.Status}}' 2>$null
  if (-not $rows) { Bad 'nenhum container do stack (stack parado?)'; $fail = 1 }
  foreach ($line in $rows) {
    if ($line -match 'healthy|Up') { Ok $line } else { Bad $line; $fail = 1 }
  }
} catch { Bad 'docker/compose indisponível'; exit 1 }

Write-Host ''
Info 'Probes HTTP:'
$probes = @(
  @('API live', 'http://localhost:3000/health/live'),
  @('API ready', 'http://localhost:3000/health/ready'),
  @('Admin', 'http://localhost:3001/login'),
  @('Mailhog', 'http://localhost:8025/')
)
foreach ($p in $probes) {
  try {
    $r = Invoke-WebRequest -Uri $p[1] -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { Ok "$($p[0]): $($r.StatusCode) $($p[1])" }
    else { Bad "$($p[0]): HTTP $($r.StatusCode)"; $fail = 1 }
  } catch { Bad "$($p[0]): fora ($($p[1]))"; $fail = 1 }
}

Write-Host ''
if ($fail -eq 0) { Ok 'Stack saudável.' } else { Bad 'Há falhas acima. Logs: docker compose -f deploy/docker-compose.yml logs <servico>' }
exit $fail
