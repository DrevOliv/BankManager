import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { one, query, tx } from './db.js';
import { UserError } from './errors.js';

export interface SessionUser {
  id: number;
  username: string;
  is_admin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const COOKIE = 'bm_session';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
// Compared against when a username doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 12);

export const credentialsSchema = z.object({
  username: z.string().trim().min(2, 'Username must be at least 2 characters').max(64),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

async function createSession(reply: FastifyReply, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expires]);
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires,
  });
}

// Simple in-memory brute-force protection: 5 failures per username+IP locks for 5 minutes.
const failures = new Map<string, { count: number; until: number }>();
function checkLock(key: string) {
  const f = failures.get(key);
  if (f && f.until > Date.now()) {
    throw new UserError('Too many failed attempts. Try again in a few minutes.', 429);
  }
}
function recordFailure(key: string) {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) {
    f.until = Date.now() + 5 * 60_000;
    f.count = 0;
  }
  failures.set(key, f);
}

const PUBLIC_ROUTES = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/setup', '/api/health']);

export async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;

    // CSRF guard: browsers can't add custom headers cross-site without a CORS preflight (which we never allow).
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'bankmanager') {
      return reply.code(403).send({ error: 'Missing X-Requested-With header' });
    }

    const token = req.cookies[COOKIE];
    if (token) {
      const row = await one<SessionUser & { expires_at: Date }>(
        `SELECT u.id, u.username, u.is_admin, s.expires_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      );
      if (row) req.user = { id: row.id, username: row.username, is_admin: row.is_admin };
    }

    const path = req.url.split('?')[0];
    if (!req.user && !PUBLIC_ROUTES.has(path)) {
      return reply.code(401).send({ error: 'Not logged in' });
    }
  });

  app.get('/api/auth/status', async (req) => {
    const users = await one<{ n: number }>('SELECT count(*)::int AS n FROM users');
    return { setupRequired: users!.n === 0, user: req.user };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const { username, password } = credentialsSchema.parse(req.body);
    const hash = await bcrypt.hash(password, 12);
    const user = await tx(async (c) => {
      // Serialise concurrent setup attempts so only the very first admin can be created.
      await c.query('LOCK TABLE users IN EXCLUSIVE MODE');
      const existing = await one<{ n: number }>('SELECT count(*)::int AS n FROM users', [], c);
      if (existing!.n > 0) throw new UserError('Setup has already been completed.', 409);
      return one<SessionUser>(
        'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true) RETURNING id, username, is_admin',
        [username, hash],
        c,
      );
    });
    await createSession(reply, user!.id);
    return { user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().trim(), password: z.string() }).parse(req.body);
    const key = `${body.username.toLowerCase()}|${req.ip}`;
    checkLock(key);
    const row = await one<SessionUser & { password_hash: string }>(
      'SELECT id, username, is_admin, password_hash FROM users WHERE lower(username) = lower($1)',
      [body.username],
    );
    const ok = await bcrypt.compare(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      recordFailure(key);
      throw new UserError('Wrong username or password.', 401);
    }
    failures.delete(key);
    await createSession(reply, row.id);
    await query('DELETE FROM sessions WHERE expires_at < now()');
    return { user: { id: row.id, username: row.username, is_admin: row.is_admin } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const body = z
      .object({ currentPassword: z.string(), newPassword: credentialsSchema.shape.password })
      .parse(req.body);
    const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!row || !(await bcrypt.compare(body.currentPassword, row.password_hash))) {
      throw new UserError('Current password is wrong.');
    }
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await bcrypt.hash(body.newPassword, 12)]);
    return { ok: true };
  });

  // Minimal user management for the admin.
  const requireAdmin = (req: FastifyRequest) => {
    if (!req.user?.is_admin) throw new UserError('Only admins can manage users.', 403);
  };

  app.get('/api/users', async (req) => {
    requireAdmin(req);
    return query('SELECT id, username, is_admin, created_at FROM users ORDER BY id');
  });

  app.post('/api/users', async (req) => {
    requireAdmin(req);
    const body = credentialsSchema.extend({ isAdmin: z.boolean().default(false) }).parse(req.body);
    const exists = await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [body.username]);
    if (exists) throw new UserError('That username is taken.');
    return one(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin, created_at',
      [body.username, await bcrypt.hash(body.password, 12), body.isAdmin],
    );
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    if (id === req.user!.id) throw new UserError("You can't delete your own account.");
    await query('DELETE FROM users WHERE id = $1', [id]);
    return { ok: true };
  });
}
