import { getSettings } from '../settings.js';
import { UserError } from '../errors.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  format?: unknown;
  temperature?: number;
  numCtx?: number;
  /** Hard cap on generated tokens, so a small model can't ramble or loop forever. */
  maxTokens?: number;
  timeoutMs?: number;
}

async function endpoint() {
  const s = await getSettings();
  if (!s.aiEnabled) throw new UserError('AI features are turned off in Settings.');
  return { url: s.ollamaUrl.replace(/\/+$/, ''), model: s.ollamaModel };
}

function body(model: string, messages: ChatMessage[], stream: boolean, o: ChatOptions) {
  return JSON.stringify({
    model,
    messages,
    stream,
    format: o.format,
    keep_alive: '10m',
    options: { temperature: o.temperature ?? 0.3, num_ctx: o.numCtx ?? 4096, num_predict: o.maxTokens ?? 700 },
  });
}

async function post(url: string, payload: string, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : 'is not reachable';
    throw new UserError(`Ollama at ${url} ${reason}. Check the AI settings.`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UserError(`Ollama returned ${res.status}: ${text.slice(0, 200)}`, 502);
  }
  return res;
}

/** One-shot chat completion; returns the assistant's full reply. */
export async function chat(messages: ChatMessage[], o: ChatOptions = {}): Promise<string> {
  const { url, model } = await endpoint();
  const res = await post(url, body(model, messages, false, o), o.timeoutMs ?? 180_000);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

/** Streaming chat completion; yields text chunks as the model produces them. */
export async function* chatStream(messages: ChatMessage[], o: ChatOptions = {}): AsyncGenerator<string> {
  const { url, model } = await endpoint();
  const res = await post(url, body(model, messages, true, o), o.timeoutMs ?? 300_000);
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (msg.error) throw new UserError(`Ollama: ${msg.error}`, 502);
      if (msg.message?.content) yield msg.message.content;
    }
  }
}

export async function status() {
  const s = await getSettings();
  const url = s.ollamaUrl.replace(/\/+$/, '');
  const out = { enabled: s.aiEnabled, url, model: s.ollamaModel, reachable: false, modelAvailable: false, models: [] as string[], error: null as string | null };
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    out.reachable = true;
    out.models = (data.models ?? []).map((m) => m.name).sort();
    const want = s.ollamaModel.includes(':') ? s.ollamaModel : `${s.ollamaModel}:latest`;
    out.modelAvailable = out.models.includes(want) || out.models.includes(s.ollamaModel);
  } catch (err) {
    out.error = (err as Error).message;
  }
  return out;
}
