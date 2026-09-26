import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Database } from '@openmaintainer/database';
import { GitHubClient } from '@openmaintainer/github';
import { AppError, digest, opaqueId } from '@openmaintainer/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
export interface Identity {
  id: number;
  login: string;
  token: string;
}
export interface Access {
  repositoryIds: number[];
  writableIds: number[];
}
export interface Auth {
  identify(request: FastifyRequest): Promise<Identity>;
  access(identity: Identity): Promise<Access>;
}
export function encryptToken(token: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv),
    encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((x) => x.toString('base64url')).join('.');
}
export function decryptToken(value: string, keyHex: string): string {
  const [iv, tag, data] = value.split('.');
  if (!iv || !tag || !data) throw new AppError('SESSION_INVALID', 'Invalid session', 401);
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64url'));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8');
}
export function githubAuth(db: Database, key: string): Auth {
  return {
    async identify(request) {
      const bearer = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (request.headers.authorization && !bearer)
        throw new AppError('UNAUTHENTICATED', 'Unsupported authorization header', 401);
      if (bearer) {
        const gh = new GitHubClient({ token: async () => bearer });
        const user = await gh.request<{ id: number; login: string }>('/user');
        return { ...user, token: bearer };
      }
      const cookie = request.cookies.om_session;
      if (!cookie) throw new AppError('UNAUTHENTICATED', 'Sign in with GitHub', 401);
      const r = await db.query<{ id: number; login: string; token_cipher: string }>(
        'SELECT u.id,u.login,s.token_cipher FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.id_hash=$1 AND s.expires_at>now()',
        [digest(cookie)],
      );
      const row = r.rows[0];
      if (!row) throw new AppError('UNAUTHENTICATED', 'Session expired', 401);
      return { id: Number(row.id), login: row.login, token: decryptToken(row.token_cipher, key) };
    },
    async access(identity) {
      const gh = new GitHubClient({ token: async () => identity.token });
      const repos = await gh.paginate<{
        id: number;
        permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
      }>('/user/repos?affiliation=owner,collaborator,organization_member');
      const installed = await db.query<{ id: number }>(
        'SELECT r.id FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE i.suspended=false AND r.archived=false',
      );
      const active = new Set(installed.rows.map((r) => Number(r.id))),
        visible = repos.filter((r) => active.has(r.id));
      return {
        repositoryIds: visible.map((r) => r.id),
        writableIds: visible
          .filter((r) => r.permissions?.admin || r.permissions?.maintain || r.permissions?.push)
          .map((r) => r.id),
      };
    },
  };
}
export interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  dashboardUrl: string;
  encryptionKey: string;
}
export async function registerOAuth(
  app: FastifyInstance,
  db: Database,
  options: OAuthOptions,
): Promise<void> {
  const secure = new URL(options.dashboardUrl).protocol === 'https:',
    cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  app.get('/api/auth/login', async (_request, reply) => {
    const state = opaqueId();
    await db.query("INSERT INTO oauth_states(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')", [
      digest(state),
    ]);
    reply.setCookie('om_oauth_state', state, { ...cookieOptions, maxAge: 600 });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', `${options.dashboardUrl}/api/auth/callback`);
    return reply.redirect(url.toString());
  });
  app.get('/api/auth/callback', async (request, reply) => {
    const query = z
      .object({ code: z.string().min(1).max(1000), state: z.string().regex(/^[a-f0-9]{48}$/) })
      .parse(request.query);
    if (request.cookies.om_oauth_state !== query.state)
      throw new AppError('OAUTH_STATE', 'Invalid OAuth state', 401);
    const consumed = await db.query(
      'DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash',
      [digest(query.state)],
    );
    if (!consumed.rows.length) throw new AppError('OAUTH_STATE', 'Expired or reused OAuth state', 401);
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: query.code,
        redirect_uri: `${options.dashboardUrl}/api/auth/callback`,
      }),
    });
    if (!response.ok) throw new AppError('OAUTH_EXCHANGE', 'GitHub authorization failed', 502);
    const token = z
      .object({ access_token: z.string().min(1), expires_in: z.number().optional() })
      .parse(await response.json());
    const gh = new GitHubClient({ token: async () => token.access_token }),
      user = await gh.request<{ id: number; login: string }>('/user'),
      session = opaqueId(),
      ttl = Math.min(token.expires_in ?? 28800, 28800);
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO users(id,login) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET login=EXCLUDED.login',
        [user.id, user.login],
      );
      await tx.query(
        "INSERT INTO sessions(id_hash,user_id,token_cipher,expires_at) VALUES($1,$2,$3,now()+($4*interval '1 second'))",
        [digest(session), user.id, encryptToken(token.access_token, options.encryptionKey), ttl],
      );
    });
    reply.clearCookie('om_oauth_state', cookieOptions);
    reply.setCookie('om_session', session, { ...cookieOptions, maxAge: ttl });
    return reply.redirect('/dashboard');
  });
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.headers.origin !== new URL(options.dashboardUrl).origin)
      throw new AppError('ORIGIN', 'Invalid request origin', 403);
    await db.query('DELETE FROM sessions WHERE id_hash=$1', [digest(request.cookies.om_session ?? '')]);
    reply.clearCookie('om_session', cookieOptions);
    return { signedOut: true };
  });
}
