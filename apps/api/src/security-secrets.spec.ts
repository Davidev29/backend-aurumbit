import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Fase 6 — varredura de segredos hardcoded (executa no `jest`, sem rede).
// Padrões de alta precisão (provedores reais). O próprio spec é excluído da
// varredura pelo nome do arquivo — os literais abaixo existem SÓ aqui.
// Segredos de ambiente vivem em env/KMS (ver docs/SECURITY.md); `.env.example`
// contém apenas `changeme`/localhost (fora do escopo: não é código-fonte).
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Stripe live/test secret', re: /sk-(live|test)-[0-9A-Za-z]{16,}/ },
  { name: 'PEM private key', re: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { name: 'Slack token', re: /xox[bpas]-[0-9A-Za-z-]{10,}/ },
  { name: 'GitHub PAT', re: /ghp_[0-9A-Za-z]{36}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Resend API key', re: /re_[0-9A-Za-z]{24,}/ },
];

// Nenhum lookup geo-IP server-side: o `country` de ValidateDeviceDto é
// declarado pelo app e avaliado em memória (`detectCloneSuspect` pura);
// sem MaxMind/geoip no código (PROJECT §4: geo aproximada, sem GPS).
const GEOIP_IMPORTS: RegExp = /from\s+['"](?:geoip2?|maxmind|@maxmind[^'"]*)['"]|require\(\s*['"](?:geoip2?|maxmind)[^'"]*['"]\s*\)/;

const SELF = 'security-secrets.spec.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (['node_modules', 'dist', '.next'].includes(entry)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(entry) && !full.endsWith(SELF)) {
      out.push(full);
    }
  }
  return out;
}

function scanRoots(): string[] {
  const root = resolve(__dirname, '..', '..', '..');
  const candidates = [
    join(root, 'apps', 'api', 'src'),
    join(root, 'apps', 'admin', 'app'),
    join(root, 'apps', 'admin', 'lib'),
    join(root, 'apps', 'admin', 'components'),
    join(root, 'apps', 'admin', 'stores'),
    join(root, 'apps', 'admin', 'middleware.ts'),
    join(root, 'libs'),
  ];
  const files: string[] = [];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (statSync(c).isDirectory()) {
      // Em libs/, desce só até */src (evita node_modules das libs).
      if (c.endsWith('libs')) {
        for (const lib of readdirSync(c)) {
          const src = join(c, lib, 'src');
          if (existsSync(src) && statSync(src).isDirectory()) walk(src, files);
        }
      } else {
        walk(c, files);
      }
    } else {
      files.push(c);
    }
  }
  return files;
}

describe('Segredos hardcoded (0 ocorrências)', () => {
  it('nenhum padrão de credencial real no código-fonte', () => {
    const hits: string[] = [];
    for (const file of scanRoots()) {
      const text = readFileSync(file, 'utf8');
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(text)) hits.push(`${file} :: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('sem lookup geo-IP server-side (só avaliação em memória)', () => {
    const hits: string[] = [];
    for (const file of scanRoots()) {
      const text = readFileSync(file, 'utf8');
      if (GEOIP_IMPORTS.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
