import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { authPlugin } from './auth.js';
import { UserError } from './errors.js';
import { transactionRoutes } from './routes/transactions.js';
import { categoryRoutes } from './routes/categories.js';
import { importRoutes } from './routes/imports.js';
import { settingsRoutes } from './routes/settings.js';
import { aiRoutes } from './routes/ai.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    }
    if (err instanceof UserError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  // Registered on the root instance (not via register) so its auth hook covers every route.
  await authPlugin(app);
  await app.register(transactionRoutes);
  await app.register(categoryRoutes);
  await app.register(importRoutes);
  await app.register(settingsRoutes);
  await app.register(aiRoutes);

  // Serve the built React app; unknown non-API paths fall back to index.html for client-side routing.
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
