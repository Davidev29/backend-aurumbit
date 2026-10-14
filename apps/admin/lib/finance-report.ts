/**
 * Relatório financeiro empresarial/editorial (PDF via impressão).
 * Gera um documento HTML autocontido, com margens A4, tipografia legível e
 * cabeçalho com a logomarca oficial (`/brand/logo.png` ← `ASSETS/`).
 * O PDF final é obtido via `window.print()` → "Salvar como PDF".
 */

export type FinanceReportKind = "receitas" | "despesas" | "extrato";

/** Direção do movimento — só usada no extrato (entradas + saídas). */
export type FinanceReportDirection = "entrada" | "saida";

export interface FinanceReportRow {
  data: string;
  titulo: string;
  categoria: string;
  estado: string;
  valor: number;
  /** Preenchido no extrato: define o destaque visual (verde/vermelho). */
  direcao?: FinanceReportDirection;
}

export interface FinanceReportInput {
  kind: FinanceReportKind;
  de: string;
  ate: string;
  rows: FinanceReportRow[];
  geradoPor?: string;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dtf = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
const dtfFull = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dtf.format(d);
}

export function buildFinanceReportHtml(input: FinanceReportInput): string {
  const isExtrato = input.kind === "extrato";
  const isReceita = input.kind === "receitas";
  const titulo = isExtrato
    ? "Relatório de Entradas e Saídas"
    : isReceita
      ? "Relatório de Receitas"
      : "Relatório de Despesas";
  const subtitulo = isExtrato
    ? "Extrato realizado no período — entradas e saídas"
    : isReceita
      ? "Contas recebidas e a receber no período"
      : "Contas pagas e a pagar no período";
  const kicker = isExtrato ? "Gestão financeira · Extrato completo" : `Gestão financeira · ${isReceita ? "Receitas" : "Despesas"}`;
  const escopoLabel = isExtrato
    ? "Entradas + saídas (extrato realizado)"
    : isReceita
      ? "Somente receitas"
      : "Somente despesas";
  const total = input.rows.reduce((s, r) => s + r.valor, 0);
  const media = input.rows.length > 0 ? total / input.rows.length : 0;
  const totalEntradas = isExtrato
    ? input.rows.filter((r) => r.direcao === "entrada").reduce((s, r) => s + r.valor, 0)
    : 0;
  const totalSaidas = isExtrato
    ? input.rows.filter((r) => r.direcao === "saida").reduce((s, r) => s + r.valor, 0)
    : 0;
  const saldo = totalEntradas - totalSaidas;
  const geradoEm = dtfFull.format(new Date());
  const periodo =
    input.de || input.ate
      ? `${input.de ? fmtDate(`${input.de}T12:00:00.000Z`) : "início"} — ${input.ate ? fmtDate(`${input.ate}T12:00:00.000Z`) : "hoje"}`
      : "Período completo";
  const basePeriodo = isExtrato ? "liquidação" : "vencimento";

  const dirOf = (r: FinanceReportRow): FinanceReportDirection =>
    r.direcao ?? (isReceita ? "entrada" : "saida");

  const linhas = input.rows
    .map((r) => {
      const dir = dirOf(r);
      const pill = dir === "entrada" ? "pill pill-in" : "pill pill-out";
      const mov = dir === "entrada" ? "▲ Entrada" : "▼ Saída";
      const sinal = dir === "entrada" ? "+" : "−";
      return `
      <tr class="row-${dir}">
        <td class="c-data">${esc(fmtDate(r.data))}</td>
        <td class="c-titulo">${esc(r.titulo)}</td>
        <td>${esc(r.categoria)}</td>
        ${isExtrato ? `<td><span class="${pill}">${mov}</span></td>` : ""}
        <td><span class="${pill}">${esc(r.estado)}</span></td>
        <td class="num v-${dir}">${sinal} ${esc(brl.format(r.valor))}</td>
      </tr>`;
    })
    .join("");

  const cards = isExtrato
    ? `<div class="cards">
      <div class="card"><p class="k">Lançamentos</p><p class="v">${input.rows.length}</p><p class="h">linhas no período</p></div>
      <div class="card card-in"><p class="k">Total de entradas</p><p class="v v-in">${esc(brl.format(totalEntradas))}</p><p class="h">receitas liquidadas</p></div>
      <div class="card card-out"><p class="k">Total de saídas</p><p class="v v-out">${esc(brl.format(totalSaidas))}</p><p class="h">despesas liquidadas</p></div>
      <div class="card"><p class="k">Saldo do período</p><p class="v ${saldo >= 0 ? "v-in" : "v-out"}">${esc(brl.format(saldo))}</p><p class="h">entradas − saídas</p></div>
    </div>`
    : `<div class="cards">
      <div class="card"><p class="k">Registros</p><p class="v">${input.rows.length}</p><p class="h">linhas no período</p></div>
      <div class="card ${isReceita ? "card-in" : "card-out"}"><p class="k">Total ${isReceita ? "recebido/previsto" : "pago/previsto"}</p><p class="v">${esc(brl.format(total))}</p><p class="h">soma dos valores</p></div>
      <div class="card"><p class="k">Ticket médio</p><p class="v">${esc(brl.format(media))}</p><p class="h">total ÷ registros</p></div>
    </div>`;

  const tabela = input.rows.length === 0
    ? `<div class="empty">Nenhum registro encontrado para o escopo e o período selecionados. Ajuste o período e gere novamente.</div>`
    : `<div class="legend" aria-label="Legenda">
        <span><span class="dot dot-in"></span>Entrada${isExtrato ? " (receita)" : "s (receitas)"}</span>
        <span><span class="dot dot-out"></span>Saída${isExtrato ? " (despesa)" : "s (despesas)"}</span>
      </div>
      <table class="grid">
      <thead><tr><th>Data${isExtrato ? " (liquidação)" : ""}</th><th>${isExtrato ? "Descrição" : isReceita ? "Cliente / origem" : "Fornecedor / destino"}</th><th>Categoria</th>${isExtrato ? "<th>Movimento</th>" : ""}<th>Situação</th><th class="num">Valor (R$)</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <table class="totals">
      ${
        isExtrato
          ? `<tr><td>Total de entradas (${input.rows.filter((r) => dirOf(r) === "entrada").length})</td><td class="num v-in">+ ${esc(brl.format(totalEntradas))}</td></tr>
             <tr><td>Total de saídas (${input.rows.filter((r) => dirOf(r) === "saida").length})</td><td class="num v-out">− ${esc(brl.format(totalSaidas))}</td></tr>
             <tr class="grand"><td>Saldo do período</td><td class="num">${esc(brl.format(saldo))}</td></tr>`
          : `<tr><td>Subtotal (${input.rows.length} ${input.rows.length === 1 ? "registro" : "registros"})</td><td class="num">${esc(brl.format(total))}</td></tr>
             <tr class="grand"><td>Total ${isReceita ? "de receitas" : "de despesas"}</td><td class="num">${esc(brl.format(total))}</td></tr>`
      }
    </table>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${esc(titulo)} · Aurum Bit</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11.5pt; line-height: 1.55; color: #1a1c20;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cover-bar { height: 6px; background: linear-gradient(90deg, #8a5e0e, #e8b34b 60%, #8a5e0e); }
  .wrap { padding: 28px 0 0 0; }
  header.brand { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 2px solid #14161a; }
  header.brand img { height: 54px; width: auto; object-fit: contain; }
  .brand-name { font-size: 13pt; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; margin: 0; }
  .brand-sub { margin: 2px 0 0 0; font-size: 9.5pt; color: #5a5e66; }
  .doc-kicker { margin: 22px 0 4px 0; font-size: 9.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #8a5e0e; }
  h1.doc-title { font-family: Georgia, "Times New Roman", serif; font-size: 26pt; line-height: 1.15; margin: 0 0 6px 0; color: #14161a; }
  p.doc-sub { margin: 0 0 18px 0; font-size: 11pt; color: #3c4048; }
  .meta { display: table; width: 100%; border-collapse: collapse; margin: 0 0 18px 0; font-size: 9.8pt; }
  .meta-row { display: table-row; }
  .meta-cell { display: table-cell; padding: 7px 10px; border: 1px solid #d9dce1; vertical-align: top; }
  .meta-cell.k { width: 26%; font-weight: 700; background: #f4f1e8; color: #4a3d12; }
  .cards { display: table; width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 10px 0; margin: 0 -10px 18px -10px; }
  .card { display: table-cell; border: 1px solid #d9dce1; border-left: 5px solid #8a5e0e; padding: 10px 12px; background: #fbfaf7; }
  .card-in { border-left-color: #1e7a45; }
  .card-out { border-left-color: #b23a40; }
  .card .k { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #6b6250; margin: 0 0 4px 0; }
  .card .v { font-size: 14pt; font-weight: 800; margin: 0; font-variant-numeric: tabular-nums; }
  .card .h { font-size: 8.8pt; color: #5a5e66; margin: 2px 0 0 0; }
  .v-in { color: #0f5a30; }
  .v-out { color: #8f1d22; }
  .legend { display: flex; gap: 18px; margin: 0 0 10px 0; font-size: 9.5pt; font-weight: 700; color: #3c4048; }
  .legend .dot { display: inline-block; width: 11px; height: 11px; border-radius: 999px; margin-right: 6px; vertical-align: baseline; }
  .dot-in { background: #1e7a45; }
  .dot-out { background: #b23a40; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 9.6pt; }
  table.grid thead th {
    text-align: left; font-size: 8.6pt; text-transform: uppercase; letter-spacing: 0.06em;
    background: #14161a; color: #f5f2e9; padding: 9px 8px;
  }
  table.grid tbody td { padding: 8px; border-bottom: 1px solid #e2e5ea; vertical-align: top; }
  tr.row-entrada td:first-child { border-left: 5px solid #1e7a45; }
  tr.row-saida td:first-child { border-left: 5px solid #b23a40; }
  tr.row-entrada td { background: #f2faf4; }
  tr.row-saida td { background: #fdf2f2; }
  .c-data { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .c-titulo { font-weight: 600; }
  td.num, thead th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; border: 1px solid #b9a25e; background: #f4ecd4; color: #5c4a0c; border-radius: 999px; padding: 1px 9px; font-size: 8.6pt; font-weight: 700; white-space: nowrap; }
  .pill-in { border-color: #1e7a45; background: #dff2e5; color: #0f5a30; }
  .pill-out { border-color: #b23a40; background: #fbe3e4; color: #8f1d22; }
  .totals { margin-top: 14px; margin-left: auto; width: 46%; border-collapse: collapse; font-size: 10pt; }
  .totals td { padding: 7px 10px; border: 1px solid #d9dce1; }
  .totals tr.grand td { background: #14161a; color: #f5f2e9; font-weight: 800; font-size: 11pt; }
  .notes { margin-top: 20px; border-top: 1px solid #d9dce1; padding-top: 12px; font-size: 9.3pt; color: #4a4e56; }
  .notes h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px 0; color: #14161a; }
  .notes ul { margin: 6px 0 0 18px; padding: 0; }
  footer.doc { margin-top: 26px; border-top: 2px solid #14161a; padding-top: 10px; font-size: 8.8pt; color: #5a5e66; display: flex; justify-content: space-between; gap: 12px; }
  .empty { border: 1px dashed #b9bdc5; padding: 18px; text-align: center; color: #5a5e66; font-size: 10pt; }
  .toolbar { display: flex; justify-content: flex-end; margin: 0 0 14px 0; }
  .toolbar button {
    font: inherit; font-size: 10.5pt; font-weight: 700; cursor: pointer;
    background: #14161a; color: #f5f2e9; border: 0; border-radius: 8px; padding: 10px 18px;
  }
  @media print {
    .no-print { display: none !important; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
<div class="cover-bar"></div>
<div class="wrap">
  <div class="toolbar no-print"><button type="button" onclick="window.print()">Imprimir / salvar em PDF</button></div>
  <header class="brand">
    <img src="/brand/logo.png" alt="Aurum Bit" />
    <div>
      <p class="brand-name">Aurum Bit</p>
      <p class="brand-sub">Terminal administrativo · Gestão financeira · Confidencial</p>
    </div>
  </header>

  <p class="doc-kicker">${esc(kicker)}</p>
  <h1 class="doc-title">${esc(titulo)}</h1>
  <p class="doc-sub">${esc(subtitulo)} — ${esc(periodo)} (por data de ${esc(basePeriodo)}).</p>

  <div class="meta">
    <div class="meta-row">
      <div class="meta-cell k">Período analisado</div>
      <div class="meta-cell">${esc(periodo)}</div>
      <div class="meta-cell k">Gerado em</div>
      <div class="meta-cell">${esc(geradoEm)} (America/Sao_Paulo)</div>
    </div>
    <div class="meta-row">
      <div class="meta-cell k">Escopo</div>
      <div class="meta-cell">${esc(escopoLabel)} · valores em BRL</div>
      <div class="meta-cell k">Responsável</div>
      <div class="meta-cell">${esc(input.geradoPor ?? "Terminal administrativo")}</div>
    </div>
  </div>

  ${cards}

  ${tabela}

  <section class="notes">
    <h2>Notas metodológicas</h2>
    <ul>
      <li>Valores em reais (BRL); datas no fuso America/Sao_Paulo.</li>
      ${
        isExtrato
          ? "<li>Extrato realizado: cada lançamento nasce de uma conta paga (saída) ou recebida (entrada). Verde = entrada, vermelho = saída.</li>"
          : "<li>Receitas: recebíveis com vencimento no período (inclui previstos, pendentes, recebidos e vencidos). Despesas: contas a pagar com vencimento no período.</li>"
      }
      <li>Documento gerado pelo terminal administrativo para conferência gerencial; a liquidação (pagar/baixar) permanece auditada na plataforma.</li>
    </ul>
  </section>

  <footer class="doc">
    <span>Aurum Bit · relatório gerencial · uso interno</span>
    <span>Página gerada em ${esc(geradoEm)}</span>
  </footer>
</div>
</body>
</html>`;
}
