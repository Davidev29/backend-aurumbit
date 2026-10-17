/**
 * Gera um JWT de acesso local para verificacao manual da stack DEV.
 * NAO E PARTE DO PRODUTO. Le o segredo efetivo do container (fonte da verdade)
 * e usa o TEMPO DO CONTAINER (o host pode estar skewed -> TOKEN_NOT_YET_VALID).
 * Uso: node tools/dev-access-token.mjs <identityId>
 */
import { execFileSync } from "node:child_process";

const CONTAINER = process.env.API_CONTAINER || "Aurum_Bit_Backend";
const sub = process.argv[2] || "dev-verify";
const ttlS = 900;

const env = (k) =>
  execFileSync("docker", ["exec", CONTAINER, "printenv", k], { encoding: "utf8" }).trim();

const secret = env("JWT_SECRET");
const issuer = env("JWT_ISS") || "aurum-bit";
const audience = env("JWT_AUD") || "aurum-clients";
const now = Number(
  execFileSync("docker", ["exec", CONTAINER, "date", "+%s"], { encoding: "utf8" }).trim(),
);

const { createHmac } = await import("node:crypto");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const header = b64({ alg: "HS256", typ: "JWT", kid: "local-hs256-1" });
const payload = b64({
  sub,
  sid: "sess-dev-verify",
  jti: `jti-${sub}-${now}`,
  iss: issuer,
  aud: audience,
  iat: now,
  exp: now + ttlS,
  amr: ["pwd", "mfa"],
  email_verified: true,
  roles: ["STAFF_ADMIN"],
  token_version: 1,
});

const unsigned = `${header}.${payload}`;
const sig = createHmac("sha256", secret).update(unsigned, "utf8").digest("base64url");
process.stdout.write(`${unsigned}.${sig}`);
