#!/usr/bin/env node
/**
 * gates:check — cobertura de gates por workspace (N-B1 do CORRECTION-PLAN-02).
 *
 * Por que existe: o turbo anuncia um pacote na lista de uma tarefa mesmo quando
 * o script não existe na `package.json` daquele pacote — o dry-run mostra
 * `command: "<NONEXISTENT>"` e o CI fica verde sem checar nada. Foi assim que
 * `apps/api`, `apps/workers`, `apps/admin` e `apps/portal` passaram a viver num
 * "typecheck 12/12" que, na prática, checava 8 (só as libs).
 *
 * O que reprova (exit 1):
 *   1. pacote do workspace sem o script exigido pela matriz (`tools/gates-matrix.json`);
 *   2. tarefa exigida ausente de `turbo.json#tasks` (turbo só roda o que conhece);
 *   3. isenção "morta": declarada na matriz mas já cumprida — dívida que precisa
 *      ser removida, não esquecida.
 *
 * Erro de configuração (workspace/matriz ilegível, tarefa desconhecida na
 * matriz) sai 2 — nunca verde por não ter conseguido ler.
 *
 * Uso: node tools/check-gates.mjs        (pnpm gates:check)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OK = "[ok]";
const FAIL = "[FALTA]";
const EXEMPT = "[isento]";

function die(msg) {
  console.error(`gates:check: ERRO DE CONFIGURACAO — ${msg}`);
  process.exit(2);
}

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch (err) {
    die(`nao consegui ler ${rel}: ${err.message}`);
  }
}

/** Le os globs do bloco `packages:` de pnpm-workspace.yaml sem dependencia de YAML. */
function readWorkspaceGlobs() {
  const text = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) die("pnpm-workspace.yaml sem bloco `packages:`");
  const globs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // proxima chave de topo
    const m = line.match(/^\s*-\s*"?([^"\s#]+)"?/);
    if (m) globs.push(m[1]);
  }
  if (globs.length === 0) die("bloco `packages:` de pnpm-workspace.yaml sem nenhum glob");
  return globs;
}

/** Expande apenas o formato `prefixo/*` (o unico usado neste repo). */
function expandGlob(pattern) {
  if (!pattern.endsWith("/*")) {
    die(`glob nao suportado por gates:check: ${pattern} (esperado "prefixo/*")`);
  }
  const prefix = pattern.slice(0, -2);
  const base = join(ROOT, prefix);
  let entries;
  try {
    entries = readdirSync(base);
  } catch (err) {
    die(`nao consegui listar ${prefix}: ${err.message}`);
  }
  return entries
    .filter((name) => statSync(join(base, name)).isDirectory())
    .filter((name) => {
      try {
        return statSync(join(base, name, "package.json")).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => join(prefix, name).replace(/\\/g, "/"))
    .sort();
}

function main() {
  const matrix = readJson("tools/gates-matrix.json");
  const turbo = readJson("turbo.json");
  const turboTasks = Object.keys(turbo.tasks ?? {});
  if (turboTasks.length === 0) die("turbo.json sem `tasks`");

  const requiredTasks = Object.entries(matrix.required ?? {})
    .filter(([, scope]) => scope === "all")
    .map(([task]) => task);
  if (requiredTasks.length === 0) die("tools/gates-matrix.json sem nenhuma tarefa obrigatoria");
  for (const task of requiredTasks) {
    if (!turboTasks.includes(task)) {
      die(`tarefa "${task}" exigida pela matriz nao existe em turbo.json#tasks`);
    }
  }

  const tasks = ["build", "typecheck", "lint", "test"].filter((t) => turboTasks.includes(t));
  const dirs = [...new Set(readWorkspaceGlobs().flatMap(expandGlob))];
  if (dirs.length === 0) die("workspace sem nenhum pacote");

  const exemptions = new Map(
    (matrix.exemptions ?? []).map((e) => [`${e.package}#${e.task}`, e]),
  );

  const pending = [];
  const staleExemptions = [];
  const rows = [];

  for (const dir of dirs) {
    const pkg = readJson(`${dir}/package.json`);
    const scripts = pkg.scripts ?? {};
    const cells = {};
    for (const task of tasks) {
      const required = requiredTasks.includes(task);
      const has = typeof scripts[task] === "string" && scripts[task].trim().length > 0;
      const exemption = exemptions.get(`${pkg.name}#${task}`);
      if (!required) {
        cells[task] = { state: "-", label: "n/a" };
        continue;
      }
      if (has) {
        cells[task] = { state: "ok", label: OK };
        if (exemption) staleExemptions.push(`${pkg.name}#${task}`);
      } else if (exemption) {
        cells[task] = { state: "exempt", label: `${EXEMPT} ${exemption.review_by ?? "?"}` };
      } else {
        cells[task] = { state: "missing", label: FAIL };
        pending.push(`${dir} (${pkg.name}) — script "${task}" ausente e sem isencao`);
      }
    }
    rows.push({ dir, name: pkg.name, cells });
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log(
    `gates:check — ${rows.length} pacotes | matriz: ${requiredTasks.join(", ")} | turbo tasks: ${tasks.join(", ")}`,
  );
  console.log("");
  for (const row of rows) {
    const cells = tasks
      .map((t) => `${t}: ${row.cells[t].label}`)
      .join("  ");
    console.log(`  ${row.name.padEnd(width)}  ${cells}`);
  }
  console.log("");

  const active = [...exemptions.keys()].filter((k) => !staleExemptions.includes(k));
  console.log(`Isencoes vivas: ${active.length}`);
  for (const key of active) {
    const e = exemptions.get(key);
    console.log(`  ${key} — ${e.reason ?? "sem motivo"} (revisar em ${e.review_by ?? "?"})`);
  }

  let failed = false;
  if (pending.length > 0) {
    failed = true;
    console.error(`\nPENDENCIAS (${pending.length}):`);
    for (const p of pending) console.error(`  - ${p}`);
  }
  if (staleExemptions.length > 0) {
    failed = true;
    console.error(`\nISENCOES MORTAS (${staleExemptions.length}) — remover de tools/gates-matrix.json:`);
    for (const s of staleExemptions) console.error(`  - ${s} (script existe; a isencao nao e mais verdadeira)`);
  }

  if (failed) {
    console.error(
      "\ngates:check: REPROVADO. Toda app/lib precisa das tarefas da matriz — e o turbo so roda o que existe na package.json.",
    );
    process.exit(1);
  }
  console.log("\ngates:check: OK (nenhuma tarefa fantasma na matriz).");
}

main();
