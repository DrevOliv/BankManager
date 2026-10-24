import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { chatStream, status, type ChatMessage } from '../ai/ollama.js';
import { aiCategorize, askMessages, cachedInsight, insightMessages, saveInsight } from '../ai/features.js';

/**
 * Streams the model's reply as plain text. The first chunk is awaited before headers are
 * sent, so connection problems still surface as a proper JSON error response.
 */
async function streamReply(reply: FastifyReply, messages: ChatMessage[], onDone?: (text: string) => Promise<void>) {
  const gen = chatStream(messages, { numCtx: 8192, maxTokens: 700 });
  const first = await gen.next();
  async function* body() {
    let full = '';
    try {
      if (!first.done) {
        full += first.value;
        yield first.value;
      }
      for await (const chunk of gen) {
        full += chunk;
        yield chunk;
      }
      await onDone?.(full);
    } catch (err) {
      yield `\n\n(The AI stopped unexpectedly: ${(err as Error).message})`;
    }
  }
  reply.header('Content-Type', 'text/plain; charset=utf-8').header('Cache-Control', 'no-cache').header('X-Accel-Buffering', 'no');
  return reply.send(Readable.from(body()));
}

export async function aiRoutes(app: FastifyInstance) {
  app.get('/api/ai/status', async () => status());

  app.post('/api/ai/categorize', async (req) => {
    const body = z.object({ max: z.number().int().min(1).max(100).default(25) }).parse(req.body ?? {});
    return aiCategorize(body.max);
  });

  app.post('/api/ai/insights', async (req, reply) => {
    const body = z.object({ month: z.string().optional(), refresh: z.boolean().default(false) }).parse(req.body ?? {});
    const { messages, hash, key } = await insightMessages(body.month);
    const cached = body.refresh ? null : await cachedInsight(key, hash);
    if (cached) {
      reply.header('Content-Type', 'text/plain; charset=utf-8').header('X-Insight-Cached', '1');
      return cached;
    }
    return streamReply(reply, messages, (text) => saveInsight(key, hash, text));
  });

  app.get('/api/ai/insights', async (req) => {
    const { hash, key } = await insightMessages((req.query as { month?: string }).month);
    return { text: await cachedInsight(key, hash) };
  });

  app.post('/api/ai/ask', async (req, reply) => {
    const body = z
      .object({
        question: z.string().trim().min(2).max(500),
        month: z.string().optional(),
        history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).default([]),
      })
      .parse(req.body);
    return streamReply(reply, await askMessages(body.question, body.month, body.history));
  });
}
