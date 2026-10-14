// Ticker licensing.evaluate (repeat 5min).
// Handler puro do job: deriva o jobId determinístico da janela de 5min e
// dispara o sweep via endpoint manual do evaluator
// (POST /v1/access/admin/evaluate). HTTP injetável p/ teste sem rede.

export const EVALUATE_WINDOW_MS = 5 * 60 * 1000;
export const EVALUATE_ENDPOINT = '/v1/access/admin/evaluate';

/** jobId determinístico por janela: `licensing-evaluate:YYYY-MM-DDTHH:MM`. */
export function evaluateWindowJobId(now: Date): string {
  const floored = Math.floor(now.getTime() / EVALUATE_WINDOW_MS) * EVALUATE_WINDOW_MS;
  return `licensing-evaluate:${new Date(floored).toISOString().slice(0, 16)}`;
}

export interface HttpPostResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type HttpPost = (url: string, init?: { method: string }) => Promise<HttpPostResponse>;

export function defaultHttpPost(): HttpPost {
  const g = globalThis as unknown as { fetch?: HttpPost };
  if (typeof g.fetch !== 'function') throw new Error('fetch indisponível (Node >= 20)');
  return (url, init) => g.fetch!(url, init);
}

export async function runEvaluateTick(deps: {
  apiBaseUrl: string;
  post?: HttpPost;
  now?: Date;
}): Promise<{ window: string; ok: true; status: number; summary: string }> {
  const now = deps.now ?? new Date();
  const window = evaluateWindowJobId(now);
  const post = deps.post ?? defaultHttpPost();
  const res = await post(`${deps.apiBaseUrl}${EVALUATE_ENDPOINT}`, { method: 'POST' });
  const body = await res.text();
  if (!res.ok) throw new Error(`evaluate ${res.status}: ${body.slice(0, 200)}`);
  return { window, ok: true, status: res.status, summary: body.slice(0, 2000) };
}
